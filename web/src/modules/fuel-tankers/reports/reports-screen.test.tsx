// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl, TEST_MESSAGES, type TestLocale } from '@/test-utils/intl';
import {
  clearingAccountRow, clearingReport, controlReport, controlRow, fillsReport, fillsRow, fillsRowNoCost, finding, FILL_A, OWNER_ID, reconReport, scope, STATION_ID,
} from './__fixtures__';

const state = vi.hoisted(() => ({ permissions: ['*'] as string[], handler: (_path: string) => ({}) as unknown }));
const calls = vi.hoisted(() => [] as Array<{ path: string; method: string }>);

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock('@/lib/auth', () => ({ currentUser: () => ({ permissions: state.permissions }) }));
vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  api: vi.fn(async (path: string, opts: { method?: string } = {}) => {
    calls.push({ path, method: opts.method ?? 'GET' });
    if (path === '/fuel-stations/stations') return { data: [{ id: STATION_ID, name: 'محطة الدمام', code: 'DMM', status: 'active' }] };
    if (path.startsWith('/fuel-stations/tanker-owners')) return { data: [{ id: OWNER_ID, name: 'عسكر', code: 'ASK', status: 'active' }], meta: { current_page: 1, last_page: 1, per_page: 25, total: 1 } };
    const result = state.handler(path);
    if (result instanceof Error) throw result;
    return result;
  }),
}));

import { ApiError } from '@/lib/api';
import { ReportsScreen } from './reports-screen';
import type { ReportKey } from './routes';

const T = (locale: TestLocale) => TEST_MESSAGES[locale].fuelTankerReports;
const reportCalls = () => calls.filter((c) => c.path.startsWith('/fuel-stations/tanker-fill-reports/'));
const forbidden = (reason?: string) => new ApiError(403, 'forbidden', { message: 'forbidden', reason: 'forbidden', ...(reason ? { details: { reason } } : {}) });
const handlerFor = (key: ReportKey, payload: unknown) => { state.handler = (path) => (path.startsWith(`/fuel-stations/tanker-fill-reports/${key}`) ? payload : new ApiError(500, 'unexpected', null)); };

beforeEach(() => { calls.length = 0; state.permissions = ['*']; state.handler = () => new ApiError(500, 'unset', null); });
afterEach(cleanup);

