// packages/automation-core/src/ingestion/lists.ts
import type { IngestionReporter } from './report';
import type { IdManager } from './ids';

export interface IngestedListItem {
  id: string;
  tag: 'li';
  role: 'listitem';
  content: string;
  children?: IngestedList[];
}

export interface IngestedList {
  id: string;
  tag: 'ul' | 'ol';
  role: 'list';
  ordered: boolean;
  start?: number;
  items: IngestedListItem[];
}

export function lowerListRecipe(
  input: {
    tag: 'ul' | 'ol';
    start?: number;
    items: Array<{ text: string; subItems?: Array<{ text: string }> }>;
    hasUnresolvableExpressions?: boolean;
    malformedStructure?: boolean;
  },
  idManager: IdManager,
  reporter?: IngestionReporter,
  target = 'list'
): IngestedList | null {
  // Strict refusal on malformed input or unresolvable expressions
  if (input.hasUnresolvableExpressions) {
    reporter?.recordIssue(
      'UNSUPPORTED_LIST_EXPRESSION',
      [target],
      'List lowering refused: unresolvable JavaScript expression detected in list recipe. Partial conversion rejected.'
    );
    return null;
  }

  if (input.malformedStructure || !Array.isArray(input.items) || input.items.length === 0) {
    reporter?.recordIssue(
      'MALFORMED_LIST_STRUCTURE',
      [target],
      'List lowering refused: list must contain valid items array. Partial conversion rejected.'
    );
    return null;
  }

  const listId = idManager.ensureNodeId(undefined, input.tag, reporter).id;
  const isOrdered = input.tag === 'ol';

  const items: IngestedListItem[] = [];

  for (let i = 0; i < input.items.length; i++) {
    const rawItem = input.items[i];
    if (typeof rawItem.text !== 'string') {
      reporter?.recordIssue(
        'MALFORMED_LIST_ITEM',
        [target, 'items', i],
        'List item text must be a string. Recipe conversion aborted.'
      );
      return null;
    }

    const itemId = idManager.ensureNodeId(undefined, 'li', reporter).id;
    const item: IngestedListItem = {
      id: itemId,
      tag: 'li',
      role: 'listitem',
      content: rawItem.text,
    };

    if (rawItem.subItems && Array.isArray(rawItem.subItems) && rawItem.subItems.length > 0) {
      const nestedList = lowerListRecipe(
        {
          tag: input.tag,
          items: rawItem.subItems,
        },
        idManager,
        reporter,
        `${target}.item[${i}].sublist`
      );
      if (!nestedList) {
        // Abort whole conversion if nested list refused
        return null;
      }
      item.children = [nestedList];
    }

    items.push(item);
  }

  reporter?.recordNormalization(
    'LOWER_LIST_RECIPE',
    target,
    `${input.tag} (${input.items.length} items)`,
    `${listId} (role="list", ${items.length} items)`
  );

  return {
    id: listId,
    tag: input.tag,
    role: 'list',
    ordered: isOrdered,
    start: isOrdered ? (input.start ?? 1) : undefined,
    items,
  };
}
