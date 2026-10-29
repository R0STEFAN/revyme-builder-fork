// src/editor/left-toolbar/panels/AuditPanel.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'jotai';
import { createStore } from 'jotai';
import AuditPanel from './AuditPanel';
import AuditHeaderPill from '@/editor/header/AuditHeaderPill';
import {
  auditResultAtom,
  auditScopeFilterAtom,
  auditSeverityFilterAtom,
} from '@/code/stores/site-audit-store';
import { leftPanelAtom } from '@/code/stores/left-panel-store';
import { settingsOverlayOpenAtom, selectedSeoPageAtom, settingsSectionAtom } from '@/code/stores/website-settings-store';
import type { AuditResult } from '@/code/audit/core/types';

describe('Site Audit: Editor UI Components', () => {
  const mockResult: AuditResult = {
    summary: {
      total: 3,
      bySeverity: { error: 1, warning: 1, info: 1 },
      byScope: { accessibility: 1, seo: 1, performance: 0, security: 1, 'clean-code': 0 },
      scores: {
        accessibility: 80,
        seo: 85,
        performance: 100,
        bestPractices: 95,
      },
    },
    findings: [
      {
        id: 'accessibility/missing-alt/root_img1',
        scope: 'accessibility',
        ruleId: 'missing-alt',
        severity: 'error',
        title: 'Missing image alt attribute',
        message: '<img> lacks an alt attribute.',
        explanation: 'Images must provide alt text.',
        remediation: 'Add alt=""',
        location: { pagePath: 'app/page.tsx', nodeId: 'img-1', tag: 'img' },
        canAutoFix: true,
      },
      {
        id: 'seo/empty-page-title/root',
        scope: 'seo',
        ruleId: 'empty-page-title',
        severity: 'warning',
        title: 'Missing or empty page title',
        message: 'Page lacks a title.',
        explanation: 'Page needs title.',
        remediation: 'Provide title in metadata.',
        location: { pagePath: 'app/(main)/blog/page.client.tsx', route: '/blog' },
        canAutoFix: true,
      },
      {
        id: 'security/target-blank-without-noopener/root_link1',
        scope: 'security',
        ruleId: 'target-blank-without-noopener',
        severity: 'info',
        title: 'External link opens in new tab without rel="noopener"',
        message: 'Link lacks rel="noopener".',
        explanation: 'Add noopener.',
        remediation: 'Add rel="noopener noreferrer"',
        location: { pagePath: 'app/page.tsx', nodeId: 'link-1', tag: 'a' },
        canAutoFix: true,
      },
    ],
    skippedChecks: [],
  };

  it('renders score overview, findings list, and counters', () => {
    const store = createStore();
    store.set(auditResultAtom, mockResult);

    render(
      <Provider store={store}>
        <AuditPanel />
      </Provider>
    );

    expect(screen.getByText('Site Audit')).toBeDefined();
    expect(screen.getByText('80')).toBeDefined(); // A11y score
    expect(screen.getByText('85')).toBeDefined(); // SEO score
    expect(screen.getByText('Missing image alt attribute')).toBeDefined();
    expect(screen.getByText('Missing or empty page title')).toBeDefined();
    expect(screen.getAllByText('Fix').length).toBeGreaterThan(0);
  });

  it('filters findings by scope tab when clicked', () => {
    const store = createStore();
    store.set(auditResultAtom, mockResult);

    render(
      <Provider store={store}>
        <AuditPanel />
      </Provider>
    );

    // Click SEO tab
    const seoTab = screen.getByRole('button', { name: 'SEO' });
    fireEvent.click(seoTab);

    // Only SEO finding is visible now
    expect(screen.queryByText('Missing image alt attribute')).toBeNull();
    expect(screen.getByText('Missing or empty page title')).toBeDefined();
  });

  it('header pill displays error and warning counters and opens audit panel on click', () => {
    const store = createStore();
    store.set(auditResultAtom, mockResult);

    render(
      <Provider store={store}>
        <AuditHeaderPill />
      </Provider>
    );

    expect(screen.getAllByText('1')).toHaveLength(2); // 1 error, 1 warning

    // Clicking the pill switches leftPanelAtom to 'audit'
    const button = screen.getByRole('button');
    fireEvent.click(button);

    expect(store.get(leftPanelAtom)).toBe('audit');
  });

  it('renders page route badges and appropriate navigation buttons (Focus vs Page Settings)', () => {
    const store = createStore();
    store.set(auditResultAtom, mockResult);

    render(
      <Provider store={store}>
        <AuditPanel />
      </Provider>
    );

    // Finding on blog displays /blog badge
    expect(screen.getByText('📄 /blog')).toBeDefined();

    // Finding with nodeId has Focus button
    expect(screen.getAllByText('Focus').length).toBeGreaterThan(0);

    // SEO finding without nodeId has Page Settings button
    const pageSettingsBtn = screen.getByText('Page Settings');
    expect(pageSettingsBtn).toBeDefined();

    // Clicking Page Settings opens the settings overlay preselected to that page
    fireEvent.click(pageSettingsBtn);
    expect(store.get(settingsOverlayOpenAtom)).toBe(true);
    expect(store.get(settingsSectionAtom)).toBe('pages');
    expect(store.get(selectedSeoPageAtom)).toBe('app/(main)/blog/page.client.tsx');
  });
});
