/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatRiyal } from '@/lib/money';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import PlatformDashboardPage from './page';

// H15-07: every description list on the platform dashboard must follow the HTML content model
// (axe: definition-list, dlitem). Same mocks as page.test.tsx; the translators are stable per locale like next-intl's.
const replace = vi.fn();
const platformApi = vi.fn();
let locale: 'ar' | 'en' = 'en';

function makeTranslator(lang: 'ar' | 'en') {
  return (key: string, values?: Record<string, string | number>) => {
    const text = ((lang === 'ar' ? ar : en).platform as Record<string, unknown>)[key];
    if (typeof text !== 'string') throw new Error(`missing platform message: ${key}`);
    return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? ''));
  };
}
const translators = { ar: makeTranslator('ar'), en: makeTranslator('en') };
vi.mock('next-intl', () => ({ useTranslations: () => translators[locale] }));
const router = { replace };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/platform-auth', () => ({
  isPlatformAuthenticated: () => true,
  currentPlatformAdministrator: () => ({ id: '1', name: 'Admin', email: 'a@b.c' }),
}));
vi.mock('@/lib/platform-api', () => ({ platformApi: (...args: unknown[]) => platformApi(...args) }));
vi.mock('@/lib/api', () => ({ ApiError: class ApiError extends Error {} }));

const overview = {
  data: {
    tenants: { total: 12, active: 9, inactive: 3 },
    users: { total: 140, active: 120, inactive: 20 },
    subscriptions: {
      active: 8, trials: 4, renewals_next_7_days: 1, renewals_next_30_days: 3, renewals_next_60_days: 5,
      renewal_value_at_risk_minor: 1234500, renewal_value_at_risk: '12345.00',
      monthly_recurring_revenue_minor: 987650, monthly_recurring_revenue: '9876.50',
      annual_recurring_revenue_minor: 11851800, annual_recurring_revenue: '118518.00',
      average_active_subscription_minor: 123456, average_active_subscription: '1234.56',
      by_plan: [{ plan: 'starter', active: 5, monthly_recurring_revenue_minor: 250000, monthly_recurring_revenue: '2500.00' }],
    },
  },
};

beforeEach(() => {
  replace.mockClear();
  platformApi.mockReset();
  platformApi.mockResolvedValue(overview);
  locale = 'en';
});
afterEach(cleanup);

async function renderLoaded() {
  const utils = render(<PlatformDashboardPage />);
  await screen.findByText(formatRiyal('9876.50'));
  return utils;
}

/**
 * HTML content model for <dl>: its children are either (dt+ dd+)* directly, or `div` groups that contain only dt+ then dd+
 * (axe `definition-list` and `dlitem`). Returns the problems found; an empty list means valid.
 */
function dlProblems(dl: Element): string[] {
  const problems: string[] = [];
  const checkRun = (nodes: Element[], where: string): void => {
    let seenDd = false;
    let seenDt = false;
    for (const node of nodes) {
      const tag = node.tagName.toLowerCase();
      if (tag === 'dt') {
        if (seenDd) { seenDt = true; seenDd = false; } else seenDt = true;
      } else if (tag === 'dd') {
        if (!seenDt) problems.push(`${where}: dd without a preceding dt`);
        seenDd = true;
      } else {
        problems.push(`${where}: <${tag}> is not allowed here`);
      }
    }
    if (nodes.length > 0 && !seenDd) problems.push(`${where}: dt without a dd`);
  };
  const direct = [...dl.children].filter((child) => child.tagName.toLowerCase() !== 'div');
  const groups = [...dl.children].filter((child) => child.tagName.toLowerCase() === 'div');
  if (direct.length > 0) checkRun(direct, 'dl');
  for (const group of groups) {
    if (group.querySelector(':scope > div, :scope > span, :scope > p, :scope > section')) problems.push('div group holds a nested/non-dt-dd child');
    checkRun([...group.children], 'div group');
    if (group.querySelectorAll(':scope > dt').length === 0) problems.push('div group without a dt');
  }
  return problems;
}

/** [term, ...descriptions] for each group, in document order, from the rendered markup. */
function pairs(dl: Element): string[][] {
  const text = (e: Element) => (e.textContent ?? '').replace(/\s+/g, ' ').trim();
  const groups = [...dl.children].every((c) => c.tagName.toLowerCase() === 'div') ? [...dl.children].map((g) => [...g.children]) : [[...dl.children]];
  return groups.map((children) => {
    const out: string[] = [];
    for (const child of children) {
      if (child.tagName.toLowerCase() === 'dt') out.push(text(child)); else out.push(text(child));
    }
    return out;
  });
}

