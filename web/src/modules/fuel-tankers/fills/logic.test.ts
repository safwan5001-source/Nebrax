import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import { actions, attemptSummary, detail, fillResource, postingFacts, postingPreview, readyReadiness, reversalPreview, row, workspace } from './__fixtures__';
import {
  blockerKey, isHidden, isKnownReason, isTab, litersOf, postingPayload, postingProblem, queryEntries, readDetail, readPostingPreview, readReversalPreview, readWorkspace, readWriteSuccess,
  reversalPayload, reversalProblem, shortId, KNOWN_BLOCKERS, type FillActions,
} from './logic';
import { classifyWriteError, verifyAfterUnknown } from './outcome';

const allow = (over: Partial<FillActions> = {}): FillActions => ({ ...actions(), ...over, preview_post: true, preview_reversal: true } as FillActions);

describe('queryEntries', () => {
  it('omits defaults and empties (pending tab, page 1, blank search) and trims/caps the search', () => {
    expect(queryEntries({})).toEqual([]);
    expect(queryEntries({ tab: 'pending', page: 1, q: '   ', stationId: '' })).toEqual([]);
    expect(queryEntries({ tab: 'attention', stationId: 'abc', q: '  04052  ', page: 3, perPage: 1 })).toEqual([['tab', 'attention'], ['station_id', 'abc'], ['q', '04052'], ['page', '3'], ['per_page', '1']]);
    expect(queryEntries({ q: 'x'.repeat(100) })[0][1]).toHaveLength(64);
  });

  it('recognises only the four tabs', () => {
    for (const tab of ['pending', 'posted', 'reversed', 'attention']) expect(isTab(tab)).toBe(true);
    expect(isTab('all')).toBe(false);
    expect(isTab(undefined)).toBe(false);
  });
});

describe('readWorkspace', () => {
  it('reads rows with fill state and last attempt kept apart, plus tab counts', () => {
    const page = readWorkspace(workspace([row({}, { posting_status: null, posted_at: null, reversed_at: null, posted_cost_minor: null, last_attempt: attemptSummary(), attempts_count: 2 }, readyReadiness({ readiness: 'blocked', blockers: ['stock_record_missing'] }))], { attention: 1 }));
    expect(page.rows[0].inventory_status).toBe('pending_integration');
    expect(page.rows[0].inventory?.last_attempt).toMatchObject({ operation: 'post', outcome: 'rejected', reason_code: 'insufficient_stock' });
    expect(page.rows[0].readiness).toMatchObject({ readiness: 'blocked', blockers: ['stock_record_missing'] });
    expect(page.counts).toEqual({ pending: 1, posted: 0, reversed: 0, attention: 1 });
  });

  it('rejects the whole response when it does not conform (fail closed)', () => {
    expect(() => readWorkspace({})).toThrow();
    expect(() => readWorkspace({ data: [{ id: 'x' }], meta: { counts: {} } })).toThrow();
    expect(() => readWorkspace(workspace([row({ inventory_status: 'weird' })]))).toThrow();
    expect(() => readWorkspace({ data: [], meta: {} })).toThrow(); // counts are required
  });

  it('keeps a pending row without readiness (non-pending tabs) and defaults a missing readiness enum to needs_review', () => {
    const page = readWorkspace(workspace([row(), row({ id: 'r2' }, null, { blockers: [] })]));
    expect(page.rows[0].readiness).toBeNull();
    expect(page.rows[1].readiness?.readiness).toBe('needs_review');
  });
});