describe.each(['ar', 'en'] as const)('ReportsScreen (%s)', (locale) => {
  const text = T(locale);
  const mount = (key: ReportKey) => renderIntl(<ReportsScreen reportKey={key} />, locale);

  // ───────────── تحميل التقارير الأربعة ─────────────

  it('loads the fills report with a single GET and shows the summary and rows', async () => {
    handlerFor('fills', fillsReport());
    mount('fills');
    expect(await screen.findAllByText('FTF-2027-00001')).not.toHaveLength(0);
    expect(reportCalls().map((c) => c.path)).toEqual(['/fuel-stations/tanker-fill-reports/fills']);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    expect(document.querySelector('[data-report-view="fills"]')).not.toBeNull();
    expect(document.querySelector('[data-tile="total"]')?.textContent).toContain('2');
    expect(document.querySelectorAll('[data-report-row]').length).toBeGreaterThanOrEqual(2);
  });

  it('loads the reconciliation report: rows, quantity totals and the pool-level reconciliation', async () => {
    handlerFor('inventory-reconciliation', reconReport());
    mount('inventory-reconciliation');
    await waitFor(() => expect(document.querySelector('[data-report-view="inventory-reconciliation"]')).not.toBeNull());
    expect(document.querySelector('[data-tile="mismatch"]')?.textContent).toContain('1');
    expect(document.querySelector('[data-quantity-totals]')).not.toBeNull();
    expect(document.querySelector('[data-pool-reconciliation] [data-reconciliation-panel]')).not.toBeNull();
    expect(document.querySelectorAll('[data-reconciliation-pool]')).toHaveLength(1);
    expect(screen.getAllByText(text.finding.stock_quantity_mismatch).length).toBeGreaterThan(0);
  });

  it('loads the clearing-account report with opening / debits / credits / closing / supported / difference', async () => {
    handlerFor('clearing-account', clearingReport([clearingAccountRow({ unexplained_difference_minor: 500, findings: [finding('clearing_balance_differs_from_postings')], other: { debits_minor: 0, credits_minor: 1_000, net_all_time_minor: -1_000 }, other_entries: [{ entry_id: 'e1', number: 'JE-9', entry_date: '2027-01-10', description: 'يدوي', source: null, debit_minor: 0, credit_minor: 1_000 }] })]));
    mount('clearing-account');
    await waitFor(() => expect(document.querySelector('[data-report-view="clearing-account"]')).not.toBeNull());
    const card = document.querySelector('[data-clearing-account="1145"]') as HTMLElement;
    for (const key of ['opening', 'debits', 'credits', 'closing', 'supported', 'difference']) expect(card.querySelector(`[data-balance="${key}"]`), key).not.toBeNull();
    expect(card.getAttribute('data-differs')).toBe('true');
    expect(within(card).getByText(text.finding.clearing_balance_differs_from_postings)).toBeTruthy();
    expect(card.querySelector('[data-other-entries]')).not.toBeNull();
  });

  it('loads the accounting-control report as a trace chain from the fill to the journal entry', async () => {
    handlerFor('accounting-control', controlReport());
    mount('accounting-control');
    await waitFor(() => expect(document.querySelector('[data-report-view="accounting-control"]')).not.toBeNull());
    const first = document.querySelectorAll('[data-report-row]')[0] as HTMLElement;
    const steps = Array.from(first.querySelectorAll('[data-step]')).map((el) => el.getAttribute('data-step'));
    expect(steps).toEqual(['fill', 'stock', 'cost', 'entry', 'ledger']);
    expect(first.textContent).toContain('JE-2027-00042');
    // السند ذو الدفتر المفقود: خطوة الدفتر مُعلَّمة «مفقود» ونتيجته فرق مؤكَّد ويُفتح تلقائياً.
    const second = document.querySelectorAll('[data-report-row]')[1] as HTMLElement;
    expect(second.getAttribute('data-result')).toBe('mismatch');
    expect(second.querySelector('[data-step="ledger"]')?.getAttribute('data-missing')).toBe('true');
    expect(second.hasAttribute('open')).toBe(true);
    expect(within(second).getByText(text.control.missing)).toBeTruthy();
  });

  it('links from every report row to the fill details', async () => {
    handlerFor('accounting-control', controlReport());
    mount('accounting-control');
    await waitFor(() => expect(document.querySelector('[data-open-fill]')).not.toBeNull());
    expect((document.querySelector('[data-open-fill]') as HTMLAnchorElement).getAttribute('href')).toBe(`/fuel-stations/tanker-fills/${FILL_A}`);
    cleanup();
    handlerFor('fills', fillsReport());
    mount('fills');
    await waitFor(() => expect(document.querySelector('[data-report-row]')).not.toBeNull());
    expect(document.querySelector(`a[href="/fuel-stations/tanker-fills/${FILL_A}"]`)).not.toBeNull();
    cleanup();
    handlerFor('inventory-reconciliation', reconReport());
    mount('inventory-reconciliation');
    await waitFor(() => expect(document.querySelector('[data-report-row]')).not.toBeNull());
    expect(document.querySelector(`a[href="/fuel-stations/tanker-fills/${FILL_A}"]`)).not.toBeNull();
  });

  it('shows the report switcher with the current report marked and a link for each of the four', async () => {
    handlerFor('fills', fillsReport());
    mount('fills');
    await screen.findAllByText('FTF-2027-00001');
    const nav = screen.getByRole('navigation', { name: text.switcher });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/fuel-stations/tanker-fill-reports', '/fuel-stations/tanker-fill-reports/inventory-reconciliation', '/fuel-stations/tanker-fill-reports/clearing-account', '/fuel-stations/tanker-fill-reports/accounting-control',
    ]);
    expect(links.filter((l) => l.getAttribute('aria-current') === 'page').map((l) => l.getAttribute('data-report-link'))).toEqual(['fills']);
    expect(links.every((l) => l.className.includes('min-h-11'))).toBe(true);
  });

  // ───────────── الصلاحيات وإخفاء القيم والحسابات ─────────────

  it('masks costs in the fills report: no amounts or entry numbers, with an explicit notice', async () => {
    state.permissions = ['fuel.tanker.fill.inventory.view'];
    handlerFor('fills', fillsReport([fillsRowNoCost()], { masking: { costs: true, accounts: true } }));
    mount('fills');
    await screen.findAllByText('FTF-2027-00001');
    expect(document.querySelector('[data-masking-costs]')?.textContent).toBe(text.masking.costs);
    expect(document.querySelector('[data-masking-accounts]')?.textContent).toBe(text.masking.accounts);
    expect(document.querySelector('[data-amount]')).toBeNull(); // لا مبلغ ولا صفر مختلق
    expect(document.body.textContent).not.toContain('JE-2027-00042');
  });

  it('treats costs and accounts permissions independently in the control report', async () => {
    state.permissions = ['fuel.tanker.fill.inventory.view', 'products.view_cost']; // بلا accounts.view
    handlerFor('accounting-control', controlReport([controlRow({ accounts: null })], undefined, { masking: { costs: false, accounts: true } }));
    mount('accounting-control');
    await waitFor(() => expect(document.querySelector('[data-report-view="accounting-control"]')).not.toBeNull());
    expect(document.querySelector('[data-masking-costs]')).toBeNull();
    expect(document.querySelector('[data-masking-accounts]')).not.toBeNull();
    expect(document.querySelector('[data-accounts]')).toBeNull(); // معرّفا الحسابين غائبان
    expect(document.querySelector('[data-amount]')).not.toBeNull(); // المبالغ ظاهرة
  });

  it('shows a hidden-cost placeholder (never zero) in the trace when the chain is withheld', async () => {
    state.permissions = ['fuel.tanker.fill.inventory.view'];
    handlerFor('accounting-control', controlReport([controlRow({ values: null, chain: null, accounts: null })], { available: false, reason: 'financial_permissions_required', accounts: [] }, { masking: { costs: true, accounts: true } }));
    mount('accounting-control');
    await waitFor(() => expect(document.querySelector('[data-report-view="accounting-control"]')).not.toBeNull());
    expect(screen.getByText(text.control.step.hiddenNoCost)).toBeTruthy();
    expect(document.querySelector('[data-amount]')).toBeNull();
  });

  it('shows no unauthorised screen and sends no request without the base permission', async () => {
    state.permissions = ['fuel.tanker.view'];
    mount('fills');
    await screen.findByText(TEST_MESSAGES[locale].fuelTankers.states.forbiddenTitle);
    expect(reportCalls()).toHaveLength(0);
  });

  // ───────────── نطاق المحطات والفروع ─────────────

  it('announces station-restricted row scope and the filters actually applied', async () => {
    handlerFor('fills', fillsReport(undefined, undefined, { row_scope: { station_restricted: true, branch_restricted: false }, filters: { station_id: STATION_ID, from: '2027-01-01' } }));
    mount('fills');
    await screen.findAllByText('FTF-2027-00001');
    expect(document.querySelector('[data-row-scope]')?.getAttribute('data-row-scope')).toBe('stations');
    expect(document.querySelector('[data-row-scope]')?.textContent).toContain(text.scope.rows.stations);
    const applied = document.querySelector('[data-filters-applied]')?.textContent ?? '';
    expect(applied).toContain(text.filterName.station_id);
    expect(applied).toContain(text.filterName.from);
  });

  it('shows the ledger scope level and the basis, never presenting balances as a station balance', async () => {
    handlerFor('clearing-account', clearingReport(undefined, { scope: scope({ level: 'branches', branch_ids: ['b1', 'b2'], filters_applied: ['period', 'branch'] }) }));
    mount('clearing-account');
    await waitFor(() => expect(document.querySelector('[data-balance-scope]')).not.toBeNull());
    expect(document.querySelector('[data-balance-scope]')?.getAttribute('data-balance-scope')).toBe('branches');
    expect(document.querySelector('[data-scope-level-label]')?.textContent).toBe(text.scope.level.branches);
    const noteText = document.querySelector('[data-scope-level]')?.textContent ?? '';
    expect(noteText).toContain(text.scope.branchesBody.replace('{count}', '2'));
    expect(noteText).toContain(text.scope.basis.ledger_lines_by_branch);
    expect(document.querySelector('[data-scope-applied]')?.textContent).toContain(text.filterName.period);
    expect(document.querySelector('[data-scope-applied]')?.textContent).toContain(text.filterName.branch);
    expect(document.querySelector('[data-ledger-level="branches"]')?.textContent).toBe(text.clearing.levelBranches);
    expect(document.querySelector('[data-scope-level]')?.textContent).not.toContain(text.scope.organizationBody);
    expect(document.querySelector('[data-scope-level-label]')?.textContent).not.toBe(text.scope.level.organization);
  });

  it('organisation level is labelled as organisation, not station', async () => {
    handlerFor('clearing-account', clearingReport());
    mount('clearing-account');
    await waitFor(() => expect(document.querySelector('[data-balance-scope="organization"]')).not.toBeNull());
    expect(document.querySelector('[data-scope-level-label]')?.textContent).toBe(text.scope.level.organization);
    expect(document.querySelector('[data-ledger-level="organization"]')?.textContent).toBe(text.clearing.levelOrganization);
  });

  it('warns about filters that do not affect balances (balance_filters_not_applicable)', async () => {
    handlerFor('clearing-account', clearingReport(undefined, undefined, { balance_filters_not_applicable: ['station_id', 'owner_id'] }));
    mount('clearing-account');
    await waitFor(() => expect(document.querySelector('[data-balance-filters-not-applicable]')).not.toBeNull());
    const warning = document.querySelector('[data-balance-filters-not-applicable]')?.textContent ?? '';
    expect(warning).toContain(text.scope.notApplicableTitle);
    expect(warning).toContain(text.filterName.station_id);
    expect(warning).toContain(text.filterName.owner_id);
  });

  it('shows no not-applicable warning when none were selected', async () => {
    handlerFor('clearing-account', clearingReport());
    mount('clearing-account');
    await waitFor(() => expect(document.querySelector('[data-balance-scope]')).not.toBeNull());
    expect(document.querySelector('[data-balance-filters-not-applicable]')).toBeNull();
  });

  it('control report: the clearing summary is absent for a station-restricted user, with the reason and no balances', async () => {
    handlerFor('accounting-control', controlReport(undefined, { available: false, reason: 'station_scope_restricted', accounts: [] }, undefined, { row_scope: { station_restricted: true, branch_restricted: false } }));
    mount('accounting-control');
    await waitFor(() => expect(document.querySelector('[data-clearing-unavailable]')).not.toBeNull());
    const box = document.querySelector('[data-clearing-unavailable]') as HTMLElement;
    expect(box.getAttribute('data-clearing-unavailable')).toBe('station_scope_restricted');
    expect(box.textContent).toContain(text.control.clearingUnavailable.station_scope_restricted);
    expect(document.querySelector('[data-clearing-summary]')).toBeNull();
    expect(document.querySelector('[data-balance-scope]')).toBeNull();
    expect(document.querySelector('[data-clearing-account]')).toBeNull();
  });

  it('control report: an available clearing summary shows scope, difference and findings', async () => {
    handlerFor('accounting-control', controlReport(undefined, { available: true, reason: null, period: { from: '2027-01-01', to: '2027-01-31' }, scope: scope({ level: 'organization' }), accounts: [{ account: clearingAccountRow().account, closing_balance_minor: 2_616_000, supported_balance_minor: 2_000_000, unexplained_difference_minor: 616_000, findings: [finding('clearing_balance_differs_from_postings')] }] }, undefined, { balance_filters_not_applicable: ['station_id'] }));
    mount('accounting-control');
    await waitFor(() => expect(document.querySelector('[data-clearing-summary]')).not.toBeNull());
    const summary = document.querySelector('[data-clearing-summary]') as HTMLElement;
    expect(summary.querySelector('[data-balance-scope="organization"]')).not.toBeNull();
    expect(summary.querySelector('[data-balance-filters-not-applicable]')).not.toBeNull();
    expect(within(summary).getByText(text.finding.clearing_balance_differs_from_postings)).toBeTruthy();
  });

  // ───────────── 403 ─────────────

  it.each([
    ['station_scope_restricted'], ['financial_permissions_required'], [undefined],
  ] as const)('clearing-account 403 (%s) explains the reason and shows no financial information', async (reason) => {
    handlerFor('clearing-account', forbidden(reason));
    mount('clearing-account');
    await waitFor(() => expect(document.querySelector('[data-financial-forbidden]')).not.toBeNull());
    const box = document.querySelector('[data-financial-forbidden]') as HTMLElement;
    const key = reason ?? 'unknown';
    expect(box.getAttribute('data-financial-forbidden')).toBe(key);
    expect(box.textContent).toContain(text.forbidden[key as 'unknown'].title);
    expect(box.textContent).toContain(text.forbidden[key as 'unknown'].body);
    expect(document.querySelector('[data-amount]')).toBeNull();
    expect(document.querySelector('[data-clearing-account]')).toBeNull();
    expect(document.querySelector('[data-balance-scope]')).toBeNull();
    // فصل الشرطين: المفتاحان يُذكران مستقلَّين إلا عند تقييد المحطة (لا يحلّه منح صلاحية).
    const keys = Array.from(box.querySelectorAll('[data-required-permissions] code')).map((c) => c.textContent);
    expect(keys).toEqual(reason === 'station_scope_restricted' ? [] : ['products.view_cost', 'accounts.view']);
    // لا مرشّحات تُعرض لتقرير ممنوع.
    expect(document.querySelector('[data-report-filters]')).toBeNull();
  });

  it('a 403 on a non-financial report is the generic permission state', async () => {
    handlerFor('fills', forbidden());
    mount('fills');
    await screen.findByText(TEST_MESSAGES[locale].fuelTankers.states.forbiddenTitle);
    expect(document.querySelector('[data-financial-forbidden]')).toBeNull();
  });

  it('a 404 is the gate-closed state (uniform server answer), not a generic error', async () => {
    handlerFor('fills', new ApiError(404, 'nf', null));
    mount('fills');
    await screen.findByText(TEST_MESSAGES[locale].fuelTankers.states.gateClosedTitle);
  });

  // ───────────── الاقتطاع والفلاتر والصفحات والحالات الفارغة والأخطاء ─────────────

  it.each(['inventory-reconciliation', 'accounting-control'] as const)('shows a clear limited-result notice when %s is truncated', async (key) => {
    handlerFor(key, key === 'accounting-control' ? controlReport(undefined, undefined, { truncated: true }) : reconReport(undefined, { truncated: true }));
    mount(key);
    await waitFor(() => expect(document.querySelector('[data-truncated]')).not.toBeNull());
    expect(document.querySelector('[data-truncated]')?.textContent).toContain(text.truncated.title);
    expect(document.querySelector('[data-truncated]')?.textContent).toContain(text.truncated.bodyLimit.replace('{limit}', '2000'));
  });

  it('shows no truncation notice when the scan was complete', async () => {
    handlerFor('inventory-reconciliation', reconReport());
    mount('inventory-reconciliation');
    await waitFor(() => expect(document.querySelector('[data-report-view]')).not.toBeNull());
    expect(document.querySelector('[data-truncated]')).toBeNull();
  });

  it('sends filters to the server and resets to the first page; clearing removes them', async () => {
    handlerFor('fills', fillsReport());
    mount('fills');
    await screen.findAllByText('FTF-2027-00001');
    await waitFor(() => expect(document.querySelector('[data-filter="station"] option[value="' + STATION_ID + '"]')).not.toBeNull());
    await waitFor(() => expect(document.querySelector('[data-filter="owner"] option[value="' + OWNER_ID + '"]')).not.toBeNull());
    fireEvent.change(document.querySelector('[data-filter="station"]') as HTMLSelectElement, { target: { value: STATION_ID } });
    fireEvent.change(document.querySelector('[data-filter="owner"]') as HTMLSelectElement, { target: { value: OWNER_ID } });
    fireEvent.change(document.querySelector('[data-filter="inventory_status"]') as HTMLSelectElement, { target: { value: 'posted' } });
    fireEvent.change(document.querySelector('[data-filter="from"]') as HTMLInputElement, { target: { value: '2027-01-01' } });
    fireEvent.change(document.querySelector('[data-filter="to"]') as HTMLInputElement, { target: { value: '2027-01-31' } });
    await waitFor(() => expect(reportCalls().at(-1)?.path).toBe(`/fuel-stations/tanker-fill-reports/fills?station_id=${STATION_ID}&owner_id=${OWNER_ID}&inventory_status=posted&from=2027-01-01&to=2027-01-31`));
    fireEvent.click(document.querySelector('[data-clear-filters]') as HTMLButtonElement);
    await waitFor(() => expect(reportCalls().at(-1)?.path).toBe('/fuel-stations/tanker-fill-reports/fills'));
  });

  it('paginates the fills report with the page param', async () => {
    state.handler = (path) => {
      const page = new URL(path, 'http://x').searchParams.get('page') ?? '1';
      return fillsReport([fillsRow({ number: `FTF-P${page}` })], { pagination: { page: Number(page), per_page: 25, total: 60, last_page: 3 } });
    };
    mount('fills');
    await screen.findAllByText('FTF-P1');
    const next = screen.getAllByRole('button').find((b) => /next|التالي/i.test(b.getAttribute('aria-label') ?? b.textContent ?? ''));
    expect(next, 'pagination next button').toBeTruthy();
    fireEvent.click(next as HTMLElement);
    await waitFor(() => expect(reportCalls().at(-1)?.path).toBe('/fuel-stations/tanker-fill-reports/fills?page=2'));
    await screen.findAllByText('FTF-P2');
  });

  it('a reversed period is blocked locally with a message and sends no request', async () => {
    handlerFor('fills', fillsReport());
    mount('fills');
    await screen.findAllByText('FTF-2027-00001');
    const before = reportCalls().length;
    fireEvent.change(document.querySelector('[data-filter="from"]') as HTMLInputElement, { target: { value: '2027-02-01' } });
    fireEvent.change(document.querySelector('[data-filter="to"]') as HTMLInputElement, { target: { value: '2027-01-01' } });
    await screen.findByRole('alert');
    expect(document.querySelector('[data-period-error]')?.textContent).toBe(text.filters.periodReversed);
    expect(reportCalls().slice(before).every((c) => !c.path.includes('to=2027-01-01') || !c.path.includes('from=2027-02-01'))).toBe(true);
  });

  it('the clearing report offers only the period filter (row filters do not affect ledger balances)', async () => {
    handlerFor('clearing-account', clearingReport());
    mount('clearing-account');
    await waitFor(() => expect(document.querySelector('[data-report-filters]')).not.toBeNull());
    expect(document.querySelector('[data-filter="station"]')).toBeNull();
    expect(document.querySelector('[data-filter="owner"]')).toBeNull();
    expect(document.querySelector('[data-filter="inventory_status"]')).toBeNull();
    expect(document.querySelector('[data-filter="from"]')).not.toBeNull();
    expect(document.querySelector('[data-no-row-filters]')?.textContent).toBe(text.filters.clearingNote);
  });

  it('filters the loaded reconciliation rows by result locally without a new request', async () => {
    handlerFor('inventory-reconciliation', reconReport());
    mount('inventory-reconciliation');
    await waitFor(() => expect(document.querySelectorAll('[data-report-row]').length).toBeGreaterThan(0));
    const before = reportCalls().length;
    fireEvent.change(document.querySelector('[data-result-filter]') as HTMLSelectElement, { target: { value: 'mismatch' } });
    await waitFor(() => expect(Array.from(document.querySelectorAll('[data-report-row]')).every((r) => r.getAttribute('data-result') === 'mismatch')).toBe(true));
    expect(reportCalls()).toHaveLength(before);
    expect(document.querySelector('[data-result-filter-note]')?.textContent).toBe(text.resultFilter.note.replace('{shown}', '1').replace('{loaded}', '3'));
  });

  it.each(['fills', 'inventory-reconciliation', 'accounting-control'] as const)('shows the empty state for %s with no rows', async (key) => {
    handlerFor(key, key === 'fills' ? fillsReport([]) : key === 'inventory-reconciliation' ? reconReport([], { }) : controlReport([]));
    mount(key);
    await screen.findByText(text.empty.title);
  });

  it('shows the empty state for a clearing report with no accounts', async () => {
    handlerFor('clearing-account', clearingReport([]));
    mount('clearing-account');
    await screen.findByText(text.clearing.emptyTitle);
  });

  it('shows an error with retry on a server failure, and retries', async () => {
    state.handler = () => new ApiError(500, 'boom', null);
    mount('fills');
    await screen.findByText(text.loadFailed);
    handlerFor('fills', fillsReport());
    fireEvent.click(screen.getByRole('button', { name: TEST_MESSAGES[locale].nebrax.retry }));
    await screen.findAllByText('FTF-2027-00001');
  });

  it('rejects a malformed response with the error state, never partial data', async () => {
    handlerFor('fills', { data: { rows: [{ id: 5 }] }, meta: { report: 'fills' } });
    mount('fills');
    await screen.findByText(text.loadFailed);
    expect(document.querySelector('[data-report-row]')).toBeNull();
  });

  it('ignores a late response of an older request (no overwrite of the newer one)', async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    let n = 0;
    state.handler = () => {
      n += 1;
      return n === 1 ? new Promise((resolve) => { resolveFirst = resolve; }) : fillsReport([fillsRow({ number: 'FTF-NEW' })]);
    };
    mount('fills');
    await waitFor(() => expect(document.querySelector('[data-filter="from"]')).not.toBeNull());
    fireEvent.change(document.querySelector('[data-filter="from"]') as HTMLInputElement, { target: { value: '2027-01-01' } });
    await screen.findAllByText('FTF-NEW');
    resolveFirst(fillsReport([fillsRow({ number: 'FTF-OLD' })]));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('FTF-OLD')).toBeNull();
  });

  // ───────────── RTL/LTR واستجابة الجوال ─────────────

  it('keeps numbers, codes and identifiers LTR-isolated and renders locale text (RTL/LTR safe)', async () => {
    handlerFor('inventory-reconciliation', reconReport());
    mount('inventory-reconciliation');
    await waitFor(() => expect(document.querySelector('[data-report-row]')).not.toBeNull());
    expect(document.querySelector('h1')?.textContent).toBe(text.title['inventory-reconciliation']);
    const numbers = Array.from(document.querySelectorAll('.num'));
    expect(numbers.length).toBeGreaterThan(0);
    for (const el of document.querySelectorAll('bdi.num, [data-quantity]')) expect(el.getAttribute('dir') ?? el.closest('[dir]')?.getAttribute('dir')).toBe('ltr');
    for (const input of document.querySelectorAll('input[type="date"]')) expect(input.getAttribute('dir')).toBe('ltr');
  });

  it('serves a card list for phones and a table for tablets/desktop (responsive structure, 44px targets)', async () => {
    handlerFor('inventory-reconciliation', reconReport());
    mount('inventory-reconciliation');
    await waitFor(() => expect(document.querySelector('[data-report-row]')).not.toBeNull());
    expect(document.querySelector('div.hidden.md\\:block table')).not.toBeNull();
    const cards = document.querySelector('ul.md\\:hidden') as HTMLElement;
    expect(cards.querySelectorAll('[data-report-row]').length).toBe(3);
    expect(cards.querySelector('a')?.className).toContain('max-md:min-h-11');
    for (const control of document.querySelectorAll('[data-report-filters] select, [data-report-filters] input')) expect(control.className).toContain('max-md:min-h-11');
    // لا تمرير أفقي للصفحة: الجدول داخل حاوية overflow-x-auto فقط.
    expect(document.querySelector('div.hidden.md\\:block')?.className).toContain('overflow-x-auto');
  });

  it('control trace rows are keyboard-reachable disclosure widgets with 44px summaries', async () => {
    handlerFor('accounting-control', controlReport());
    mount('accounting-control');
    await waitFor(() => expect(document.querySelector('[data-report-row]')).not.toBeNull());
    const summaries = document.querySelectorAll('[data-report-row] > summary');
    expect(summaries.length).toBe(2);
    for (const s of summaries) expect(s.className).toContain('min-h-11');
  });

  it('keeps all result levels distinct: confirmed difference, warning and incomplete never share a badge', async () => {
    handlerFor('accounting-control', controlReport([
      controlRow({ result: 'mismatch', findings: [finding('ledger_missing')] }),
      controlRow({ fill_id: 'w', number: 'W', result: 'warning', findings: [finding('entry_branch_mismatch', 'warning')] }),
      controlRow({ fill_id: 'i', number: 'I', result: 'incomplete', posting_status: null, inventory_status: 'pending_integration', findings: [finding('not_posted_yet', 'info')] }),
    ]));
    mount('accounting-control');
    await waitFor(() => expect(document.querySelectorAll('[data-report-row]')).toHaveLength(3));
    const labels = Array.from(document.querySelectorAll('[data-report-row] > summary [data-result]')).map((el) => el.textContent);
    expect(labels).toEqual([text.result.mismatch, text.result.warning, text.result.incomplete]);
    expect(new Set(labels).size).toBe(3);
  });
});