describe('platform dashboard description lists are valid HTML (H15-07)', () => {
  it('the validator catches the former markup (nested div and span inside a dl group)', () => {
    const host = document.createElement('div');
    host.innerHTML = '<dl><div><div><dt>Term</dt><dd>Desc</dd></div><span>Shown</span></div></dl>';
    expect(dlProblems(host.querySelector('dl')!).length).toBeGreaterThan(0);
    host.innerHTML = '<dl><div><dt>Term</dt><dd>Desc</dd><dd>Shown</dd></div></dl>';
    expect(dlProblems(host.querySelector('dl')!)).toEqual([]);
    host.innerHTML = '<dl><span>x</span></dl>';
    expect(dlProblems(host.querySelector('dl')!).length).toBeGreaterThan(0);
  });

  for (const lang of ['en', 'ar'] as const) {
    it(`every dl on the page follows the content model (${lang})`, async () => {
      locale = lang;
      const { container } = await renderLoaded();
      const lists = [...container.querySelectorAll('dl')];
      expect(lists.length).toBe(6); // revenue scope, 2 account cards, subscriptions, renewals (x2)
      for (const dl of lists) expect(dlProblems(dl)).toEqual([]);
      // nothing but dt/dd groups: no span/p/div as a direct child of a group, no dt/dd outside a dl
      expect(container.querySelectorAll('dl > div > div, dl > div > span, dl > span, dl > div > p').length).toBe(0);
      expect([...container.querySelectorAll('dt, dd')].every((node) => node.closest('dl'))).toBe(true);
      expect([...container.querySelectorAll('dt')].every((node) => node.parentElement && (node.parentElement.tagName === 'DL' || node.parentElement.parentElement?.tagName === 'DL'))).toBe(true);
    });
  }

  it('each name stays tied to its value, in the same order, with the same values (English)', async () => {
    const { container } = await renderLoaded();
    const m = en.platform;
    const all = [...container.querySelectorAll('dl')].map(pairs);
    expect(all[0]).toEqual([
      [m.scopeContracted, m.scopeContractedDesc, m.scopeShown],
      [m.scopeInvoiced, m.scopeInvoicedDesc, m.scopeNotReported],
      [m.scopeCollected, m.scopeCollectedDesc, m.scopeNotReported],
    ]);
    expect(all[1]).toEqual([[m.active, '9'], [m.inactive, '3']]);
    expect(all[2]).toEqual([[m.active, '120'], [m.inactive, '20']]);
    expect(all[3]).toEqual([[m.trials, '4']]);
    expect(all[4]).toEqual([[m.renewalsNext7Days, '1'], [m.renewalsNext30Days, '3'], [m.renewalsNext60Days, '5']]);
    expect(all[5]).toEqual([[m.renewalValueAtRisk, formatRiyal('12345.00')]]);
  });

  it('keeps the same names, values and order in Arabic', async () => {
    locale = 'ar';
    const { container } = await renderLoaded();
    const m = ar.platform;
    const all = [...container.querySelectorAll('dl')].map(pairs);
    expect(all[0]).toEqual([
      [m.scopeContracted, m.scopeContractedDesc, m.scopeShown],
      [m.scopeInvoiced, m.scopeInvoicedDesc, m.scopeNotReported],
      [m.scopeCollected, m.scopeCollectedDesc, m.scopeNotReported],
    ]);
    expect(all[3]).toEqual([[m.trials, '4']]);
    expect(all[5]).toEqual([[m.renewalValueAtRisk, formatRiyal('12345.00')]]);
  });

  it('the status is a second description of its term, not a loose element, and keeps its look', async () => {
    const { container } = await renderLoaded();
    const groups = [...container.querySelectorAll('dl')][0].querySelectorAll(':scope > div');
    expect(groups.length).toBe(3);
    for (const [index, group] of [...groups].entries()) {
      expect([...group.children].map((c) => c.tagName)).toEqual(['DT', 'DD', 'DD']);
      const badge = group.lastElementChild!;
      const shown = index === 0;
      // same pill appearance as before the fix (shown = filled, not reported = outlined)
      expect(badge.className).toContain('rounded');
      expect(badge.className).toContain('px-2');
      expect(badge.className).toContain(shown ? 'bg-primary-soft' : 'border-border');
      expect(badge.className).toContain('w-fit');
      // two-column layout on wide screens (term and description left, status at the end), stacked on narrow ones
      expect(group.className).toContain('grid-cols-1');
      expect(group.className).toContain('sm:grid-cols-[minmax(0,1fr)_auto]');
      expect(badge.className).toContain('sm:self-start');
    }
  });

  it('the page and the lists set no direction of their own (RTL comes from the document)', async () => {
    locale = 'ar';
    const { container } = await renderLoaded();
    expect(container.querySelectorAll('dl[dir], dl [dir]').length).toBe(0);
  });

  it('does not change what is requested', async () => {
    await renderLoaded();
    expect(platformApi.mock.calls).toEqual([['/platform/overview']]);
  });
});