describe('readDetail', () => {
  it('distinguishes an absent cost (no permission) from a present one and keeps accounts null', () => {
    const withCost = readDetail(detail({ inventory_status: 'posted' }, { posting: postingFacts() }));
    expect(withCost.inventory.posting?.posted_cost_minor).toBe(654_321);
    const hidden = postingFacts();
    delete (hidden as Record<string, unknown>).posted_cost_minor;
    delete (hidden as Record<string, unknown>).journal_entry;
    const withoutCost = readDetail(detail({ inventory_status: 'posted' }, { posting: hidden }));
    expect(withoutCost.inventory.posting?.posted_cost_minor).toBeUndefined();
    expect(withoutCost.inventory.posting?.journal_entry).toBeNull();
    expect(withoutCost.inventory.accounts).toBeNull();
  });

  it('turns missing or null actions into false (never a button by accident) and rejects non-boolean ones', () => {
    const payload = detail();
    (payload.data as Record<string, unknown>).actions = { post: null, reverse: undefined };
    expect(readDetail(payload).actions).toEqual({ preview_post: false, post: false, post_historical: false, preview_reversal: false, reverse: false });
    (payload.data as Record<string, unknown>).actions = { post: 'yes' };
    expect(() => readDetail(payload)).toThrow();
    delete (payload.data as Record<string, unknown>).actions;
    expect(() => readDetail(payload)).toThrow();
  });

  it('rejects a detail without the inventory block or with an unknown status', () => {
    const missing = detail();
    delete (missing.data as Record<string, unknown>).inventory;
    expect(() => readDetail(missing)).toThrow();
    expect(() => readDetail(detail({ inventory_status: 'weird' }))).toThrow();
  });

  it('never exposes fields outside the contract (strip)', () => {
    const payload = detail({ idempotency_key: 'secret', tenant_id: 't' });
    expect(Object.keys(readDetail(payload))).not.toContain('tenant_id');
    expect(Object.keys(readDetail(payload))).not.toContain('idempotency_key');
  });
});

describe('previews', () => {
  it('normalises the posting preview and keeps account/amount masking as null', () => {
    const open = readPostingPreview(postingPreview());
    expect(open).toMatchObject({ operation: 'post', status: 'ready', historical: false, amountMinor: 654_321, hasEntry: true });
    expect(open.lines.map((l) => l.role)).toEqual(['tanker_issue_clearing', 'inventory']);

    const masked = readPostingPreview(postingPreview({ entry: { lines: [{ side: 'debit', account_id: null, role: 'tanker_issue_clearing' }], entry_date: '2027-01-26', amount_minor: null } }));
    expect(masked.amountMinor).toBeNull();
    expect(isHidden(masked.amountMinor)).toBe(true);
    expect(masked.lines[0].accountId).toBeNull();
  });

  it('maps blocked and not_applicable and the historical flag', () => {
    expect(readPostingPreview(postingPreview({ status: 'blocked', blockers: ['period_locked'], historical: true }))).toMatchObject({ status: 'blocked', blockers: ['period_locked'], historical: true });
    expect(readPostingPreview(postingPreview({ status: 'not_applicable', entry: null }))).toMatchObject({ status: 'not_applicable', hasEntry: false });
    expect(() => readPostingPreview(postingPreview({ status: 'maybe' }))).toThrow();
  });

  it('normalises the reversal preview (no roles, historical cost valuation, reversal date)', () => {
    const preview = readReversalPreview(reversalPreview());
    expect(preview).toMatchObject({ operation: 'reverse', status: 'ready', valuation: 'historical_cost', entryDate: '2027-02-01', quantityMilliliters: 2_000_000, historical: false });
    expect(preview.lines.every((l) => l.role === null)).toBe(true);
    expect(readReversalPreview(reversalPreview({ status: 'blocked', blockers: ['downstream_link:invoiced_invoice_id'], entry: null })).blockers).toEqual(['downstream_link:invoiced_invoice_id']);
  });
});

describe('write success', () => {
  it('reads the fill state and the replayed flag', () => {
    expect(readWriteSuccess({ data: fillResource({ inventory_status: 'posted' }), meta: { replayed: true } })).toEqual({ fillId: fillResource().id, inventoryStatus: 'posted', replayed: true });
    expect(readWriteSuccess({ data: fillResource({ inventory_status: 'reversed' }) }).replayed).toBe(false);
    expect(() => readWriteSuccess({ data: {} })).toThrow();
    expect(() => readWriteSuccess(null)).toThrow();
  });
});

