import { createHash } from 'node:crypto';
import { parse, parseExpression } from '@babel/parser';
import * as t from '@babel/types';
import { z } from 'zod';
import { checkFile } from '@/code/oracle/check-file';
import { oracleFileKind } from '@/code/oracle/file-kind';
import { isCodeComponentSource } from '@/code/oracle/checks/shared';
import { validateNativeOverrideSource } from '@/code/components/code-override-source';
import type { TransferDiagnostic } from '@/shared/framer-transfer-envelope.mjs';
import type { FileChange, Operation } from '../contracts';
import { createPlan } from '../plan';
import { defaultRegistry } from '../registry';
import { validatePlan } from '../validate';
import { safeProjectPath } from './scoped-restore';
import { isSystemProtectedPath, PROTECTED_SYSTEM_FILES } from './code-files';
import { validateFramerImportCms } from './framer-import-cms';
import { buildCmsDetailServerWrapper, parseCmsSeoDefaults, parseCmsSeoExpressions } from '@/code/project/cms-seo';
import { parseCmsPageMeta } from '@/code/project/cms-page-meta';
import { applyFramerColorTokens } from '@/code/generation/framer-token-gen';
import { applyFramerTypographyTokens } from '@/code/generation/framer-typography-gen';
import { applyFramerFontFaces } from '@/code/generation/framer-font-gen';
import { addGoogleFontImportsToCss } from '@/shared/google-font-import';
import { ensureCursorPortalInLayout, hasNativeCursorPortal } from '@/code/generation/cursor-gen';
import { ensureSmoothScrollInLayout, SMOOTH_SCROLL_CONTROLLER_PATH, SMOOTH_SCROLL_DATA_PATH } from '@/code/generation/smooth-scroll-layout';
import { SMOOTH_SCROLL_CONTROLLER_SOURCE } from '@/code/generation/smooth-scroll-gen';
import { parseSmoothScroll, serializeSmoothScroll } from '@/code/project/smooth-scroll-config';
import { FORM_ROUTE_CONTENT, FORM_ROUTE_PATH } from '@/code/generation/form-gen';
import { PAGE_EFFECTS_RUNTIME_SOURCE, PAGE_TRANSITIONS_SOURCE } from '@/code/generation/page-transitions-gen';
import { isEmptyPageEffects, parsePageEffects, serializePageEffects } from '@/code/project/page-effects-config';
import { updateNativeFavicon } from '@/code/import/framer-native/favicon';
import { updateMetadataInCode, updateSiteConfigInCode } from '@/code/generation/metadata-gen';

export const framerImportSubmitInputSchema = z.object({
  files: z.array(z.object({
    path: z.string().min(1), code: z.string(), baseHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    baseCode: z.string().optional(),
    cursorPortal: z.literal(true).optional(),
    smoothScroll: z.literal(true).optional(),
    favicon: z.string().min(1).optional(),
    faviconDark: z.string().min(1).optional(),
    siteTitle: z.string().optional(),
    siteDescription: z.string().optional(),
    socialImage: z.string().min(1).optional(),
    siteLanguage: z.string().regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/).optional(),
    colorTokens: z.array(z.object({ name: z.string(), value: z.string(), dark: z.string().optional() }).strict()).min(1).max(10000).optional(),
    typographyTokens: z.array(z.object({ name: z.string(), value: z.string() }).strict()).min(1).max(10000).optional(),
    fontFaces: z.array(z.object({ family: z.string(), url: z.string(), weight: z.number(), style: z.enum(['normal', 'italic']), ext: z.enum(['woff2', 'woff', 'otf', 'ttf']), weightRange: z.object({ min: z.number(), max: z.number() }).strict().optional(), unicodeRange: z.string().optional() }).strict()).min(1).max(10000).optional(),
    googleFonts: z.array(z.object({ family: z.string(), axes: z.record(z.string(), z.number()) }).strict()).min(1).max(10000).optional(),
  }).strict()).min(1).max(10000),
  sourceManifest: z.object({
    format: z.literal('revyme.framer.native'), version: z.literal(1), complete: z.literal(true),
    context: z.object({
      projectId: z.string().min(1), branchId: z.string().min(1), revision: z.string().min(1),
      editorBuild: z.string().min(1), scopeId: z.string().min(1), mode: z.enum(['selection', 'component', 'page', 'project']),
    }).strict(),
    rootIds: z.array(z.string().min(1)).min(1), captureSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  }).strict(),
  mode: z.enum(['create', 'replace', 'paste']),
  target: z.object({ projectId: z.string().min(1), branchId: z.string().min(1), filePath: z.string().optional(), parentNodeId: z.string().optional() }).strict(),
  expectedRevision: z.number().int().nonnegative(),
}).strict();
export type FramerImportSubmitInput = z.infer<typeof framerImportSubmitInputSchema>;
export interface FramerImportSubmitOutput { changes: FileChange[]; createdIds: string[]; diagnostics: TransferDiagnostic[] }

