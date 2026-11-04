// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import type { MatchRow, ReconciliationHeader, StatusResponse } from './types';
import { PartnerStatementWorkspace } from './PartnerStatementWorkspace';

const h = vi.hoisted(() => ({
  fetchHeader: vi.fn(),
  fetchStatus: vi.fn(),
  fetchLines: vi.fn(),
  fetchMatches: vi.fn(),
  runMatching: vi.fn(),
  verifySet: vi.fn(),
  postDecision: vi.fn(),
  fetchLineHistory: vi.fn(),
  fetchReversedPairs: vi.fn(),
  markReviewed: vi.fn(),
  reopenReconciliation: vi.fn(),
  fetchEvents: vi.fn(),
  observe: vi.fn(),
  perms: ['partner_statements.view', 'partner_statements.reconcile'] as string[],
  capability: { state: 'enabled' as 'enabled' | 'suspended' | 'disabled', settled: true },
  translate: Object.assign(
    (key: string, values: Record<string, unknown> = {}) => (Object.keys(values).length ? `${key}:${Object.values(values).join(',')}` : key),
    { raw: () => ({}), rich: (key: string) => key },
  ),
}));

vi.mock('next-intl', () => ({ useTranslations: () => h.translate, useLocale: () => 'ar' }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock('./client', () => ({
  fetchHeader: h.fetchHeader,
  fetchStatus: h.fetchStatus,
  fetchLines: h.fetchLines,
  fetchMatches: h.fetchMatches,
  runMatching: h.runMatching,
  verifySet: h.verifySet,
  postDecision: h.postDecision,
  fetchLineHistory: h.fetchLineHistory,
  fetchReversedPairs: h.fetchReversedPairs,
  markReviewed: h.markReviewed,
  reopenReconciliation: h.reopenReconciliation,
  fetchEvents: h.fetchEvents,
}));
vi.mock('../capability', () => ({ usePartnerStatementsCapability: () => ({ ...h.capability, observe: h.observe, canView: true, canImport: true }) }));
vi.mock('@/lib/use-can', () => ({ useCan: () => ({ can: (p: string) => h.perms.includes(p) || h.perms.includes('*'), hydrated: true }) }));
vi.mock('./use-is-desktop', () => ({ useIsDesktop: () => true }));
vi.mock('lucide-react', () => {
  const stub = () => <span />;
  return new Proxy({ __esModule: true } as Record<string | symbol, unknown>, {
    get: (target, name) => (typeof name === 'symbol' || name === 'then' || name === '__esModule' ? Reflect.get(target, name) : stub),
    has: () => true,
  });
});

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RUN = 'rrrrrrrr-rrrr-4rrr-8rrr-rrrrrrrrrrrr';

const header = (patch: Partial<ReconciliationHeader> = {}): ReconciliationHeader => ({
  id: ID, status: 'draft', role: 'customer', partner_id: 'p', partner: { name: 'شركة النور' }, branch_id: null, branch: null, period_from: '2026-01-01', period_to: '2026-03-31', currency: 'SAR',
  original_filename: 'nour.csv', line_count: 4, total_debit_minor: 400000, total_credit_minor: 0, created_by: 'u', created_at: null, reviewed_at: null, closed_at: null, voided_at: null,
  superseded_by_id: null, policy: { date_tolerance_days: 3, amount_tolerance_minor: 100 }, checks: null, source_import_job_id: null, reviewed_by: null, reviewed_run_id: null,
  closed_by: null, voided_by: null, void_reason: null, ...patch,
});

const status = (patch: Partial<StatusResponse> = {}, readiness: Partial<StatusResponse['readiness']> = {}): StatusResponse => ({
  reconciliation: { id: ID, status: 'draft', reviewed_at: null, reviewed_by: null, reviewed_run_id: null },
  run: { id: RUN, scope: {}, ledger_fingerprint: 'fp', created_at: null },
  readiness: { lines_total: 4, resolved: 1, unresolved: 3, decisions_on_other_runs: 0, decisions_by_action: { confirm: 1 }, can_mark_reviewed: false, ...readiness },
  blockers: [{ code: 'unresolved_lines', count: 3, sample_ordinals: [2, 3, 4] }],
  reviewed_state: null, close: { available: false, blocked_reason: 'not_reviewed' }, void: { available: false, blocked_reason: 'not_closed' }, final: null, ...patch,
});

const line = (n: number, patch: Record<string, unknown> = {}) => ({ id: `line-${n}`, ordinal: n, date: `2026-01-0${n}`, reference: `INV-${n}`, our_reference: null, description: `desc ${n}`, debit_minor: 100000, credit_minor: 0, balance_minor: null, kind: null, ...patch });
const unit = (key: string, amount = 100000) => ({ key, kind: 'invoice', doc_number: `D-${key}`, date: '2026-01-02', direction: 'credit', amount_minor: amount, state: 'active', entry_numbers: ['E1'], entry_ids: ['e1'] });
const match = (n: number, patch: Partial<MatchRow> = {}): MatchRow => ({
  id: `m-${n}`, side: 'statement', line_id: `line-${n}`, ordinal: n, outcome: 'matched', rule: 'R2', unit_key: `u${n}`, difference_minor: 0, day_difference: 0,
  explanation: { code: 'matched_by_reference', params: {} }, warnings: [], unit: unit(`u${n}`), candidates: null, suggestions: null, line: line(n) as never, decision: null, ...patch,
});

const rows = (): MatchRow[] => [
  match(1, { decision: { id: 'd1', reconciliation_id: ID, run_id: RUN, line_id: 'line-1', revision: 1, action: 'confirm', unit_keys: ['u1'], engine_outcome: 'matched', engine_code: null, pair: null, expected_net_minor: null, set_net_minor: null, difference_minor: 0, accepted_difference: false, reason: null, created_by: 'u', created_at: null } }),
  match(2, { outcome: 'date_difference', day_difference: 9, explanation: { code: 'date_differs', params: {} } }),
  match(3, { outcome: 'missing_in_books', unit_key: null, unit: null, difference_minor: null, explanation: { code: 'no_candidate_in_books', params: {} } }),
  match(4, { outcome: 'ambiguous', unit_key: null, unit: null, difference_minor: null, explanation: { code: 'ambiguous_multiple_candidates', params: {} }, candidates: [unit('c1'), unit('c2')] }),
];

const matchesResponse = (data: MatchRow[] = rows(), extra: Record<string, unknown> = {}) => ({
  data, run: { id: RUN, reconciliation_id: ID, created: false, replayed: true, engine_version: 1, status: 'completed', policy: {}, scope: {}, ledger_fingerprint: 'fp', created_at: null, counts: { 'statement.matched': 1, 'statement.date_difference': 1, 'statement.missing_in_books': 1, 'statement.ambiguous': 1, 'ledger.missing_in_statement': 2 } },
  ledger_changed: false, meta: { current_page: 1, last_page: 1, per_page: 25, total: data.length }, ...extra,
});

const doneDecision = { data: null, replayed: false, warnings: [] };

beforeEach(() => {
  h.perms = ['partner_statements.view', 'partner_statements.reconcile'];
  h.capability = { state: 'enabled', settled: true };
  for (const fn of [h.fetchHeader, h.fetchStatus, h.fetchLines, h.fetchMatches, h.runMatching, h.verifySet, h.postDecision, h.fetchLineHistory, h.fetchReversedPairs, h.markReviewed, h.reopenReconciliation, h.fetchEvents, h.observe]) fn.mockReset();
  h.fetchHeader.mockResolvedValue(header());
  h.fetchStatus.mockResolvedValue(status());
  h.fetchMatches.mockImplementation(async (_id: string, q: { side: string }) => (q.side === 'ledger' ? matchesResponse([{ ...match(9, { side: 'ledger', line_id: null, line: null, unit_key: 'free-1', outcome: 'missing_in_statement', unit: unit('free-1', 5000) }) }]) : matchesResponse()));
  h.fetchLines.mockResolvedValue({ data: [line(1), line(2)], meta: { current_page: 1, last_page: 1, per_page: 25, total: 2 } });
  h.postDecision.mockResolvedValue(doneDecision);
  h.fetchReversedPairs.mockResolvedValue({ pairs: [], truncated: false });
  h.fetchEvents.mockResolvedValue({ data: [], meta: { current_page: 1, last_page: 1, per_page: 25, total: 0 } });
  window.sessionStorage.clear();
});
afterEach(() => cleanup());

const open = async () => {
  render(<PartnerStatementWorkspace id={ID} />);
  await screen.findByTestId('summary-bar');
  await screen.findAllByText('INV-2');
};
const selectLine = async (n: number) => {
  const row = document.querySelector(`tr[data-line-id="line-${n}"]`) as HTMLElement;
  await userEvent.click(row);
  return screen.findByTestId('line-detail');
};

describe('PartnerStatementWorkspace — header, progress and read-only guarantees', () => {
  it('shows the permanent comparison-only notice, server progress and the outcome counts', async () => {
    await open();
    expect(screen.getByTestId('comparison-only').textContent).toContain('workspace.comparison_only');
    expect(screen.getByTestId('progress-count').textContent).toBe('1/4');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1');
    expect(screen.getAllByText('INV-1').length).toBeGreaterThan(0);
  });

  it('never calls any matching/decision endpoint on load (no automatic reruns)', async () => {
    await open();
    expect(h.runMatching).not.toHaveBeenCalled();
    expect(h.postDecision).not.toHaveBeenCalled();
    expect(h.markReviewed).not.toHaveBeenCalled();
  });

  it('a view-only user sees data but no write control at all', async () => {
    h.perms = ['partner_statements.view'];
    await open();
    await selectLine(2);
    expect(screen.queryByTestId('action-bar')).toBeNull();
    expect(screen.queryByTestId('run-match')).toBeNull();
    expect(screen.queryByTestId('review-button')).toBeNull();
  });

  it('suspended capability is read-only even for a user holding reconcile', async () => {
    h.capability = { state: 'suspended', settled: true };
    await open();
    await selectLine(2);
    expect(screen.queryByTestId('action-bar')).toBeNull();
    expect(screen.queryByTestId('review-button')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('state.suspended_hint');
  });

  it('disabled capability blocks the whole screen and never fetches', async () => {
    h.capability = { state: 'disabled', settled: true };
    render(<PartnerStatementWorkspace id={ID} />);
    expect(await screen.findByText('state.disabled_title')).toBeTruthy();
    expect(h.fetchHeader).not.toHaveBeenCalled();
  });

  it('a closed reconciliation is read-only: no actions, a final note', async () => {
    h.fetchHeader.mockResolvedValue(header({ status: 'closed' }));
    h.fetchStatus.mockResolvedValue(status({ reconciliation: { id: ID, status: 'closed', reviewed_at: null, reviewed_by: null, reviewed_run_id: null }, blockers: [] }));
    await open();
    await selectLine(2);
    expect(screen.queryByTestId('action-bar')).toBeNull();
    expect(screen.getByTestId('final-readonly').textContent).toContain('final_closed');
  });

  it('warns when the ledger changed and offers an explicit new run (still never automatic)', async () => {
    h.fetchMatches.mockImplementation(async (_i: string, q: { side: string }) => (q.side === 'ledger' ? matchesResponse([]) : matchesResponse(rows(), { ledger_changed: true })));
    await open();
    expect(screen.getByTestId('ledger-changed')).toBeTruthy();
    expect(h.runMatching).not.toHaveBeenCalled();
  });

  it('flags decisions made on another run and shows the re-approval badge', async () => {
    const stale = rows();
    stale[0] = { ...stale[0], decision: { ...(stale[0].decision as NonNullable<MatchRow['decision']>), run_id: 'older-run' } };
    h.fetchMatches.mockImplementation(async (_i: string, q: { side: string }) => (q.side === 'ledger' ? matchesResponse([]) : matchesResponse(stale)));
    h.fetchStatus.mockResolvedValue(status({}, { decisions_on_other_runs: 1, resolved: 0 }));
    await open();
    expect(screen.getByTestId('other-runs')).toBeTruthy();
    expect(document.querySelector('[data-decision="other_run"]')).not.toBeNull();
  });

  it('shows the full block when the statement lines changed', async () => {
    h.fetchStatus.mockResolvedValue(status({ blockers: [{ code: 'statement_changed' }] }));
    await open();
    expect(screen.getByTestId('statement-changed')).toBeTruthy();
  });
});

describe('PartnerStatementWorkspace — before the first run', () => {
  beforeEach(() => {
    h.fetchStatus.mockResolvedValue(status({ run: null, blockers: [{ code: 'no_run' }] }, { resolved: 0, unresolved: 2, lines_total: 2 }));
  });

  it('lists the imported lines read-only and offers an explicit run; a double click posts once; replayed is announced', async () => {
    let resolve: (value: unknown) => void = () => {};
    h.runMatching.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<PartnerStatementWorkspace id={ID} />);
    const run = await screen.findByTestId('run-match');
    expect(await screen.findAllByText('INV-1')).not.toHaveLength(0);
    await userEvent.dblClick(run);
    expect(h.runMatching).toHaveBeenCalledTimes(1);
    h.fetchStatus.mockResolvedValue(status());
    resolve({ ...matchesResponse().run, replayed: true, created: false });
    expect((await screen.findByTestId('workspace-notice')).textContent).toContain('workspace.match.replayed');
  });

  it('translates a throttled run (429) and keeps the lines', async () => {
    h.runMatching.mockRejectedValue(new ApiError(429, 'x', {}));
    render(<PartnerStatementWorkspace id={ID} />);
    await userEvent.click(await screen.findByTestId('run-match'));
    expect((await screen.findByTestId('workspace-notice')).textContent).toContain('errors.throttled');
    expect(screen.getAllByText('INV-1').length).toBeGreaterThan(0);
  });
});

describe('PartnerStatementWorkspace — individual decisions', () => {
  it('confirms a matched zero-difference line in one click, with no reason field', async () => {
    await open();
    await selectLine(1);
    // line 1 already decided → pick a fresh matched line
    h.fetchMatches.mockImplementation(async (_i: string, q: { side: string }) => (q.side === 'ledger' ? matchesResponse([]) : matchesResponse([match(1), ...rows().slice(1)])));
    cleanup();
    await open();
    await selectLine(1);
    expect(screen.queryByTestId('decision-form-confirm')).toBeNull();
    await userEvent.click(within(screen.getByTestId('action-bar')).getByText('workspace.action.confirm'));
    await waitFor(() => expect(h.postDecision).toHaveBeenCalledTimes(1));
    expect(h.postDecision).toHaveBeenCalledWith(ID, { run_id: RUN, line_id: 'line-1', action: 'confirm' });
  });

  it('requires a reason (3+ characters) to confirm a date difference even at zero monetary difference', async () => {
    await open();
    await selectLine(2);
    await userEvent.click(within(screen.getByTestId('action-bar')).getByText('workspace.action.confirm'));
    const form = await screen.findByTestId('decision-form-confirm');
    const submit = within(form).getByText('workspace.action.confirm').closest('button') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(h.postDecision).not.toHaveBeenCalled();
    const reason = within(form).getByRole('textbox');
    await userEvent.type(reason, 'ab');
    expect(submit.disabled).toBe(true);
    await userEvent.type(reason, 'c');
    expect(submit.disabled).toBe(false);
    await userEvent.click(submit);
    await waitFor(() => expect(h.postDecision).toHaveBeenCalledWith(ID, { run_id: RUN, line_id: 'line-2', action: 'confirm', reason: 'abc' }));
  });

  it('requires an explicit acceptance when the engine difference is outside the tolerance', async () => {
    const list = rows();
    list[1] = { ...list[1], outcome: 'amount_difference', difference_minor: 5000, explanation: { code: 'amount_differs', params: {} } };
    h.fetchMatches.mockImplementation(async (_i: string, q: { side: string }) => (q.side === 'ledger' ? matchesResponse([]) : matchesResponse(list)));
    await open();
    await selectLine(2);
    await userEvent.click(within(screen.getByTestId('action-bar')).getByText('workspace.action.confirm'));
    const form = await screen.findByTestId('decision-form-confirm');
    await userEvent.type(within(form).getByRole('textbox'), 'agreed');
    const submit = within(form).getByText('workspace.action.confirm').closest('button') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    // سطر مدين: فرق المحرّك +50.00 يُعرض بإشارة الخادم −50.00 (ما سيُسجَّل في القرار)
    expect(within(form).getByRole('checkbox').closest('label')?.textContent).toContain('-50.00');
    await userEvent.click(within(form).getByRole('checkbox'));
    expect(submit.disabled).toBe(false);
    await userEvent.click(submit);
    await waitFor(() => expect(h.postDecision).toHaveBeenCalledWith(ID, { run_id: RUN, line_id: 'line-2', action: 'confirm', reason: 'agreed', accept_difference: true }));
  });

  it('dismisses a missing-in-books line only with a reason; the dismiss action is offered only for that outcome', async () => {
    await open();
    await selectLine(2);
    expect(within(screen.getByTestId('action-bar')).queryByText('workspace.action.dismiss')).toBeNull();
    await selectLine(3);
    await userEvent.click(within(screen.getByTestId('action-bar')).getByText('workspace.action.dismiss'));
    const form = await screen.findByTestId('decision-form-dismiss');
    const submit = within(form).getByText('workspace.action.dismiss').closest('button') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await userEvent.type(within(form).getByRole('textbox'), 'not ours');
    await userEvent.click(submit);
    await waitFor(() => expect(h.postDecision).toHaveBeenCalledWith(ID, { run_id: RUN, line_id: 'line-3', action: 'dismiss', reason: 'not ours' }));
  });

  it('offers `clear` only when a decision exists, and sends it without a reason', async () => {
    await open();
    await selectLine(2);
    expect(within(screen.getByTestId('action-bar')).queryByText('workspace.action.clear')).toBeNull();
    await selectLine(1);
    await userEvent.click(within(screen.getByTestId('action-bar')).getByText('workspace.action.clear'));
    await waitFor(() => expect(h.postDecision).toHaveBeenCalledWith(ID, { run_id: RUN, line_id: 'line-1', action: 'clear' }));
  });

  it('override: the set must be verified for exactly the selected units before it can be submitted', async () => {
    h.verifySet.mockResolvedValue({
      applied: false, line: { id: 'line-4', ordinal: 4, date: '2026-01-04', debit_minor: 100000, credit_minor: 0 },
      units: [{ key: 'c1', kind: 'invoice', doc_number: 'D-c1', date: '2026-01-02', state: 'active', direction: 'credit', net_minor: -100000 }],
      expected_net_minor: -100000, set_net_minor: -100000, difference_minor: 0, tolerance_minor: 100, equal_within_tolerance: true, problems: [],
    });
    await open();
    await selectLine(4);
    await userEvent.click(within(screen.getByTestId('action-bar')).getByText('workspace.action.override'));
    const picker = await screen.findByTestId('candidate-picker');
    await userEvent.click(within(picker).getByLabelText('workspace.picker.select_unit:D-c1'));
    expect(screen.getByTestId('verify-required')).toBeTruthy();
    const form = await screen.findByTestId('decision-form-override');
    const submit = within(form).getByText('workspace.action.override').closest('button') as HTMLButtonElement;
    await userEvent.type(within(form).getByRole('textbox'), 'chosen manually');
    expect(submit.disabled).toBe(true);
    await userEvent.click(within(picker).getByText('workspace.picker.verify'));
    expect((await screen.findByTestId('verify-result')).getAttribute('data-equal')).toBe('true');
    expect(h.verifySet).toHaveBeenCalledWith(ID, 'line-4', ['c1']);
    await waitFor(() => expect(submit.disabled).toBe(false));
    // changing the selection invalidates the verification
    await userEvent.click(within(picker).getByLabelText('workspace.picker.select_unit:D-c2'));
    await waitFor(() => expect(screen.queryByTestId('verify-result')).toBeNull());
    expect((within(screen.getByTestId('decision-form-override')).getByText('workspace.action.override').closest('button') as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(within(picker).getByLabelText('workspace.picker.select_unit:D-c2'));
    await userEvent.click(within(picker).getByText('workspace.picker.verify'));
    await waitFor(() => expect((within(screen.getByTestId('decision-form-override')).getByText('workspace.action.override').closest('button') as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(within(screen.getByTestId('decision-form-override')).getByText('workspace.action.override'));
    await waitFor(() => expect(h.postDecision).toHaveBeenCalledWith(ID, { run_id: RUN, line_id: 'line-4', action: 'override', unit_keys: ['c1'], reason: 'chosen manually' }));
  });

  it('drops the difference acknowledgement when the selected set (and its difference) changes, keeping the reason', async () => {
    const verify = (difference: number) => ({
      applied: false, line: { id: 'line-4', ordinal: 4, date: 'd', debit_minor: 400000, credit_minor: 0 }, units: [], expected_net_minor: -400000, set_net_minor: -400000 + difference,
      difference_minor: difference, tolerance_minor: 100, equal_within_tolerance: false, problems: [],
    });
    h.verifySet.mockResolvedValueOnce(verify(10000)).mockResolvedValueOnce(verify(50000));
    await open();
    await selectLine(4);
    await userEvent.click(within(screen.getByTestId('action-bar')).getByText('workspace.action.override'));
    const picker = await screen.findByTestId('candidate-picker');
    await userEvent.click(within(picker).getByLabelText('workspace.picker.select_unit:D-c1'));
    await userEvent.click(within(picker).getByText('workspace.picker.verify'));
    const form = await screen.findByTestId('decision-form-override');
    await userEvent.type(within(form).getByRole('textbox'), 'because');
    const box = await within(form).findByRole('checkbox');
    await userEvent.click(box);
    expect((box as HTMLInputElement).checked).toBe(true);
    const submit = within(form).getByText('workspace.action.override').closest('button') as HTMLButtonElement;
    expect(submit.disabled).toBe(false);

    await userEvent.click(within(picker).getByLabelText('workspace.picker.select_unit:D-c2'));
    await userEvent.click(within(picker).getByText('workspace.picker.verify'));
    await waitFor(() => expect(screen.getByTestId('verify-result').textContent).toContain('500.00'));
    const fresh = await within(screen.getByTestId('decision-form-override')).findByRole('checkbox');
    expect((fresh as HTMLInputElement).checked).toBe(false);
    expect((within(screen.getByTestId('decision-form-override')).getByRole('textbox') as HTMLTextAreaElement).value).toBe('because');
    expect((within(screen.getByTestId('decision-form-override')).getByText('workspace.action.override').closest('button') as HTMLButtonElement).disabled).toBe(true);
    expect(h.postDecision).not.toHaveBeenCalled();
  });

  it('a late success for line A neither clears nor disturbs the work in progress on line B (it still refreshes from the server)', async () => {
    let release: (value: unknown) => void = () => {};
    h.postDecision.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    await open();
    await selectLine(2);
    await userEvent.click(within(screen.getByTestId('action-bar')).getByText('workspace.action.confirm'));
    const formA = await screen.findByTestId('decision-form-confirm');
    await userEvent.type(within(formA).getByRole('textbox'), 'reason for A');
    await userEvent.click(within(formA).getByText('workspace.action.confirm'));
    await waitFor(() => expect(h.postDecision).toHaveBeenCalledTimes(1));

    await selectLine(4);
    await userEvent.click(within(screen.getByTestId('action-bar')).getByText('workspace.action.override'));
    const picker = await screen.findByTestId('candidate-picker');
    await userEvent.click(within(picker).getByLabelText('workspace.picker.select_unit:D-c1'));

    const statusCalls = h.fetchStatus.mock.calls.length;
    release(doneDecision);
    await waitFor(() => expect(h.fetchStatus.mock.calls.length).toBeGreaterThan(statusCalls));
    expect(screen.getByTestId('candidate-picker')).toBeTruthy();
    expect((within(screen.getByTestId('candidate-picker')).getByLabelText('workspace.picker.select_unit:D-c1') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByTestId('decision-form-override')).toBeTruthy();
  });

  it('a new matching run drops the verification and the difference acknowledgement being edited (fresh verify + fresh acknowledgement required)', async () => {
    const RUN2 = 'rrrrrrrr-2222-4rrr-8rrr-rrrrrrrrrrrr';
    h.verifySet.mockResolvedValue({
      applied: false, line: { id: 'line-4', ordinal: 4, date: 'd', debit_minor: 400000, credit_minor: 0 }, units: [], expected_net_minor: -400000, set_net_minor: -300000,
      difference_minor: -100000, tolerance_minor: 100, equal_within_tolerance: false, problems: [],
    });
    h.fetchMatches.mockImplementation(async (_i: string, q: { side: string }) => (q.side === 'ledger'
      ? matchesResponse([])
      : matchesResponse(rows(), { ledger_changed: true })));
    await open();
    await selectLine(4);
    await userEvent.click(within(screen.getByTestId('action-bar')).getByText('workspace.action.override'));
    const picker = await screen.findByTestId('candidate-picker');
    await userEvent.click(within(picker).getByLabelText('workspace.picker.select_unit:D-c1'));
    await userEvent.click(within(picker).getByText('workspace.picker.verify'));
    const form = await screen.findByTestId('decision-form-override');
    await userEvent.type(within(form).getByRole('textbox'), 'because');
    await userEvent.click(await within(form).findByRole('checkbox'));
    expect((within(form).getByText('workspace.action.override').closest('button') as HTMLButtonElement).disabled).toBe(false);

    // الدفتر تغيّر ⇒ تشغيلة جديدة
    h.runMatching.mockResolvedValue({ ...matchesResponse().run, id: RUN2, created: true, replayed: false });
    h.fetchStatus.mockResolvedValue(status({ run: { id: RUN2, scope: {}, ledger_fingerprint: 'fp2', created_at: null } }));
    h.fetchMatches.mockImplementation(async (_i: string, q: { side: string }) => (q.side === 'ledger'
      ? matchesResponse([])
      : { ...matchesResponse(rows()), run: { ...(matchesResponse().run as object), id: RUN2 } }));
    await userEvent.click(within(screen.getByTestId('ledger-changed')).getByText('workspace.match.run_again'));
    await waitFor(() => expect(screen.queryByTestId('candidate-picker')).toBeNull());
    expect(screen.queryByTestId('verify-result')).toBeNull();
    expect(screen.queryByTestId('decision-form-override')).toBeNull();
    expect(h.postDecision).not.toHaveBeenCalled();
  });

  it('never submits a decision with a newer run id against rows of the previous run (atomic run + rows publication)', async () => {
    const RUN2 = 'rrrrrrrr-2222-4rrr-8rrr-rrrrrrrrrrrr';
    const plain = [match(1), ...rows().slice(1)];
    h.fetchMatches.mockImplementation(async (_i: string, q: { side: string }) => (q.side === 'ledger' ? matchesResponse([]) : matchesResponse(plain)));
    await open();
    await selectLine(1);

    // تحديث يكتشف تشغيلة جديدة، بينما صفوفها لم تصل بعد
    let finish: (value: unknown) => void = () => {};
    h.fetchStatus.mockResolvedValue(status({ run: { id: RUN2, scope: {}, ledger_fingerprint: 'fp2', created_at: null } }));
    h.fetchMatches.mockImplementation((_i: string, q: { side: string }) => (q.side === 'ledger'
      ? Promise.resolve(matchesResponse([]))
      : new Promise((resolve) => (finish = resolve))));
    await userEvent.click(screen.getAllByRole('button', { name: /workspace\.outcome\.matched/, pressed: false })[0]);
    await waitFor(() => expect(h.fetchMatches.mock.calls.some(([, q]) => q.side === 'statement' && Array.isArray(q.outcomes) && q.outcomes[0] === 'matched')).toBe(true));

    // الصفوف المعروضة ما زالت للتشغيلة القديمة: أي قرار الآن يجب أن يحمل التشغيلة القديمة، لا الجديدة
    const confirm = within(screen.getByTestId('action-bar')).queryByText('workspace.action.confirm');
    expect(confirm).toBeTruthy();
    await userEvent.click(confirm as HTMLElement);
    await waitFor(() => expect(h.postDecision).toHaveBeenCalledTimes(1));
    expect(h.postDecision.mock.calls[0][1].run_id).toBe(RUN);
    finish(matchesResponse(plain, { run: { ...(matchesResponse().run as object), id: RUN2 } }));
    await waitFor(() => expect(screen.getByTestId('summary-bar')).toBeTruthy());
  });

  it('discards a decision-history response that arrives after the reviewer moved to another line', async () => {
    const decidedRows = rows().map((row, index) => (index === 1 ? { ...row, decision: { ...(rows()[0].decision as NonNullable<MatchRow['decision']>), id: 'd2', line_id: 'line-2', run_id: RUN } } : row));
    h.fetchMatches.mockImplementation(async (_i: string, q: { side: string }) => (q.side === 'ledger' ? matchesResponse([]) : matchesResponse(decidedRows)));
    let release: (value: unknown) => void = () => {};
    h.fetchLineHistory.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    await open();
    await selectLine(1);
    await userEvent.click(screen.getByText('workspace.detail.history'));
    await selectLine(2);
    release([{ id: 'x', revision: 7, action: 'override', reason: 'belongs to line one', created_at: '2026-04-03T10:00:00Z' }]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByTestId('line-history')).toBeNull();
    expect(document.body.textContent).not.toContain('belongs to line one');
  });

  it('refreshes the header after a state conflict so write controls disappear when another reviewer already moved the reconciliation', async () => {
    h.postDecision.mockRejectedValueOnce(new ApiError(409, 'x', { reason: 'reconciliation_not_editable' }));
    await open();
    await selectLine(2);
    await userEvent.click(within(screen.getByTestId('action-bar')).getByText('workspace.action.confirm'));
    const form = await screen.findByTestId('decision-form-confirm');
    await userEvent.type(within(form).getByRole('textbox'), 'reasoned');
    // بين الإرسال والرفض: مراجِع آخر نقل المقارنة إلى «مراجَعة»
    h.fetchHeader.mockResolvedValue(header({ status: 'reviewed' }));
    h.fetchStatus.mockResolvedValue(status({
      reconciliation: { id: ID, status: 'reviewed', reviewed_at: null, reviewed_by: 'other', reviewed_run_id: RUN }, blockers: [],
      reviewed_state: { run_id: RUN, ledger_changed_since_review: false, statement_changed_since_review: false },
    }, { can_mark_reviewed: false, resolved: 4, unresolved: 0 }));
    await userEvent.click(within(form).getByText('workspace.action.confirm'));
    await waitFor(() => expect(screen.queryByTestId('action-bar')).toBeNull());
    expect(screen.getByTestId('reviewed-banner')).toBeTruthy();
    expect(h.postDecision).toHaveBeenCalledTimes(1);
  });

  it('closes an open decision form (no submit) when the workspace becomes read-only underneath it', async () => {
    await open();
    await selectLine(2);
    await userEvent.click(within(screen.getByTestId('action-bar')).getByText('workspace.action.confirm'));
    const form = await screen.findByTestId('decision-form-confirm');
    await userEvent.type(within(form).getByRole('textbox'), 'about to submit');
    expect((within(form).getByText('workspace.action.confirm').closest('button') as HTMLButtonElement).disabled).toBe(false);

    // مراجِع آخر نقل المقارنة إلى «مراجَعة»؛ تحديث يلتقط ذلك
    h.fetchHeader.mockResolvedValue(header({ status: 'reviewed' }));
    h.fetchStatus.mockResolvedValue(status({
      reconciliation: { id: ID, status: 'reviewed', reviewed_at: null, reviewed_by: 'other', reviewed_run_id: RUN }, blockers: [],
      reviewed_state: { run_id: RUN, ledger_changed_since_review: false, statement_changed_since_review: false },
    }, { can_mark_reviewed: false, resolved: 4, unresolved: 0 }));
    await userEvent.click(screen.getAllByRole('button', { name: /workspace\.outcome\.date_difference/, pressed: false })[0]);
    await waitFor(() => expect(screen.queryByTestId('decision-form-confirm')).toBeNull());
    expect(screen.queryByTestId('action-bar')).toBeNull();
    expect(h.postDecision).not.toHaveBeenCalled();
  });

  it('a decision that completes after the reviewer moved to another page refreshes the CURRENT page, not the page it was submitted from', async () => {
    const pages: Record<number, MatchRow[]> = { 1: rows(), 2: [match(26), match(27)] };
    h.fetchStatus.mockResolvedValue(status({}, { lines_total: 40 }));
    h.fetchMatches.mockImplementation(async (_i: string, q: { side: string; page: number }) => (q.side === 'ledger'
      ? matchesResponse([])
      : matchesResponse(pages[q.page] ?? [], { meta: { current_page: q.page, last_page: 2, per_page: 25, total: 6 } })));
    let release: (value: unknown) => void = () => {};
    h.postDecision.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    await open();
    await selectLine(2);
    await userEvent.click(within(screen.getByTestId('action-bar')).getByText('workspace.action.confirm'));
    const form = await screen.findByTestId('decision-form-confirm');
    await userEvent.type(within(form).getByRole('textbox'), 'reason for line 2');
    await userEvent.click(within(form).getByText('workspace.action.confirm'));
    await waitFor(() => expect(h.postDecision).toHaveBeenCalledTimes(1));

    // انتقال إلى الصفحة 2 قبل اكتمال القرار
    await userEvent.click(screen.getByLabelText('nextPage'));
    await screen.findAllByText('INV-26');

    const before = h.fetchMatches.mock.calls.filter(([, q]) => q.side === 'statement').length;
    release(doneDecision);
    await waitFor(() => expect(h.fetchMatches.mock.calls.filter(([, q]) => q.side === 'statement').length).toBeGreaterThan(before));
    const statementCalls = h.fetchMatches.mock.calls.filter(([, q]) => q.side === 'statement');
    expect(statementCalls.at(-1)?.[1].page).toBe(2);
    expect(screen.getAllByText('INV-26').length).toBeGreaterThan(0);
  });

  it.each([['review'], ['reopen']] as const)('a %s request that completes after the reviewer moved to another page refreshes the CURRENT page', async (kind) => {
    const pages: Record<number, MatchRow[]> = { 1: rows(), 2: [match(26), match(27)] };
    const reviewed = kind === 'reopen';
    h.fetchHeader.mockResolvedValue(header({ status: reviewed ? 'reviewed' : 'draft' }));
    h.fetchStatus.mockResolvedValue(reviewed
      ? status({ reconciliation: { id: ID, status: 'reviewed', reviewed_at: null, reviewed_by: 'u', reviewed_run_id: RUN }, blockers: [], reviewed_state: { run_id: RUN, ledger_changed_since_review: false, statement_changed_since_review: false } }, { lines_total: 40, can_mark_reviewed: false, resolved: 4, unresolved: 0 })
      : status({ blockers: [] }, { lines_total: 40, can_mark_reviewed: true, resolved: 4, unresolved: 0 }));
    h.fetchMatches.mockImplementation(async (_i: string, q: { side: string; page: number }) => (q.side === 'ledger'
      ? matchesResponse([])
      : matchesResponse(pages[q.page] ?? [], { meta: { current_page: q.page, last_page: 2, per_page: 25, total: 6 } })));
    let release: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => (release = resolve));
    h.markReviewed.mockReturnValue(pending);
    h.reopenReconciliation.mockReturnValue(pending);
    await open();

    if (reviewed) {
      await userEvent.click(screen.getByText('workspace.readiness.reopen'));
      await userEvent.type(screen.getByRole('textbox', { name: /workspace\.readiness\.reopen_reason/ }), 'needs a change');
      await userEvent.click(screen.getByText('workspace.readiness.reopen_confirm'));
      await waitFor(() => expect(h.reopenReconciliation).toHaveBeenCalledTimes(1));
    } else {
      await userEvent.click(screen.getByTestId('review-button'));
      await waitFor(() => expect(h.markReviewed).toHaveBeenCalledTimes(1));
    }

    await userEvent.click(screen.getByLabelText('nextPage'));
    await screen.findAllByText('INV-26');
    const before = h.fetchMatches.mock.calls.filter(([, q]) => q.side === 'statement').length;
    release(undefined);
    await waitFor(() => expect(h.fetchMatches.mock.calls.filter(([, q]) => q.side === 'statement').length).toBeGreaterThan(before));
    expect(h.fetchMatches.mock.calls.filter(([, q]) => q.side === 'statement').at(-1)?.[1].page).toBe(2);
    expect(screen.getAllByText('INV-26').length).toBeGreaterThan(0);
  });

  it('blocks an override whose verification reports problems', async () => {
    h.verifySet.mockResolvedValue({
      applied: false, line: { id: 'line-4', ordinal: 4, date: 'd', debit_minor: 1, credit_minor: 0 }, units: [], expected_net_minor: -1, set_net_minor: 0, difference_minor: -1, tolerance_minor: 0,
      equal_within_tolerance: false, problems: [{ code: 'unit_not_matchable', params: { unit_key: 'c1', state: 'neutralised' } }],
    });
    await open();
    await selectLine(4);
    await userEvent.click(within(screen.getByTestId('action-bar')).getByText('workspace.action.override'));
    const picker = await screen.findByTestId('candidate-picker');
    await userEvent.click(within(picker).getByLabelText('workspace.picker.select_unit:D-c1'));
    await userEvent.click(within(picker).getByText('workspace.picker.verify'));
    expect((await screen.findByTestId('verify-problem')).textContent).toContain('workspace.verify_problem.unit_not_matchable');
    const form = await screen.findByTestId('decision-form-override');
    await userEvent.type(within(form).getByRole('textbox'), 'attempt');
    expect((within(form).getByText('workspace.action.override').closest('button') as HTMLButtonElement).disabled).toBe(true);
    expect(h.postDecision).not.toHaveBeenCalled();
  });

  it('shows a translated stale-run error and refreshes from the server without re-sending', async () => {
    h.postDecision.mockRejectedValue(new ApiError(409, 'raw server text', { reason: 'run_stale' }));
    const before = h.fetchStatus.mock.calls.length;
    await open();
    await selectLine(2);
    await userEvent.click(within(screen.getByTestId('action-bar')).getByText('workspace.action.confirm'));
    const form = await screen.findByTestId('decision-form-confirm');
    await userEvent.type(within(form).getByRole('textbox'), 'reasoned');
    await userEvent.click(within(form).getByText('workspace.action.confirm'));
    const error = await screen.findByTestId('decision-error');
    expect(error.textContent).toContain('errors.family_stale');
    expect(error.textContent).not.toContain('raw server text');
    await waitFor(() => expect(h.fetchStatus.mock.calls.length).toBeGreaterThan(before + 1));
    expect(h.postDecision).toHaveBeenCalledTimes(1);
  });

  it('reveals the acceptance control when the server reports the difference exceeds the tolerance', async () => {
    h.postDecision.mockRejectedValueOnce(new ApiError(422, 'x', { reason: 'difference_exceeds_tolerance', details: { difference_minor: 9000, tolerance_minor: 100 } }));
    await open();
    await selectLine(3);
    await userEvent.click(within(screen.getByTestId('action-bar')).getByText('workspace.action.link_pair'));
    h.fetchReversedPairs.mockResolvedValue({
      pairs: [{ unit_key: 'pair-1', kind: 'invoice', state: 'neutralised', reasons: [], entry_numbers: ['A', 'B'], reviewable: true, blocked_reason: null,
        original: { entry_id: 'e1', number: 'A', date: '2026-01-01', net_minor: -100000, claimed: false, line_id: null }, reversal: { entry_id: 'e2', number: 'B', date: '2026-01-02', net_minor: 100000, claimed: false, line_id: null } }],
      truncated: false,
    });
    cleanup();
    await open();
    await selectLine(3);
    await userEvent.click(within(screen.getByTestId('action-bar')).getByText('workspace.action.link_pair'));
    const pair = await screen.findByTestId('reversed-pair');
    await userEvent.click(within(pair).getAllByText('workspace.pairs.link')[0]);
    const form = await screen.findByTestId('decision-form-link_pair');
    await userEvent.type(within(form).getByRole('textbox'), 'proven reversal');
    await userEvent.click(within(form).getByText('workspace.action.link_pair'));
    expect(await within(form).findByRole('checkbox')).toBeTruthy();
    expect(h.postDecision).toHaveBeenCalledTimes(1);
    expect(h.postDecision.mock.calls[0][1]).toMatchObject({ action: 'link_pair', unit_keys: ['pair-1'], pair_member: 'original', reason: 'proven reversal' });
  });

  it('keeps only the typed reason as a session draft and restores it after an interruption', async () => {
    await open();
    await selectLine(2);
    await userEvent.click(within(screen.getByTestId('action-bar')).getByText('workspace.action.confirm'));
    await userEvent.type(within(await screen.findByTestId('decision-form-confirm')).getByRole('textbox'), 'half written');
    const stored = Object.keys(window.sessionStorage).filter((key) => key.startsWith('ps-reason-draft:'));
    expect(stored).toHaveLength(1);
    expect(window.sessionStorage.getItem(stored[0])).not.toMatch(/INV-2|100000|شركة/);
    cleanup();
    await open();
    await selectLine(2);
    await userEvent.click(within(screen.getByTestId('action-bar')).getByText('workspace.action.confirm'));
    expect((within(await screen.findByTestId('decision-form-confirm')).getByRole('textbox') as HTMLTextAreaElement).value).toBe('half written');
  });
});

describe('PartnerStatementWorkspace — keyboard, filters and next undecided', () => {
  it('moves between rows with the arrow keys and opens a row with Enter', async () => {
    await open();
    const first = document.querySelector('tr[data-line-id="line-1"]') as HTMLElement;
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement?.getAttribute('data-line-id')).toBe('line-2');
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter' });
    expect((await screen.findByTestId('line-detail')).textContent).toContain('INV-2');
    expect(document.querySelector('tr[aria-selected="true"]')?.getAttribute('data-line-id')).toBe('line-2');
  });

  it('jumps to the next line without a valid decision with the N key', async () => {
    await open();
    const first = document.querySelector('tr[data-line-id="line-1"]') as HTMLElement;
    first.focus();
    fireEvent.keyDown(first, { key: 'n' });
    await waitFor(() => expect(document.querySelector('tr[aria-selected="true"]')?.getAttribute('data-line-id')).toBe('line-2'));
  });

  it('keeps searching later pages while only other-run (outdated) decisions remain', async () => {
    const decided = rows().map((row, index) => ({ ...row, decision: { ...(rows()[0].decision as NonNullable<MatchRow['decision']>), id: `dd${index}`, line_id: `line-${index + 1}`, run_id: RUN } }));
    h.fetchMatches.mockImplementation(async (_i: string, q: { side: string; page: number }) => (q.side === 'ledger'
      ? matchesResponse([])
      : matchesResponse(decided, { meta: { current_page: q.page, last_page: 2, per_page: 25, total: 8 } })));
    h.fetchStatus.mockResolvedValue(status({ blockers: [{ code: 'decisions_on_other_runs', count: 2 }] }, { unresolved: 0, decisions_on_other_runs: 2, resolved: 4 }));
    await open();
    const first = document.querySelector('tr[data-line-id="line-1"]') as HTMLElement;
    first.focus();
    fireEvent.keyDown(first, { key: 'n' });
    await waitFor(() => expect(h.fetchMatches.mock.calls.some(([, q]) => q.side === 'statement' && q.page === 2)).toBe(true));
    expect(screen.queryByTestId('workspace-notice')?.textContent ?? '').not.toContain('workspace.no_more_undecided');
  });

  it('filters by engine outcome through the server and exposes the counts from the run', async () => {
    await open();
    await userEvent.click(screen.getAllByRole('button', { name: /workspace\.outcome\.date_difference/, pressed: false })[0]);
    await waitFor(() => expect(h.fetchMatches.mock.calls.some(([, q]) => q.side === 'statement' && JSON.stringify(q.outcomes) === JSON.stringify(['date_difference']))).toBe(true));
  });

  it('shows ledger-only records in their own informational tab (no decision controls)', async () => {
    await open();
    await userEvent.click(screen.getByRole('tab', { name: /workspace\.tabs\.ledger/ }));
    const list = await screen.findByTestId('ledger-only');
    expect(within(list).getByText('D-free-1')).toBeTruthy();
    for (const action of ['confirm', 'override', 'dismiss', 'link_pair', 'clear']) expect(within(list).queryByText(`workspace.action.${action}`)).toBeNull();
    expect(screen.queryByTestId('action-bar')).toBeNull();
  });
});

describe('PartnerStatementWorkspace — readiness, review and reopen', () => {
  it('offers review only when the server reports eligibility, and posts the explicit review once', async () => {
    h.fetchStatus.mockResolvedValue(status({ blockers: [] }, { can_mark_reviewed: false, resolved: 4, unresolved: 0 }));
    await open();
    expect((screen.getByTestId('review-button') as HTMLButtonElement).disabled).toBe(true);

    cleanup();
    h.fetchStatus.mockResolvedValue(status({ blockers: [] }, { can_mark_reviewed: true, resolved: 4, unresolved: 0 }));
    let finish: (value: unknown) => void = () => {};
    h.markReviewed.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await open();
    const button = screen.getByTestId('review-button') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await userEvent.type(screen.getByRole('textbox', { name: /workspace\.readiness\.note/ }), 'looks right');
    await userEvent.dblClick(button);
    await waitFor(() => expect(h.markReviewed).toHaveBeenCalledTimes(1));
    expect(h.markReviewed).toHaveBeenCalledTimes(1);
    expect(h.markReviewed).toHaveBeenCalledWith(ID, RUN, 'looks right');
    finish({ status: status(), replayed: false });
  });

  it('lists blockers with go-to-line shortcuts and no review button for a view-only user', async () => {
    h.perms = ['partner_statements.view'];
    await open();
    const blockers = screen.getByTestId('blockers');
    expect(within(blockers).getByText('#3')).toBeTruthy();
    expect(screen.queryByTestId('review-button')).toBeNull();
  });

  it('go-to-line selects the line on the page', async () => {
    await open();
    await userEvent.click(within(screen.getByTestId('blockers')).getByText('#3'));
    await waitFor(() => expect(document.querySelector('tr[aria-selected="true"]')?.getAttribute('data-line-id')).toBe('line-3'));
  });

  it('go-to-line finds the page of a NON-contiguous source-row ordinal by searching the server pages', async () => {
    // أرقام الصفوف الأصلية: ترويسة + فجوات؛ الصفحة 1 = 2..5، الثانية = 26..27، الثالثة = 51..52 (لا علاقة حسابية بين الرقم والصفحة)
    const pages: Record<number, number[]> = { 1: [2, 3, 4, 5], 2: [26, 27], 3: [51, 52] };
    h.fetchStatus.mockResolvedValue(status({ blockers: [{ code: 'unresolved_lines', count: 1, sample_ordinals: [51] }] }, { lines_total: 60, unresolved: 1, resolved: 59 }));
    h.fetchMatches.mockImplementation(async (_i: string, q: { side: string; page: number }) => (q.side === 'ledger'
      ? matchesResponse([])
      : matchesResponse((pages[q.page] ?? []).map((n) => match(n)), { meta: { current_page: q.page, last_page: 3, per_page: 25, total: 8 } })));
    render(<PartnerStatementWorkspace id={ID} />);
    await screen.findAllByText('INV-2');
    await userEvent.click(within(await screen.findByTestId('blockers')).getByText('#51'));
    await waitFor(() => expect(document.querySelector('tr[aria-selected="true"]')?.getAttribute('data-line-id')).toBe('line-51'));
    expect(h.fetchMatches.mock.calls.some(([, q]) => q.side === 'statement' && q.page === 2)).toBe(true);
  });

  it('go-to-line: an ordinal that the arithmetic guess would send to the wrong page is still found', async () => {
    // الترتيب 26 على الصفحة 1 (لا على 2 كما يخمّن ⌊(26−1)/25⌋+1)
    const pages: Record<number, number[]> = { 1: [2, 3, 26], 2: [40, 41] };
    h.fetchStatus.mockResolvedValue(status({ blockers: [{ code: 'unresolved_lines', count: 1, sample_ordinals: [26] }] }, { lines_total: 30, unresolved: 1, resolved: 29 }));
    h.fetchMatches.mockImplementation(async (_i: string, q: { side: string; page: number }) => (q.side === 'ledger'
      ? matchesResponse([])
      : matchesResponse((pages[q.page] ?? []).map((n) => match(n)), { meta: { current_page: q.page, last_page: 2, per_page: 25, total: 5 } })));
    render(<PartnerStatementWorkspace id={ID} />);
    await screen.findAllByText('INV-2');
    await userEvent.click(within(await screen.findByTestId('blockers')).getByText('#26'));
    await waitFor(() => expect(document.querySelector('tr[aria-selected="true"]')?.getAttribute('data-line-id')).toBe('line-26'));
  });

  it('go-to-line tells the user when the ordinal is not found instead of failing silently', async () => {
    const pages: Record<number, number[]> = { 1: [2, 3, 4] };
    h.fetchStatus.mockResolvedValue(status({ blockers: [{ code: 'unresolved_lines', count: 1, sample_ordinals: [99] }] }, { lines_total: 3, unresolved: 1, resolved: 2 }));
    h.fetchMatches.mockImplementation(async (_i: string, q: { side: string; page: number }) => (q.side === 'ledger'
      ? matchesResponse([])
      : matchesResponse((pages[q.page] ?? []).map((n) => match(n)))));
    render(<PartnerStatementWorkspace id={ID} />);
    await screen.findAllByText('INV-2');
    await userEvent.click(within(await screen.findByTestId('blockers')).getByText('#99'));
    expect((await screen.findByTestId('workspace-notice')).textContent).toContain('workspace.line_not_found');
  });

  it('discards a pending verification when the reviewer moves to another line (no cross-line acknowledgement)', async () => {
    let release: (value: unknown) => void = () => {};
    h.verifySet.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    await open();
    await selectLine(4);
    await userEvent.click(within(screen.getByTestId('action-bar')).getByText('workspace.action.override'));
    let picker = await screen.findByTestId('candidate-picker');
    await userEvent.click(within(picker).getByLabelText('workspace.picker.select_unit:D-free-1'));
    await userEvent.click(within(picker).getByText('workspace.picker.verify'));
    // انتقل إلى سطر آخر واختر الوحدة نفسها قبل وصول ردّ السطر الأول
    await selectLine(3);
    await userEvent.click(within(screen.getByTestId('action-bar')).getByText('workspace.action.override'));
    picker = await screen.findByTestId('candidate-picker');
    await userEvent.click(within(picker).getByLabelText('workspace.picker.select_unit:D-free-1'));
    release({
      applied: false, line: { id: 'line-4', ordinal: 4, date: 'd', debit_minor: 400000, credit_minor: 0 }, units: [], expected_net_minor: -400000, set_net_minor: -5000,
      difference_minor: -395000, tolerance_minor: 100, equal_within_tolerance: false, problems: [],
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByTestId('verify-result')).toBeNull();
    expect(screen.getByTestId('verify-required')).toBeTruthy();
  });

  it('a reviewed comparison offers reopen with a mandatory reason and warns about a changed ledger', async () => {
    h.fetchHeader.mockResolvedValue(header({ status: 'reviewed' }));
    h.fetchStatus.mockResolvedValue(status({
      reconciliation: { id: ID, status: 'reviewed', reviewed_at: null, reviewed_by: 'u', reviewed_run_id: RUN }, blockers: [],
      reviewed_state: { run_id: RUN, ledger_changed_since_review: true, statement_changed_since_review: false },
    }, { can_mark_reviewed: false, resolved: 4, unresolved: 0 }));
    h.reopenReconciliation.mockResolvedValue(undefined);
    await open();
    expect(screen.getByTestId('ledger-changed-since-review')).toBeTruthy();
    await selectLine(2);
    expect(screen.queryByTestId('action-bar')).toBeNull();
    await userEvent.click(screen.getByText('workspace.readiness.reopen'));
    const confirm = screen.getByText('workspace.readiness.reopen_confirm').closest('button') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await userEvent.type(screen.getByRole('textbox', { name: /workspace\.readiness\.reopen_reason/ }), 'ab');
    expect(confirm.disabled).toBe(true);
    await userEvent.type(screen.getByRole('textbox', { name: /workspace\.readiness\.reopen_reason/ }), 'c');
    await userEvent.click(confirm);
    await waitFor(() => expect(h.reopenReconciliation).toHaveBeenCalledWith(ID, 'abc'));
  });

  it('surfaces a translated review rejection', async () => {
    h.fetchStatus.mockResolvedValue(status({ blockers: [] }, { can_mark_reviewed: true, resolved: 4, unresolved: 0 }));
    h.markReviewed.mockRejectedValue(new ApiError(409, 'x', { reason: 'run_stale' }));
    await open();
    await userEvent.click(screen.getByTestId('review-button'));
    expect((await screen.findByTestId('lifecycle-error')).textContent).toContain('errors.family_stale');
  });
});