describe('server code translation keys', () => {
  it('maps known blockers, buckets downstream links, and leaves unknown codes to show raw', () => {
    for (const code of KNOWN_BLOCKERS) expect(blockerKey(code)).toBe(code);
    expect(blockerKey('downstream_link:invoiced_invoice_id')).toBe('downstream_invoiced');
    expect(blockerKey('downstream_link:invoiced_at')).toBe('downstream_invoiced');
    expect(blockerKey('downstream_link:settlement_id')).toBe('downstream_settled');
    expect(blockerKey('downstream_link:supply_id')).toBe('downstream_supply');
    expect(blockerKey('downstream_link:something_new')).toBeNull();
    expect(blockerKey('brand_new_code')).toBeNull();
  });

  it('knows the documented rejection reasons', () => {
    for (const code of ['posting_blocked', 'fill_voided', 'historical_review_required', 'distinct_approver_required', 'period_locked', 'reversal_blocked', 'original_entry_invalid', 'forbidden']) expect(isKnownReason(code)).toBe(true);
    expect(isKnownReason('mystery')).toBe(false);
    expect(isKnownReason(null)).toBe(false);
  });
});

describe('posting confirmation rules', () => {
  const ready = readPostingPreview(postingPreview());
  const historical = readPostingPreview(postingPreview({ historical: true }));
  const blocked = readPostingPreview(postingPreview({ status: 'blocked', blockers: ['period_locked'] }));
  const input = (reason = '', reviewedHistorical = false) => ({ reason, reviewedHistorical });

  it('needs a loaded preview, a server-granted action and a ready status', () => {
    expect(postingProblem(null, allow(), input())).toBe('preview_missing');
    expect(postingProblem(ready, allow({ post: false }), input())).toBe('action_not_allowed');
    expect(postingProblem(blocked, allow(), input())).toBe('not_ready');
    expect(postingProblem(ready, allow(), input())).toBeNull();
  });

  it('a normal fill needs nothing else; the optional note is bounded', () => {
    expect(postingProblem(ready, allow(), input('ملاحظة'))).toBeNull();
    expect(postingProblem(ready, allow(), input('x'.repeat(501)))).toBe('reason_too_long');
    expect(postingProblem(ready, allow(), input('x'.repeat(500)))).toBeNull();
  });

  it('a historical fill needs the historical permission, the review checkbox and a reason (in that order)', () => {
    expect(postingProblem(historical, allow({ post_historical: false }), input('سبب', true))).toBe('historical_permission_missing');
    expect(postingProblem(historical, allow({ post_historical: true }), input('سبب', false))).toBe('historical_review_required');
    expect(postingProblem(historical, allow({ post_historical: true }), input('   ', true))).toBe('reason_required');
    expect(postingProblem(historical, allow({ post_historical: true }), input('سبب', true))).toBeNull();
  });

  it('builds only reason and confirm_historical — never a quantity, cost, account or date', () => {
    expect(postingPayload(ready, input(''))).toEqual({});
    expect(postingPayload(ready, input('  ملاحظة  '))).toEqual({ reason: 'ملاحظة' });
    expect(postingPayload(historical, input('سبب', true))).toEqual({ reason: 'سبب', confirm_historical: true });
    for (const payload of [postingPayload(ready, input('x')), postingPayload(historical, input('x', true)), reversalPayload('x')]) {
      expect(Object.keys(payload).every((key) => key === 'reason' || key === 'confirm_historical')).toBe(true);
    }
  });
});

