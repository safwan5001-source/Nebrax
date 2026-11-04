// @vitest-environment jsdom
import * as React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

import { NotAppliedNotice } from './not-applied-notice';

const root = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

describe('COPS-H4-7 — legacy sales settings labelled as not in effect', () => {
  afterEach(cleanup);

  it('renders a note that states the screen has no effect', () => {
    render(<NotAppliedNotice />);
    const note = screen.getByRole('note');
    expect(note.textContent).toContain('not_applied_badge');
    expect(note.textContent).toContain('not_applied_notice');
  });

  it.each(['orders', 'shipping'])('the %s page shows the notice and still renders its original editor (no data removed)', (page) => {
    const source = read(`app/(app)/sales-settings/${page}/page.tsx`);
    expect(source).toContain('<NotAppliedNotice />');
    expect(source).toMatch(page === 'orders' ? /<ConfigForm\b/ : /<ConfigListEditor\b/);
    expect(source).toContain(`section="${page}"`);
  });

  it('the hub marks exactly the two dead settings (and nothing else) with the badge', () => {
    const source = read('app/(app)/sales-settings/page.tsx');
    const marked = [...source.matchAll(/key: '(c_[a-z]+)'[^}]*notApplied: true/g)].map((m) => m[1]);
    expect(marked.sort()).toEqual(['c_orders', 'c_shipping']);
    expect(source).toContain("t('not_applied_badge')");
  });

  it('has Arabic and English copy for both keys, and says where the real control lives', () => {
    for (const locale of ['ar', 'en']) {
      const messages = JSON.parse(read(`messages/${locale}.json`)) as { salesSettings: Record<string, string> };
      expect(messages.salesSettings.not_applied_badge.length).toBeGreaterThan(0);
      expect(messages.salesSettings.not_applied_notice.length).toBeGreaterThan(20);
    }
    const en = JSON.parse(read('messages/en.json')) as { salesSettings: Record<string, string> };
    expect(en.salesSettings.not_applied_notice).toContain('Store settings');
  });
});
