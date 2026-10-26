// expression-autocomplete.ts — Intelligent dot-autocomplete and path resolution for JavaScript formulas.
// Inspired by Webstudio's expression editor with array index, object property, and method completions.

export interface AutocompleteSuggestion {
  label: string;
  displayLabel?: string;
  insertText: string;
  replaceFrom: number;
  replaceTo: number;
  detail: string;
  type: 'index' | 'property' | 'method' | 'collection' | 'param';
}

export interface AutocompleteContext {
  text: string;
  cursorPos: number;
  scope: Record<string, any>;
  routeParams?: string[];
  collectionSchemas?: Map<string, any>;
  itemVar?: string;
}

const ALLOWED_ARRAY_METHODS = ['find', 'filter', 'map', 'some', 'slice', 'includes', 'join', 'forEach'];
const ALLOWED_STRING_METHODS = ['toLowerCase', 'toUpperCase', 'trim', 'slice', 'split', 'includes', 'replace', 'startsWith', 'endsWith'];

/**
 * Extract the active JavaScript member expression immediately preceding the cursor.
 * Tracks backwards past identifiers, dots, array brackets `[0]`, ignoring unrelated operators.
 */
export function extractActiveExpression(textBeforeCursor: string): { expression: string; startOffset: number } {
  if (!textBeforeCursor) return { expression: '', startOffset: 0 };

  // If inside a template literal `${...}`, only examine the code inside the current `${...}`
  const lastTemplateOpen = textBeforeCursor.lastIndexOf('${');
  const lastTemplateClose = textBeforeCursor.lastIndexOf('}');
  let relevantText = textBeforeCursor;
  let baseOffset = 0;

  if (lastTemplateOpen !== -1 && lastTemplateOpen > lastTemplateClose) {
    baseOffset = lastTemplateOpen + 2;
    relevantText = textBeforeCursor.slice(baseOffset);
  }

  // Find the expression starting after the last statement boundary / operator
  // Operators: +, -, *, /, %, &, |, ^, (, ,, ?, :, !, =, {, ;, \n
  let splitIdx = -1;
  let inBracket = 0;

  for (let i = relevantText.length - 1; i >= 0; i--) {
    const ch = relevantText[i];
    if (ch === ']') { inBracket++; continue; }
    if (ch === '[') {
      if (inBracket > 0) { inBracket--; continue; }
      else { splitIdx = i; break; }
    }
    if (inBracket > 0) continue;

    if (/[\s+*%/&|^,?:!={;()<>]/.test(ch) || (ch === '-' && i > 0 && !/[eE]/.test(relevantText[i - 1]))) {
      splitIdx = i;
      break;
    }
  }

  const rawExpr = splitIdx === -1 ? relevantText : relevantText.slice(splitIdx + 1);
  const leadingTrim = rawExpr.length - rawExpr.trimStart().length;
  const expr = rawExpr.trimStart();
  const startOffset = baseOffset + (splitIdx === -1 ? 0 : splitIdx + 1) + leadingTrim;

  return { expression: expr, startOffset };
}

export interface ParsedPath {
  root: string;
  steps: (string | number)[];
  hasTrailingDot: boolean;
  query: string;
}

/**
 * Parse an expression like `placements.`, `placements.[0].`, `posts[0].title`, `item.na`
 * into root, navigation steps, and current query.
 */
export function parseExpressionPath(expr: string): ParsedPath | null {
  if (!expr) return null;

  // Normalize `.[0]` -> `[0]` for uniform parsing
  // Keep original structure in mind for replacement ranges
  let remaining = expr;
  let hasTrailingDot = false;
  let query = '';

  if (remaining.endsWith('.')) {
    hasTrailingDot = true;
    remaining = remaining.slice(0, -1);
  } else {
    // Check if ends with a partial identifier after dot
    const lastDot = remaining.lastIndexOf('.');
    const lastBracket = remaining.lastIndexOf(']');
    if (lastDot > lastBracket) {
      query = remaining.slice(lastDot + 1);
      hasTrailingDot = true;
      remaining = remaining.slice(0, lastDot);
    } else if (lastBracket === -1 && !remaining.includes('.')) {
      // Bare identifier at root, e.g. "pla"
      return { root: remaining, steps: [], hasTrailingDot: false, query: remaining };
    }
  }

  if (!remaining && hasTrailingDot) {
    return null;
  }

  // Parse remaining path: `foo.bar[0].baz` or `foo.[0]`
  const steps: (string | number)[] = [];
  const tokenRegex = /(?:^\w+|\.?\[(\d+)\]|\.?\["([^"]+)"\]|\.?\['([^']+)'\]|\.?(\w+))/g;
  let match: RegExpExecArray | null;
  let root = '';

  while ((match = tokenRegex.exec(remaining)) !== null) {
    if (!root) {
      root = match[0].replace(/^\./, '');
      continue;
    }
    if (match[1] !== undefined) {
      steps.push(parseInt(match[1], 10));
    } else if (match[2] !== undefined) {
      steps.push(match[2]);
    } else if (match[3] !== undefined) {
      steps.push(match[3]);
    } else if (match[4] !== undefined) {
      steps.push(match[4]);
    }
  }

  if (!root) return null;

  return { root, steps, hasTrailingDot, query };
}

export function formatValuePreview(value: unknown): string {
  if (value === undefined) return '';
  if (value === null) return 'null';
  if (typeof value === 'string') {
    return value.length > 25 ? `"${value.slice(0, 22)}..."` : `"${value}"`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `Array(${value.length})`;
  }
  if (typeof value === 'object') {
    return '{...}';
  }
  return '';
}

/**
 * Resolve target in scope given root identifier and navigation steps.
 */
export function resolveTarget(root: string, steps: (string | number)[], scope: Record<string, any>): any {
  if (!(root in scope)) return undefined;

  let current = scope[root];
  for (const step of steps) {
    if (current == null) return undefined;
    current = current[step];
  }
  return current;
}

/**
 * Main autocomplete engine: computes intelligent suggestions based on current expression and scope.
 */
export function getAutocompleteSuggestions(ctx: AutocompleteContext): AutocompleteSuggestion[] {
  const { text, cursorPos, scope, routeParams = [], collectionSchemas, itemVar = 'item' } = ctx;
  const textBeforeCursor = text.slice(0, cursorPos);
  const { expression, startOffset } = extractActiveExpression(textBeforeCursor);

  if (!expression && !textBeforeCursor.endsWith('.')) {
    return [];
  }

  const parsed = parseExpressionPath(expression);
  const suggestions: AutocompleteSuggestion[] = [];

  // CASE 1: Top-level root identifier completion (e.g. typing "it", "po", "pa")
  if (!parsed || (!parsed.hasTrailingDot && parsed.steps.length === 0)) {
    const query = (parsed?.query || expression).toLowerCase();
    const queryOffset = cursorPos - query.length;

    // Suggest item
    if (itemVar.toLowerCase().includes(query)) {
      suggestions.push({
        label: itemVar,
        insertText: itemVar,
        replaceFrom: queryOffset,
        replaceTo: cursorPos,
        detail: 'Current item',
        type: 'property',
      });
    }

    // Suggest params
    if ('params'.includes(query)) {
      suggestions.push({
        label: 'params',
        insertText: 'params',
        replaceFrom: queryOffset,
        replaceTo: cursorPos,
        detail: 'Route parameters',
        type: 'param',
      });
    }

    // Suggest all CMS collections in scope
    for (const key of Object.keys(scope)) {
      if (key === itemVar || key === 'params') continue;
      if (key.toLowerCase().includes(query)) {
        const isArray = Array.isArray(scope[key]);
        const schema = collectionSchemas?.get(key);
        suggestions.push({
          label: key,
          insertText: key,
          replaceFrom: queryOffset,
          replaceTo: cursorPos,
          detail: schema?.name ? `${schema.name} collection` : isArray ? 'CMS Collection (Array)' : 'Variable',
          type: 'collection',
        });
      }
    }

    return suggestions;
  }

  // CASE 2: Member access after dot (e.g. `placements.`, `posts[0].`, `item.`)
  const target = resolveTarget(parsed.root, parsed.steps, scope);
  if (target === undefined) {
    return [];
  }

  const query = parsed.query.toLowerCase();
  const endsWithDot = textBeforeCursor.endsWith('.');
  // When replacing, if query is present, replace from start of query. If user just typed '.', replace from dot or cursor.
  const dotIndex = textBeforeCursor.lastIndexOf('.');
  const replaceFrom = query ? cursorPos - query.length : cursorPos;
  const replaceTo = cursorPos;

  // ── Array Target (e.g. `placements.`, `posts.`, `categories.`) ───────────────
  if (Array.isArray(target)) {
    // 1. Array index [0], [1], etc.
    const indicesToShow = Math.min(target.length, 5);
    for (let i = 0; i < indicesToShow; i++) {
      const idxStr = String(i);
      const bracketStr = `[${i}]`;
      if (query && !bracketStr.toLowerCase().includes(query) && !idxStr.includes(query)) {
        continue;
      }

      const itemPreview = target[i];
      const previewText = typeof itemPreview === 'object' && itemPreview !== null
        ? (itemPreview.name || itemPreview.title || itemPreview.slug || itemPreview._slug || `Item ${i}`)
        : String(itemPreview);

      // If user typed dot right before (e.g. `placements.` or `placements.0`), selecting `[0]` transforms to `placements[0]`
      // By setting replaceFrom = dotIndex, the dot (and any typed index query) is consumed!
      const canConsumeDot = dotIndex !== -1 && (endsWithDot || (query && dotIndex === replaceFrom - 1));
      suggestions.push({
        label: `[${i}]`,
        displayLabel: `[${i}]`,
        insertText: `[${i}]`,
        replaceFrom: canConsumeDot ? dotIndex : replaceFrom,
        replaceTo: replaceTo,
        detail: String(previewText),
        type: 'index',
      });
    }

    // 2. Length property
    if ('length'.includes(query)) {
      suggestions.push({
        label: 'length',
        insertText: 'length',
        replaceFrom,
        replaceTo,
        detail: `${target.length}`,
        type: 'property',
      });
    }

    // 3. Array methods
    for (const method of ALLOWED_ARRAY_METHODS) {
      if (method.toLowerCase().includes(query)) {
        suggestions.push({
          label: method,
          displayLabel: `${method}()`,
          insertText: `${method}()`,
          replaceFrom,
          replaceTo,
          detail: 'Array method',
          type: 'method',
        });
      }
    }

    return suggestions;
  }

  // ── Object Target (e.g. `item.`, `placements[0].`, `params.`) ────────────────
  if (typeof target === 'object' && target !== null) {
    const keys = Object.keys(target);
    for (const key of keys) {
      if (key.toLowerCase().includes(query)) {
        const val = target[key];
        const isValidIdentifier = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key);
        const insertText = isValidIdentifier ? key : `[${JSON.stringify(key)}]`;
        const canConsumeDot = !isValidIdentifier && dotIndex !== -1 && (endsWithDot || dotIndex === replaceFrom - 1);
        suggestions.push({
          label: key,
          insertText,
          replaceFrom: canConsumeDot ? dotIndex : replaceFrom,
          replaceTo,
          detail: formatValuePreview(val),
          type: 'property',
        });
      }
    }

    // Also include schema fields if target is item and some fields are empty in sample item
    if (parsed.root === itemVar && collectionSchemas) {
      for (const schema of collectionSchemas.values()) {
        if (schema.fields) {
          for (const f of schema.fields) {
            if (f.id.toLowerCase().includes(query) && !suggestions.some(s => s.label === f.id)) {
              suggestions.push({
                label: f.id,
                insertText: f.id,
                replaceFrom,
                replaceTo,
                detail: f.type || 'Field',
                type: 'property',
              });
            }
          }
        }
      }
    }

    return suggestions;
  }

  // ── String Target (e.g. `item.title.`, `params.category.`) ───────────────────
  if (typeof target === 'string') {
    if ('length'.includes(query)) {
      suggestions.push({
        label: 'length',
        insertText: 'length',
        replaceFrom,
        replaceTo,
        detail: `${target.length}`,
        type: 'property',
      });
    }

    for (const method of ALLOWED_STRING_METHODS) {
      if (method.toLowerCase().includes(query)) {
        suggestions.push({
          label: method,
          displayLabel: `${method}()`,
          insertText: `${method}()`,
          replaceFrom,
          replaceTo,
          detail: 'String method',
          type: 'method',
        });
      }
    }

    return suggestions;
  }

  return [];
}