const sha256 = (code: string) => createHash('sha256').update(code).digest('hex');
function fail(code: string, message: string): never { throw new Error(`${code}: ${message}`); }

function assertNativeFamily(path: string): void {
  if (!safeProjectPath(path) || path !== path.trim()) fail('INVALID_PATH', path);
  if (path === 'app/globals.css' || path === FORM_ROUTE_PATH || path === SMOOTH_SCROLL_DATA_PATH || path === SMOOTH_SCROLL_CONTROLLER_PATH) return;
  if (PROTECTED_SYSTEM_FILES.has(path) || isSystemProtectedPath(path) || path === 'app/layout.tsx') fail('PROTECTED_PATH', path);
  if (/^components\/[A-Za-z][A-Za-z0-9_-]*\.tsx$/.test(path) ||
      /^overrides\/[A-Za-z][A-Za-z0-9_-]*\.tsx$/.test(path) ||
      /^app\/(?:[^/]+\/)*(?:page\.client|page|LayoutClient)\.tsx$/.test(path) ||
      /^app\/\([A-Za-z0-9_-]+\)\/(?:layout\.tsx|page-transitions\.tsx|page-effects(?:-runtime)?\.ts)$/.test(path) ||
      /^cms\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\.schema)?\.json$/.test(path) ||
      /^public\/assets\/(?:[^/]+\/)*[^/]+\.(?:avif|gif|ico|jpeg|jpg|png|svg|webp|mp4|webm|mov|mp3|wav|ogg|pdf|woff2?|ttf|otf)$/i.test(path)) return;
  fail('FILE_FAMILY_UNSUPPORTED', path);
}

function astFor(code: string, path: string): t.File {
  try { return parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] }); }
  catch (error) { return fail('SYNTAX_ERROR', `${path}: ${String(error)}`); }
}
function nodeIds(code: string, path: string): Set<string> {
  const ids = new Set<string>();
  t.traverseFast(astFor(code, path), node => {
    if (t.isJSXAttribute(node) && t.isJSXIdentifier(node.name, { name: 'data-id' }) && t.isStringLiteral(node.value)) ids.add(node.value.value);
  });
  return ids;
}

function isStaticMetadata(node: t.Node | null | undefined): boolean {
  if (t.isStringLiteral(node) || t.isNumericLiteral(node) || t.isBooleanLiteral(node) || t.isNullLiteral(node)) return true;
  if (t.isUnaryExpression(node) && node.operator === '-' && t.isNumericLiteral(node.argument)) return true;
  if (t.isArrayExpression(node)) return node.elements.every(element => element !== null && isStaticMetadata(element));
  return t.isObjectExpression(node) && node.properties.every(property =>
    t.isObjectProperty(property) && !property.computed && !property.shorthand &&
    (t.isIdentifier(property.key) || t.isStringLiteral(property.key)) && isStaticMetadata(property.value));
}

function isSafeCmsSeoExpression(value: string, fields: ReadonlySet<string>): boolean {
  try {
    const expr = parseExpression(value);
    if (!t.isCallExpression(expr) || expr.arguments.length !== 1 || !t.isStringLiteral(expr.arguments[0], { value: '' }) ||
        !t.isMemberExpression(expr.callee) || expr.callee.computed || !t.isIdentifier(expr.callee.property, { name: 'join' }) || !t.isArrayExpression(expr.callee.object)) return false;
    return expr.callee.object.elements.every(element => t.isStringLiteral(element) ||
      (t.isLogicalExpression(element, { operator: '??' }) && t.isStringLiteral(element.right, { value: '' }) &&
       t.isOptionalMemberExpression(element.left) && element.left.optional && !element.left.computed &&
       t.isIdentifier(element.left.object, { name: 'item' }) && t.isIdentifier(element.left.property) && fields.has(element.left.property.name)));
  } catch { return false; }
}