describe('reversal confirmation rules', () => {
  const ready = readReversalPreview(reversalPreview());
  const blocked = readReversalPreview(reversalPreview({ status: 'blocked', blockers: ['not_posted'], entry: null }));

  it('requires a preview, the server action and a reversible status', () => {
    expect(reversalProblem(null, allow(), 'سبب العكس')).toBe('preview_missing');
    expect(reversalProblem(ready, allow({ reverse: false }), 'سبب العكس')).toBe('action_not_allowed');
    expect(reversalProblem(blocked, allow({ reverse: true }), 'سبب العكس')).toBe('not_ready');
  });

  it('the reason is mandatory, 3..500 after trimming', () => {
    const permitted = allow({ reverse: true });
    expect(reversalProblem(ready, permitted, '')).toBe('reason_required');
    expect(reversalProblem(ready, permitted, '    ')).toBe('reason_required');
    expect(reversalProblem(ready, permitted, ' ab ')).toBe('reason_too_short');
    expect(reversalProblem(ready, permitted, 'abc')).toBeNull();
    expect(reversalProblem(ready, permitted, 'x'.repeat(500))).toBeNull();
    expect(reversalProblem(ready, permitted, 'x'.repeat(501))).toBe('reason_too_long');
    expect(reversalPayload('  سبب العكس  ')).toEqual({ reason: 'سبب العكس' });
  });
});

describe('display helpers', () => {
  it('converts ml to liters with integers only', () => {
    expect(litersOf(2_000_000)).toBe('2000.000');
    expect(litersOf(1)).toBe('0.001');
    expect(litersOf(1234)).toBe('1.234');
    expect(litersOf(null)).toBe('—');
    expect(litersOf(undefined)).toBe('—');
  });

  it('shortens ids and treats null/undefined as hidden (zero is not hidden)', () => {
    expect(shortId('11111111-2222-4333-8444-555555555551')).toBe('11111111…');
    expect(shortId('abc')).toBe('abc');
    expect(isHidden(null)).toBe(true);
    expect(isHidden(undefined)).toBe(true);
    expect(isHidden(0)).toBe(false);
  });
});

describe('write outcome classification', () => {
  it('a 4xx with reason and details is a rejection (no effect) carrying the blockers', () => {
    const outcome = classifyWriteError(new ApiError(422, 'السند محجوب عن الترحيل.', { message: 'السند محجوب عن الترحيل.', reason: 'posting_blocked', details: { blockers: ['period_locked', 7, 'stock_record_missing'] } }));
    expect(outcome).toEqual({ kind: 'rejected', status: 422, reason: 'posting_blocked', blockers: ['period_locked', 'stock_record_missing'], message: 'السند محجوب عن الترحيل.' });
  });

  it.each([[401, 'unauthorized'], [403, 'forbidden'], [404, 'not_found'], [409, 'conflict'], [422, 'validation'], [429, 'rate_limited']])('a bodiless %s falls back to the %s reason', (status, reason) => {
    expect(classifyWriteError(new ApiError(status, 'حدث خطأ', {}))).toMatchObject({ kind: 'rejected', status, reason, blockers: [], message: null });
  });

  it('5xx, 408, aborts and network errors are unknown (the operation may have happened)', () => {
    expect(classifyWriteError(new ApiError(500, 'x', {}))).toEqual({ kind: 'unknown', cause: 'server' });
    expect(classifyWriteError(new ApiError(503, 'x', {}))).toEqual({ kind: 'unknown', cause: 'server' });
    expect(classifyWriteError(new ApiError(408, 'x', {}))).toEqual({ kind: 'unknown', cause: 'server' });
    expect(classifyWriteError(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toEqual({ kind: 'unknown', cause: 'timeout' });
    expect(classifyWriteError(new TypeError('Failed to fetch'))).toEqual({ kind: 'unknown', cause: 'network' });
  });

  it('after an unknown outcome the fill state alone decides whether it happened', () => {
    const state = (inventory_status: 'pending_integration' | 'posted' | 'reversed') => ({ inventory_status });
    expect(verifyAfterUnknown('post', state('pending_integration'))).toBe('unchanged');
    expect(verifyAfterUnknown('post', state('posted'))).toBe('done');
    expect(verifyAfterUnknown('post', state('reversed'))).toBe('done');
    expect(verifyAfterUnknown('reverse', state('posted'))).toBe('unchanged');
    expect(verifyAfterUnknown('reverse', state('reversed'))).toBe('done');
  });
});
