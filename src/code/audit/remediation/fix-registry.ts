// src/code/audit/remediation/fix-registry.ts
// Concrete codegen remediation implementations for fixable audit rule IDs.

import type { AuditFinding } from '../core/types';
import { updateHtmlAttrsInCode, changeTagInCode } from '@/code/generation/generator-attrs';
import { updateMetadataInCode } from '@/code/generation/metadata-gen';
import { trace } from '@/shared/debug-trace';

export type FixHandler = (code: string, finding: AuditFinding) => string | null;

export const FIX_REGISTRY: Record<string, FixHandler> = {
  // ─── Accessibility ───────────────────────────────────────────────────────
  'missing-alt': (code, finding) => {
    if (!finding.location.nodeId) return null;
    return updateHtmlAttrsInCode(code, finding.location.nodeId, { alt: '""' });
  },

  'missing-image-input-alt': (code, finding) => {
    if (!finding.location.nodeId) return null;
    return updateHtmlAttrsInCode(code, finding.location.nodeId, { alt: 'Submit' });
  },

  'missing-iframe-title': (code, finding) => {
    if (!finding.location.nodeId) return null;
    return updateHtmlAttrsInCode(code, finding.location.nodeId, { title: 'Embedded frame' });
  },

  'missing-accessible-name': (code, finding) => {
    if (finding.location.nodeId) {
      return updateHtmlAttrsInCode(code, finding.location.nodeId, { 'aria-label': 'Action' });
    }
    const tag = finding.location.tag || 'button';
    const re = new RegExp(`<${tag}(?![^>]*aria-label)`);
    if (re.test(code)) {
      return code.replace(re, `<${tag} aria-label="Action"`);
    }
    return null;
  },

  'missing-form-label': (code, finding) => {
    if (finding.location.nodeId) {
      return updateHtmlAttrsInCode(code, finding.location.nodeId, { 'aria-label': 'Input field' });
    }
    const tag = finding.location.tag || 'select';
    const isLocale = finding.location.pagePath?.includes('LocaleSwitcher') || code.includes('LocaleSwitcher');
    const label = isLocale ? 'Select language' : tag === 'select' ? 'Select option' : 'Input field';
    const re = new RegExp(`<${tag}(?![^>]*aria-label)`);
    if (re.test(code)) {
      return code.replace(re, `<${tag} aria-label="${label}"`);
    }
    return null;
  },

  'positive-tabindex': (code, finding) => {
    if (!finding.location.nodeId) return null;
    return updateHtmlAttrsInCode(code, finding.location.nodeId, { tabIndex: '0' });
  },

  'aria-hidden-focusable': (code, finding) => {
    if (!finding.location.nodeId) return null;
    return updateHtmlAttrsInCode(code, finding.location.nodeId, { 'aria-hidden': '' });
  },

  'multiple-page-headings': (code, finding) => {
    if (!finding.location.nodeId) return null;
    return changeTagInCode(code, finding.location.nodeId, 'h2');
  },

  'skipped-heading-level': (code, finding) => {
    if (!finding.location.nodeId) return null;
    const newTag = (finding.suggestedFix?.patch?.newTag as string) || 'h2';
    return changeTagInCode(code, finding.location.nodeId, newTag);
  },

  // ─── SEO & Metadata ──────────────────────────────────────────────────────
  'empty-page-title': (code, finding) => {
    const title = (finding.suggestedFix?.patch?.title as string) || 'Revyme Page';
    return updateMetadataInCode(code, { title });
  },

  'missing-page-description': (code, finding) => {
    const description =
      (finding.suggestedFix?.patch?.description as string) ||
      'Discover products, services, and insights on this page.';
    return updateMetadataInCode(code, { description });
  },

  'missing-canonical': (code, finding) => {
    const rawCanonical = (finding.suggestedFix?.patch?.canonical as string);
    const canonical = rawCanonical || (finding.location.pagePath ? `/${finding.location.pagePath.replace(/^app\/?/, '').replace(/\/page\.(tsx|client\.tsx)$/, '')}` : '/');
    return updateMetadataInCode(code, { alternates: { canonical } });
  },

  'invalid-page-language': (code, finding) => {
    if (finding.location.nodeId) {
      return updateHtmlAttrsInCode(code, finding.location.nodeId, { lang: 'en' });
    }
    // Fallback: inject lang="en" in <html ...> tag
    if (code.includes('<html')) {
      return code.replace(/<html(\s+[^>]*)?>/, (match, attrs) => {
        if (!attrs) return '<html lang="en">';
        if (attrs.includes('lang=')) return match.replace(/lang="[^"]*"/, 'lang="en"');
        return `<html lang="en"${attrs}>`;
      });
    }
    return null;
  },

  'missing-json-ld-context': (code) => {
    if (code.includes('"@type"') && !code.includes('"@context"')) {
      return code.replace(/"@type"/, '"@context": "https://schema.org",\n    "@type"');
    }
    return null;
  },

  // ─── Security ────────────────────────────────────────────────────────────
  'target-blank-without-noopener': (code, finding) => {
    if (!finding.location.nodeId) return null;
    return updateHtmlAttrsInCode(code, finding.location.nodeId, { rel: 'noopener noreferrer' });
  },

  'dangerous-external-link': (code, finding) => {
    if (!finding.location.nodeId) return null;
    const httpsHref = finding.suggestedFix?.patch?.href as string;
    if (httpsHref) {
      return updateHtmlAttrsInCode(code, finding.location.nodeId, { href: httpsHref });
    }
    return null;
  },

  // ─── Performance ─────────────────────────────────────────────────────────
  'missing-image-dimensions': (code, finding) => {
    if (!finding.location.nodeId) return null;
    return updateHtmlAttrsInCode(code, finding.location.nodeId, { width: '100%', height: 'auto' });
  },

  'eager-below-fold-image': (code, finding) => {
    if (!finding.location.nodeId) return null;
    return updateHtmlAttrsInCode(code, finding.location.nodeId, { loading: 'lazy' });
  },

  'missing-lcp-priority': (code, finding) => {
    if (!finding.location.nodeId) return null;
    return updateHtmlAttrsInCode(code, finding.location.nodeId, { priority: 'true', loading: '' });
  },
};

export function canRemediateFinding(ruleId: string): boolean {
  return Boolean(FIX_REGISTRY[ruleId]);
}