function isSafeCmsImage(value: string): boolean {
  if (!/^(?:\/api\/uploads\/|\/assets\/|https:\/\/)[^\s"'<>]+$/.test(value)) return false;
  try { const url = new URL(value, 'https://revyme.invalid'); return url.protocol === 'https:' && !url.username && !url.password; }
  catch { return false; }
}

/** Server entries have a narrow structural contract; annotations cannot turn canvas code into a wrapper. */
function validateWrapper(path: string, code: string, projected: ReadonlyMap<string, string>): void {
  if (path.endsWith('/[slug]/page.tsx')) {
    const client = projected.get(path.replace(/page\.tsx$/, 'page.client.tsx'));
    const meta = client ? parseCmsPageMeta(client) : undefined;
    const collection = meta?.collection;
    const defaults = parseCmsSeoDefaults(code);
    const expressions = parseCmsSeoExpressions(code);
    let fields = new Set<string>();
    try {
      const schema = JSON.parse(projected.get(`cms/${collection}.schema.json`) ?? '{}');
      if (Array.isArray(schema.fields)) fields = new Set(schema.fields.filter((field: any) => field?.type === 'text' && typeof field.id === 'string').map((field: any) => field.id));
    } catch { /* CMS validation rejects malformed schema. */ }
    if (meta?.kind === 'detail' && typeof collection === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(collection) &&
        Object.entries(defaults).every(([key, value]) => typeof value === 'string' && (['title', 'description'].includes(key) || key === 'ogImage' && isSafeCmsImage(value)) || key === 'robotsIndex' && typeof value === 'boolean') &&
        Object.entries(expressions).every(([key, value]) => ['title', 'description'].includes(key) && typeof value === 'string' && isSafeCmsSeoExpression(value, fields)) &&
        projected.has(`cms/${collection}.schema.json`) && projected.has(`cms/${collection}.json`) &&
        code === buildCmsDetailServerWrapper({ collection, defaults, expressions, apiConfig: null })) return;
  }
  const ast = astFor(code, path);
  const client = path.endsWith('/layout.tsx') ? './LayoutClient' : './page.client';
  const imports = ast.program.body.filter(t.isImportDeclaration);
  const peer = imports.find(statement => statement.source.value === client);
  const local = peer?.specifiers.length === 1 && t.isImportDefaultSpecifier(peer.specifiers[0]) ? peer.specifiers[0].local.name : null;
  const exported = ast.program.body.find(t.isExportDefaultDeclaration)?.declaration;
  if (!local || ast.program.directives.some(d => d.value.value === 'use client') ||
      !t.isFunctionDeclaration(exported) || exported.async || exported.body.body.length !== 1 || !t.isReturnStatement(exported.body.body[0])) fail('WRAPPER_INVALID', path);
  const returned = exported.body.body[0].argument;
  if (!t.isJSXElement(returned) || !t.isJSXIdentifier(returned.openingElement.name, { name: local })) fail('WRAPPER_INVALID', `${path} must return its native client`);
  if (returned.openingElement.attributes.length) fail('WRAPPER_INVALID', `Unexpected client attributes in ${path}`);
  const children = returned.children.filter(child => !t.isJSXText(child) || !!child.value.trim());
  if (client === './page.client' ? children.length !== 0 || exported.params.length !== 0 :
      children.length !== 1 || !t.isJSXExpressionContainer(children[0]) || !t.isIdentifier(children[0].expression, { name: 'children' }) ||
      exported.params.length !== 1 || !t.isObjectPattern(exported.params[0]) || exported.params[0].properties.length !== 1 ||
      !t.isObjectProperty(exported.params[0].properties[0]) || !t.isIdentifier(exported.params[0].properties[0].value, { name: 'children' })) {
    fail('WRAPPER_INVALID', `Unexpected client children/parameters in ${path}`);
  }
  for (const statement of ast.program.body) {
    if (t.isImportDeclaration(statement)) {
      if (statement !== peer && !(statement.importKind === 'type' && statement.source.value === 'react')) fail('WRAPPER_INVALID', `Unexpected import in ${path}`);
    } else if (t.isExportNamedDeclaration(statement)) {
      const declaration = statement.declaration;
      if (!t.isVariableDeclaration(declaration, { kind: 'const' }) || declaration.declarations.length !== 1 ||
          !t.isIdentifier(declaration.declarations[0].id, { name: 'metadata' })) fail('WRAPPER_INVALID', `Unexpected export in ${path}`);
      if (!isStaticMetadata(declaration.declarations[0].init)) fail('WRAPPER_INVALID', `Metadata must be static in ${path}`);
    } else if (!t.isExportDefaultDeclaration(statement)) fail('WRAPPER_INVALID', `Unexpected statement in ${path}`);
  }
  let extraJsx = false;
  t.traverseFast(returned, node => { if (t.isJSXElement(node) && node !== returned) extraJsx = true; });
  if (extraJsx) fail('WRAPPER_INVALID', `Canvas nodes belong in the client of ${path}`);
}

/** Candidate only: native validation is never bypassed by the source manifest or generated comments. */
const framerImportSubmitDefinition: Operation<FramerImportSubmitInput, FramerImportSubmitOutput> = {
  name: 'imports.framer.submit', category: 'imports', kind: 'mutation', permit: 'write', environment: 'headless', ownerTask: 'framer-native-transfer',
  description: 'Validate a deterministic Framer conversion as a native full-file candidate. Supports pages, design/code components, CMS and assets; returns changes for the normal atomic plan/CAS/commit pipeline.',
  inputSchema: framerImportSubmitInputSchema,
  async execute(snapshot, rawInput, context) {
    const input = framerImportSubmitInputSchema.parse(rawInput);
    context.trace('framer-import.prepare', { files: input.files.length, mode: input.mode });
    if (input.expectedRevision !== snapshot.revision) fail('STALE_REVISION', `Expected ${input.expectedRevision}, current ${snapshot.revision}`);
    if (input.target.projectId !== snapshot.scope.projectId || input.target.branchId !== snapshot.scope.branchId) fail('SCOPE_MISMATCH', 'Import target does not match snapshot');
    const seen = new Set<string>(), projected = new Map(snapshot.files), changes: FileChange[] = [];
    for (const file of input.files) {
      const isLayoutPatch = file.path === 'app/layout.tsx' && (
        file.cursorPortal === true ||
        file.smoothScroll === true ||
        file.favicon !== undefined ||
        file.faviconDark !== undefined ||
        file.siteTitle !== undefined ||
        file.siteDescription !== undefined ||
        file.socialImage !== undefined ||
        file.siteLanguage !== undefined
      );
      if (!isLayoutPatch) assertNativeFamily(file.path);
      if (seen.has(file.path)) fail('DUPLICATE_FILE_CHANGE', file.path);
      seen.add(file.path);
      const existing = snapshot.files.get(file.path);
      const tokenPatch = file.path === 'app/globals.css';
      const smoothScrollPatch = file.path === SMOOTH_SCROLL_DATA_PATH || file.path === SMOOTH_SCROLL_CONTROLLER_PATH;
      if (isLayoutPatch) {
        let expected = existing;
        if (expected !== undefined && file.cursorPortal) expected = ensureCursorPortalInLayout(expected);
        if (expected !== undefined && file.smoothScroll) expected = ensureSmoothScrollInLayout(expected);
        const validUrl = (value: string) => {
          try { const url = new URL(value, 'https://revyme.invalid'); return (value.startsWith('/api/uploads/') || value.startsWith('/assets/') || value.startsWith('https://')) && url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
        };
        if (file.siteTitle !== undefined || file.siteDescription !== undefined || file.socialImage !== undefined) {
          if (file.socialImage && !validUrl(file.socialImage)) expected = undefined;
          else if (expected !== undefined) {
            expected = updateMetadataInCode(expected, {
              ...(file.siteTitle !== undefined ? { title: file.siteTitle } : {}),
              ...(file.siteDescription !== undefined ? { description: file.siteDescription } : {}),
              ...(file.socialImage !== undefined ? { openGraph: { images: [file.socialImage] } } : {}),
            });
          }
        }
        if (file.favicon) expected = validUrl(file.favicon) && (!file.faviconDark || validUrl(file.faviconDark)) && expected !== undefined ? updateNativeFavicon(expected, file.favicon, file.faviconDark) : undefined;
        else if (file.faviconDark) expected = undefined;
        if (file.siteLanguage !== undefined && expected !== undefined) {
          expected = updateSiteConfigInCode(expected, { language: file.siteLanguage });
        }
        if (existing === undefined || file.baseCode !== existing || file.code === existing || expected !== file.code || (file.cursorPortal && !hasNativeCursorPortal(file.code)) || (file.smoothScroll && !file.code.includes('<SmoothScroll')) || file.colorTokens || file.typographyTokens || file.fontFaces || file.googleFonts) fail('CURSOR_PORTAL_PATCH_INVALID', file.path);
      } else if (file.cursorPortal || file.smoothScroll || file.favicon !== undefined || file.faviconDark !== undefined || file.siteTitle !== undefined || file.siteDescription !== undefined || file.socialImage !== undefined || file.siteLanguage !== undefined) fail('CURSOR_PORTAL_PATCH_INVALID', file.path);
      else if (tokenPatch) {
        if (!(file.colorTokens?.length || file.typographyTokens?.length || file.fontFaces?.length || file.googleFonts?.length) || file.baseCode !== existing || addGoogleFontImportsToCss(applyFramerFontFaces(applyFramerTypographyTokens(applyFramerColorTokens(existing ?? '', file.colorTokens ?? []), file.typographyTokens ?? []), file.fontFaces ?? []), file.googleFonts ?? []) !== file.code) fail('FRAMER_TOKEN_PATCH_INVALID', file.path);
      } else if (smoothScrollPatch) {
        if (file.baseCode !== existing || file.colorTokens !== undefined || file.typographyTokens !== undefined || file.fontFaces !== undefined || file.googleFonts !== undefined) fail('SMOOTH_SCROLL_PATCH_INVALID', file.path);
        if (file.path === SMOOTH_SCROLL_CONTROLLER_PATH && file.code !== SMOOTH_SCROLL_CONTROLLER_SOURCE) fail('SMOOTH_SCROLL_PATCH_INVALID', file.path);
        if (file.path === SMOOTH_SCROLL_DATA_PATH) {
          const parsed = parseSmoothScroll(file.code);
          if (serializeSmoothScroll(parsed) !== file.code) fail('SMOOTH_SCROLL_PATCH_INVALID', file.path);
        }
      } else if (file.baseCode !== undefined || file.colorTokens !== undefined || file.typographyTokens !== undefined || file.fontFaces !== undefined || file.googleFonts !== undefined) fail('FRAMER_TOKEN_PATCH_INVALID', file.path);
      if (existing !== undefined) {
        if (input.mode === 'create' && !tokenPatch && !isLayoutPatch && !smoothScrollPatch) fail('ALREADY_EXISTS', file.path);
        if (input.mode === 'paste' && file.path !== input.target.filePath) fail('PASTE_TARGET_CONFLICT', file.path);
        if (!tokenPatch && !isLayoutPatch && !smoothScrollPatch) {
          if (!file.baseHash) fail('BASE_HASH_REQUIRED', file.path);
          if (sha256(existing) !== file.baseHash) fail('CAS_CONFLICT', file.path);
        }
      } else if (file.baseHash !== undefined) fail('CAS_CONFLICT', `Expected existing file ${file.path}`);
      changes.push({ path: file.path, content: file.code, beforeHash: existing === undefined ? null : sha256(existing) });
      projected.set(file.path, file.code);
    }
    if (input.mode === 'paste') {
      const { filePath, parentNodeId } = input.target;
      if (!filePath || !parentNodeId || !seen.has(filePath) || !oracleFileKind(filePath, projected.get(filePath)!)) fail('PASTE_TARGET_INVALID', 'An existing native canvas file and parent node are required');
      const before = snapshot.files.get(filePath);
      if (before === undefined) fail('PASTE_TARGET_INVALID', filePath);
      const previousIds = nodeIds(before, filePath), nextIds = nodeIds(projected.get(filePath)!, filePath);
      if (!previousIds.has(parentNodeId) || [...previousIds].some(id => !nextIds.has(id))) fail('PASTE_PRESERVATION_FAILED', 'Existing nodes and the insertion parent must survive paste');
    }
    const createdIds = new Set<string>();
    for (const file of input.files) {
      const kind = oracleFileKind(file.path, file.code);
      if (kind) {
        if (kind !== 'code-component' && isCodeComponentSource(file.code)) fail('SOURCE_KIND_MISMATCH', file.path);
        const violations = checkFile(file.code, { kind, path: file.path, projectFiles: new Set(projected.keys()) });
        if (violations.length) fail('ORACLE_VIOLATION', `${file.path}: ${violations.map(v => `[${v.code}] ${v.message}`).join(' | ')}`);
        const previous = snapshot.files.get(file.path);
        const oldIds = previous === undefined ? new Set<string>() : nodeIds(previous, file.path);
        for (const id of nodeIds(file.code, file.path)) if (!oldIds.has(id)) createdIds.add(id);
      } else if (file.path.startsWith('overrides/')) validateNativeOverrideSource(file.code);
      else if (file.path.endsWith('/page-effects-runtime.ts')) {
        if (file.code !== PAGE_EFFECTS_RUNTIME_SOURCE || !projected.has(file.path.replace(/page-effects-runtime\.ts$/, 'LayoutClient.tsx'))) fail('PAGE_EFFECTS_RUNTIME_INVALID', file.path);
      } else if (file.path.endsWith('/page-transitions.tsx')) {
        if (file.code !== PAGE_TRANSITIONS_SOURCE || !projected.has(file.path.replace(/page-transitions\.tsx$/, 'LayoutClient.tsx'))) fail('PAGE_TRANSITIONS_RUNTIME_INVALID', file.path);
      } else if (file.path.endsWith('/page-effects.ts')) {
        const parsed = parsePageEffects(file.code);
        if (isEmptyPageEffects(parsed) || serializePageEffects(parsed) !== file.code || !projected.has(file.path.replace(/page-effects\.ts$/, 'LayoutClient.tsx')) || !projected.has(file.path.replace(/page-effects\.ts$/, 'page-effects-runtime.ts')) || !projected.has(file.path.replace(/page-effects\.ts$/, 'page-transitions.tsx'))) fail('PAGE_EFFECTS_CONFIG_INVALID', file.path);
      } else if (file.path === FORM_ROUTE_PATH) {
        if (file.code !== FORM_ROUTE_CONTENT || snapshot.files.has(file.path) || !input.files.some(candidate => /^(?:page|template)$/.test(oracleFileKind(candidate.path, candidate.code) ?? '') && /<(?:motion\.)?form\b/.test(candidate.code))) fail('FORM_ROUTE_INVALID', file.path);
      } else if (file.path !== 'app/layout.tsx' && /\/(?:page|layout)\.tsx$/.test(file.path)) validateWrapper(file.path, file.code, projected);
    }
    for (const id of validateFramerImportCms(projected, seen)) createdIds.add(id);
    // Reuse the ordinary syntax, duplicate data-id and projected import checks as well as later commit CAS.
    const plan = createPlan({ scope: snapshot.scope, baseRevision: snapshot.revision, operationId: 'imports.framer.submit.validate', changes });
    const validation = validatePlan(snapshot, plan);
    if (!validation.ok) fail('IMPORT_PLAN_INVALID', validation.issues.map(issue => `[${issue.code}] ${issue.message}`).join(' | '));
    context.trace('framer-import.prepared', { files: changes.length, createdIds: createdIds.size });
    return { changes, createdIds: [...createdIds], diagnostics: [] };
  },
};
// Vite can reload this validator while retaining the registry singleton.
const registeredFramerImport = defaultRegistry.get(framerImportSubmitDefinition.name);
if (registeredFramerImport && registeredFramerImport.ownerTask !== framerImportSubmitDefinition.ownerTask) throw new Error('FRAMER_OPERATION_OWNER_MISMATCH');
export const framerImportSubmitOperation = registeredFramerImport
  ? Object.assign(registeredFramerImport, framerImportSubmitDefinition) as Operation<FramerImportSubmitInput, FramerImportSubmitOutput>
  : framerImportSubmitDefinition;
if (!registeredFramerImport) defaultRegistry.register(framerImportSubmitOperation);
