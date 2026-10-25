// oracle/checks/image-source.ts — image asset isolation rules.
// Enforces that images must either be:
// 1) An external link (URL: https://..., http://..., data:image/..., blob:...)
// 2) An uploaded asset of this specific project (e.g. /api/uploads/..., /uploads/...)
// 3) An asset residing in the project's ProjectFS
//
// Arbitrary local filesystem paths outside this project (such as /images/...)
// are strictly forbidden.

import * as t from '@babel/types';
import { traverse, jsxTagName, jsxAttrs, stringAttr } from './shared';
import type { OracleViolation } from './shared';

export const IMAGE_ATTR_KEYS = new Set(['src', 'image', 'thumbnail', 'avatar', 'poster']);

/**
 * Checks whether an image source string conforms to project isolation rules.
 */
export function isAllowedImageSource(src: string, projectFiles?: Set<string>): boolean {
  const s = src.trim();
  if (!s) return true;
  // External URLs, protocol-relative, data URIs, blob URIs
  if (/^(https?:|\/\/|data:image\/|blob:)/i.test(s)) return true;
  // Project-scoped uploads
  if (/^(?:\/api)?\/uploads\//.test(s)) return true;
  // Project-scoped files in ProjectFS
  if (projectFiles) {
    const clean = s.replace(/^\//, '');
    if (projectFiles.has(clean) || projectFiles.has(s)) return true;
    // Next serves files under public/ from the site root (public/assets/x -> /assets/x).
    if (projectFiles.has(`public/${clean}`) || (s.startsWith('/') && projectFiles.has(`public${s}`))) return true;
  }
  // All other relative or absolute host paths (e.g. /images/...) are blocked
  return false;
}

/**
 * Extracts URL target from CSS url(...) function.
 */
export function extractCssUrl(value: string): string | null {
  const m = value.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/i);
  return m ? m[1] : null;
}

/**
 * AST check: ensures all static image sources in JSX components, img tags,
 * and inline styles comply with the image isolation rule.
 */
export function checkImageSourceDialect(
  ast: t.File,
  v: OracleViolation[],
  projectFiles?: Set<string>
): void {
  traverse(ast, {
    JSXElement(path) {
      const opening = path.node.openingElement;
      const tag = jsxTagName(opening.name);
      const attrs = jsxAttrs(opening);
      const id = stringAttr(attrs, 'data-id');
      const line = opening.loc?.start.line;

      // 1. Check attributes / props (src, image, thumbnail, avatar, poster)
      for (const attr of attrs) {
        const attrName = t.isJSXIdentifier(attr.name) ? attr.name.name : null;
        if (!attrName || !IMAGE_ATTR_KEYS.has(attrName)) continue;
        if (!attr.value || !t.isStringLiteral(attr.value)) continue; // dynamic expressions are exempt
        const src = attr.value.value;
        if (!isAllowedImageSource(src, projectFiles)) {
          v.push({
            code: 'INVALID_IMAGE_SOURCE',
            tier: 2,
            line,
            elementId: id,
            message: `<${tag}>${id ? ` (data-id="${id}")` : ''} has invalid ${attrName}="${src}". Image assets must either be an external link (URL: https://...) or uploaded directly into this project via upload (e.g. /api/uploads/...). Arbitrary local filesystem paths outside this project (such as /images/...) are forbidden.`,
          });
        }
      }

      // 2. Check inline styles (backgroundImage, background)
      const styleAttr = attrs.find((a) => t.isJSXIdentifier(a.name) && a.name.name === 'style');
      if (
        styleAttr?.value?.type === 'JSXExpressionContainer' &&
        t.isObjectExpression(styleAttr.value.expression)
      ) {
        for (const prop of styleAttr.value.expression.properties) {
          if (!t.isObjectProperty(prop)) continue;
          const propKey = t.isIdentifier(prop.key)
            ? prop.key.name
            : t.isStringLiteral(prop.key)
            ? prop.key.value
            : '';
          if (propKey !== 'backgroundImage' && propKey !== 'background') continue;
          if (!t.isStringLiteral(prop.value)) continue;

          const rawCss = prop.value.value;
          const extractedUrl = extractCssUrl(rawCss);
          if (extractedUrl && !isAllowedImageSource(extractedUrl, projectFiles)) {
            v.push({
              code: 'INVALID_IMAGE_SOURCE',
              tier: 2,
              line,
              elementId: id,
              message: `<${tag}>${id ? ` (data-id="${id}")` : ''} has invalid ${propKey} url "${extractedUrl}". Image assets must either be an external link (URL: https://...) or uploaded directly into this project via upload (e.g. /api/uploads/...). Arbitrary local filesystem paths outside this project (such as /images/...) are forbidden.`,
            });
          }
        }
      }
    },
  });
}
