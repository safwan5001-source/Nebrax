// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TEST_LOCALES, renderIntl } from '@/test-utils/intl';
import { SAUDI_RIYAL_SYMBOL } from '@/lib/money';
import { agingResult, incomeResult, messageResponse } from '@/modules/intelligence/__tests__/fixtures';
import type { FinancialRun } from '@/modules/intelligence/store';
import { FinancialResult } from '../financial-result';
import { safeUiPath } from '../evidence-panel';
import { StateNotice } from '../state-notice';

afterEach(cleanup);

const run = (result: FinancialRun['result'], extra: Partial<FinancialRun> = {}): FinancialRun => ({
  id: 'run-1', source: 'canvas', requestId: 'r1', tool: 'finance.income_statement', result, ...extra,
});

describe.each(TEST_LOCALES)('financial result (%s)', (locale) => {
  it('renders income statement figures straight from the server decimals in SAR', () => {
    const { container } = renderIntl(<FinancialResult run={run(incomeResult())} />, locale);
    const text = container.textContent ?? '';
    expect(text).toContain(`12,345.00 ${SAUDI_RIYAL_SYMBOL}`);
    expect(text).toContain(`8,345.00 ${SAUDI_RIYAL_SYMBOL}`);
    expect(container.querySelector('[data-result="income_statement"]')).not.toBeNull();
  });

  it('shows the as_of_not_historical warning with the balance timestamp and never calls it historical', () => {
    renderIntl(<FinancialResult run={run(agingResult('receivables_aging', true))} />, locale);
    const warnings = screen.getByRole('list', { name: locale === 'ar' ? 'تنبيهات' : 'Warnings' });
    expect(within(warnings).getByRole('note').textContent).toContain('2026-10-16T09:00:00+03:00');
  });

  it('shows no warning block when the server returned none', () => {
    renderIntl(<FinancialResult run={run(agingResult('receivables_aging', false))} />, locale);
    expect(screen.queryByRole('list', { name: locale === 'ar' ? 'تنبيهات' : 'Warnings' })).toBeNull();
  });

  it('states that warehouse scope does not filter financial totals and labels authorization scope', () => {
    const scope = messageResponse().scope;
    const { container } = renderIntl(<FinancialResult run={run(incomeResult(), { source: 'assistant', authorizationScope: scope })} />, locale);
    const text = container.textContent ?? '';
    expect(text).toContain(locale === 'ar' ? 'لا تنطبق على الإجماليات المالية' : 'not applicable to financial totals');
    expect(container.querySelector('[data-scope-kind="authorization"]')).not.toBeNull();
    expect(text).not.toContain('w1'); // the user's warehouse id never appears next to figures
  });

  it('leads with the summary: net income first for the income statement, the total first for aging — and never invents percentages or growth', () => {
    const income = renderIntl(<FinancialResult run={run(incomeResult())} />, locale);
    const incomeTiles = income.container.querySelector('[role="group"]')!.children;
    expect(incomeTiles[0].textContent).toContain(`8,345.00 ${SAUDI_RIYAL_SYMBOL}`);
    expect(income.container.textContent).not.toMatch(/%|\+\d+(\.\d+)?\s?٪/);
    cleanup();
    const aging = renderIntl(<FinancialResult run={run(agingResult())} />, locale);
    const agingTiles = aging.container.querySelector('[role="group"]')!.children;
    expect(agingTiles).toHaveLength(5);
    expect(agingTiles[0].textContent).toContain(`350.00 ${SAUDI_RIYAL_SYMBOL}`);
    expect(aging.container.textContent).not.toContain('%');
  });

  it('links to the original report and exposes the source', () => {
    renderIntl(<FinancialResult run={run(incomeResult())} />, locale);
    const link = screen.getByRole('link', { name: locale === 'ar' ? /فتح التقرير الأصلي/ : /Open original report/ });
    expect(link.getAttribute('href')).toBe('/reports/general/income-statement');
  });

  it('withholds party rows when the server withheld partner detail, keeping totals', () => {
    const result = { ...agingResult(), partner_detail: 'withheld' as const, rows: [] };
    const { container } = renderIntl(<FinancialResult run={run(result)} />, locale);
    expect(container.textContent).not.toContain('شركة النور');
    expect(container.textContent).toContain(`350.00 ${SAUDI_RIYAL_SYMBOL}`);
  });

  it('renders aging both as a table (sm+) and as cards (mobile)', () => {
    const { container } = renderIntl(<FinancialResult run={run(agingResult())} />, locale);
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelectorAll('ul[aria-label] > li').length).toBeGreaterThan(1);
    expect(container.textContent).toContain('شركة النور');
  });
});

describe('safeUiPath', () => {
  it('accepts only same-origin app paths', () => {
    expect(safeUiPath('/reports/customers/aging')).toBe('/reports/customers/aging');
    expect(safeUiPath('//evil.example/x')).toBeNull();
    expect(safeUiPath('https://evil.example')).toBeNull();
    expect(safeUiPath('javascript:alert(1)')).toBeNull();
    expect(safeUiPath('/a?b=c')).toBeNull();
  });

  it('does not render a link for an unsafe server path', () => {
    const result = incomeResult();
    result.sources = [{ ...result.sources[0], ui_path: 'javascript:alert(1)' }];
    renderIntl(<FinancialResult run={run(result)} />, 'en');
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe.each(TEST_LOCALES)('state notice (%s)', (locale) => {
  it('offers the settings link only to someone who can manage consent', () => {
    renderIntl(<StateNotice notice="consent_required" canManageConsent />, locale);
    expect(screen.getByRole('link').getAttribute('href')).toBe('/intelligence/settings');
    cleanup();
    renderIntl(<StateNotice notice="consent_required" />, locale);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(locale === 'ar' ? /اطلب من مالك المؤسسة/ : /Ask the organization owner/)).toBeTruthy();
  });

  it('uses alert semantics for failures and status semantics for gating states', () => {
    renderIntl(<StateNotice notice="server_error" code="internal_error" />, locale);
    expect(screen.getByRole('alert').getAttribute('data-notice')).toBe('server_error');
    expect(screen.getByText('internal_error')).toBeTruthy();
    cleanup();
    renderIntl(<StateNotice notice="platform_disabled" />, locale);
    expect(screen.getByRole('status').getAttribute('data-notice')).toBe('platform_disabled');
  });

  it('exposes retry only when a handler is given', () => {
    renderIntl(<StateNotice notice="network_error" onRetry={() => {}} />, locale);
    expect(screen.getByRole('button')).toBeTruthy();
  });
});
