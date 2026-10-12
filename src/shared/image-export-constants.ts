// image-export-constants.ts — standalone scripts and utility sources bundled into exported sites.
// Kept in src/shared/ with zero dependencies so server and build tooling can consume them safely.

export const IMAGE_UTILS_TS = `export const RESPONSIVE_IMAGE_WIDTHS = [320, 640, 768, 1024, 1280, 1920] as const;

export function inferImageSizes(options?: { width?: string | number | null; maxWidth?: string | number | null } | null): string {
  if (!options) return '100vw';

  const parsePx = (val: string | number | null | undefined): number | null => {
    if (typeof val === 'number') return val > 0 ? val : null;
    if (typeof val === 'string') {
      const match = val.trim().match(/^(\\d+(?:\\.\\d+)?)\\s*px$/i);
      if (match) {
        const n = parseFloat(match[1]);
        return n > 0 ? Math.round(n) : null;
      }
      if (/^\\d+(?:\\.\\d+)?$/.test(val.trim())) {
        const n = parseFloat(val.trim());
        return n > 0 ? Math.round(n) : null;
      }
    }
    return null;
  };

  const widthPx = parsePx(options.width);
  const maxWidthPx = parsePx(options.maxWidth);

  if (widthPx !== null) {
    if (widthPx <= 320) return \`\${widthPx}px\`;
    return \`(max-width: \${widthPx}px) 100vw, \${widthPx}px\`;
  }

  if (maxWidthPx !== null) {
    if (maxWidthPx <= 320) return \`\${maxWidthPx}px\`;
    return \`(max-width: \${maxWidthPx}px) 100vw, \${maxWidthPx}px\`;
  }

  if (typeof options.width === 'string') {
    const trimmed = options.width.trim();
    const percentMatch = trimmed.match(/^(\\d+(?:\\.\\d+)?)\\s*%$/);
    if (percentMatch) {
      const pct = parseFloat(percentMatch[1]);
      if (pct > 0 && pct < 100) {
        const vwVal = Math.round(pct);
        return \`(max-width: 768px) 100vw, \${vwVal}vw\`;
      }
    }
    const vwMatch = trimmed.match(/^(\\d+(?:\\.\\d+)?)\\s*vw$/i);
    if (vwMatch) {
      const vw = parseFloat(vwMatch[1]);
      if (vw > 0 && vw < 100) {
        const vwVal = Math.round(vw);
        return \`(max-width: 768px) 100vw, \${vwVal}vw\`;
      }
    }
  }

  return '100vw';
}

export function getUploadSrcSet(src: string | undefined | null): string | undefined {
  if (!src || typeof src !== 'string') return undefined;
  if (!src.startsWith('/uploads/') && !src.startsWith('/api/uploads/')) return undefined;
  const clean = src.split('?')[0].split('#')[0];
  const lastDot = clean.lastIndexOf('.');
  if (lastDot === -1) return undefined;
  const basePath = clean.slice(0, lastDot);
  const widths = [320, 640, 768, 1024, 1280, 1920];
  return widths.map(w => \`\${basePath}-\${w}w.webp \${w}w\`).join(', ');
}
`;

export const OPTIMIZE_IMAGES_SCRIPT = `import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const WIDTHS = [320, 640, 768, 1024, 1280, 1920];
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const RESPONSIVE_VARIANT_RE = /-\\d+w\\.webp$/;

async function optimizeDirectory(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await optimizeDirectory(fullPath);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!IMAGE_EXTS.has(ext)) continue;
      if (RESPONSIVE_VARIANT_RE.test(entry.name)) continue;

      const baseName = entry.name.slice(0, -ext.length);
      let fileStat;
      try {
        fileStat = fs.statSync(fullPath);
      } catch {
        continue;
      }

      for (const w of WIDTHS) {
        const outName = \`\${baseName}-\${w}w.webp\`;
        const outPath = path.join(dir, outName);

        try {
          if (fs.existsSync(outPath)) {
            const outStat = fs.statSync(outPath);
            if (outStat.mtimeMs >= fileStat.mtimeMs) {
              continue;
            }
          }

          await sharp(fullPath)
            .rotate()
            .resize(w, null, { withoutEnlargement: true })
            .webp({ quality: 82 })
            .toFile(outPath);
        } catch (err) {
          console.warn(\`[optimize-images] Skipping \${entry.name} (\${w}w):\`, err?.message || err);
        }
      }
    }
  }
}

async function main() {
  const dirs = [
    path.resolve(process.cwd(), 'public/uploads'),
    path.resolve(process.cwd(), 'public/api/uploads'),
  ];

  for (const dir of dirs) {
    if (fs.existsSync(dir)) {
      await optimizeDirectory(dir);
    }
  }
}

main().catch((err) => {
  console.error('[optimize-images] Fatal error:', err);
  process.exit(1);
});
`;
