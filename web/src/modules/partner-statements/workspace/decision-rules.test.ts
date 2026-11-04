import { describe, expect, it } from 'vitest';
import {
  acceptDifferenceRequired,
  blockingIssue,
  buildDecisionRequest,
  decisionKey,
  decisionState,
  isReasonValid,
  nextUndecidedIndex,
  reasonLength,
  reasonRequired,
  type DecisionDraft,
} from './decision-rules';
import type { DecisionAction, MatchOutcome } from './types';

/** جدول حقيقة D-PS-16: متى يلزم السبب. يطابق `PartnerStatementReviewService::decide/planConfirm`. */
describe('reasonRequired — D-PS-16 truth table', () => {
  const cases: Array<[DecisionAction, MatchOutcome | null, number | null, boolean, string]> = [
    ['override', 'ambiguous', 0, true, 'override always'],
    ['override', 'matched', 0, true, 'override even on a matched row'],
    ['dismiss', 'missing_in_books', 0, true, 'dismiss always'],
    ['link_pair', 'missing_in_books', 0, true, 'link_pair always, even with zero net'],
    ['link_pair', 'matched', 0, true, 'link_pair always'],
    ['confirm', 'matched', 0, false, 'matched + zero net: the ONLY reasonless confirm'],
    ['confirm', 'matched', 100, true, 'matched but nonzero net inside tolerance'],
    ['confirm', 'matched', -1, true, 'matched, a one-halala difference'],
    ['confirm', 'matched', null, true, 'unknown net is treated conservatively'],
    ['confirm', 'amount_difference', 0, true, 'amount_difference engine outcome'],
    ['confirm', 'amount_difference', 5000, true, 'amount_difference with a difference'],
    ['confirm', 'date_difference', 0, true, 'date_difference with ZERO monetary difference still needs a reason'],
    ['confirm', 'date_difference', 250, true, 'date_difference with a nonzero net'],
    ['clear', 'matched', 0, false, 'clear never needs a reason'],
    ['clear', 'ambiguous', 900, false, 'clear never needs a reason'],
  ];

  it.each(cases)('%s / %s / net %s ⇒ %s (%s)', (action, outcome, net, expected) => {
    expect(reasonRequired({ action, engineOutcome: outcome, netDifferenceMinor: net })).toBe(expected);
  });
});

describe('reason validation', () => {
  it('counts Unicode characters after trimming (mirrors mb_strlen(trim()))', () => {
    expect(reasonLength('  اب  ')).toBe(2);
    expect(isReasonValid('  اب  ')).toBe(false);
    expect(isReasonValid('abc')).toBe(true);
    expect(isReasonValid('  ab ')).toBe(false);
    expect(reasonLength('😀😀😀')).toBe(3);
    expect(isReasonValid('😀😀😀')).toBe(true);
    expect(isReasonValid('x'.repeat(501))).toBe(false);
    expect(isReasonValid('x'.repeat(500))).toBe(true);
  });
});

describe('acceptDifferenceRequired', () => {
  it('is required only strictly outside the frozen tolerance', () => {
    expect(acceptDifferenceRequired(0, 0)).toBe(false);
    expect(acceptDifferenceRequired(100, 100)).toBe(false);
    expect(acceptDifferenceRequired(-101, 100)).toBe(true);
    expect(acceptDifferenceRequired(1, 0)).toBe(true);
    expect(acceptDifferenceRequired(null, 0)).toBe(false);
  });
});

const draft = (patch: Partial<DecisionDraft> = {}): DecisionDraft => ({
  action: 'confirm',
  row: { outcome: 'matched', unit_key: 'u1' },
  reason: '',
  unitKeys: [],
  acceptDifference: false,
  pairMember: null,
  netDifferenceMinor: 0,
  toleranceMinor: 0,
  ...patch,
});

describe('blockingIssue', () => {
  it('lets a matched zero-net confirm through with no reason', () => {
    expect(blockingIssue(draft())).toBeNull();
  });

  it('blocks confirm with a date difference at zero net until a reason of 3+ characters is given', () => {
    const base = draft({ row: { outcome: 'date_difference', unit_key: 'u1' }, netDifferenceMinor: 0 });
    expect(blockingIssue(base)).toBe('reason_required');
    expect(blockingIssue({ ...base, reason: 'ab' })).toBe('reason_required');
    expect(blockingIssue({ ...base, reason: 'abc' })).toBeNull();
  });

  it('blocks a nonzero net even inside tolerance without a reason, but needs no acceptance there', () => {
    const base = draft({ netDifferenceMinor: 50, toleranceMinor: 100 });
    expect(blockingIssue(base)).toBe('reason_required');
    expect(blockingIssue({ ...base, reason: 'rounding' })).toBeNull();
  });

  it('requires an explicit acceptance outside tolerance', () => {
    const base = draft({ row: { outcome: 'amount_difference', unit_key: 'u1' }, netDifferenceMinor: 500, toleranceMinor: 100, reason: 'agreed' });
    expect(blockingIssue(base)).toBe('accept_required');
    expect(blockingIssue({ ...base, acceptDifference: true })).toBeNull();
  });

  it('refuses confirm on a row without a proposal or with a non-confirmable outcome', () => {
    expect(blockingIssue(draft({ row: { outcome: 'ambiguous', unit_key: null } }))).toBe('not_confirmable');
    expect(blockingIssue(draft({ row: { outcome: 'matched', unit_key: null } }))).toBe('not_confirmable');
  });

  it('allows dismiss only for missing_in_books and always with a reason', () => {
    expect(blockingIssue(draft({ action: 'dismiss', row: { outcome: 'matched', unit_key: 'u' }, reason: 'abc' }))).toBe('dismiss_not_allowed');
    const ok = draft({ action: 'dismiss', row: { outcome: 'missing_in_books', unit_key: null }, netDifferenceMinor: null });
    expect(blockingIssue(ok)).toBe('reason_required');
    expect(blockingIssue({ ...ok, reason: 'not ours' })).toBeNull();
  });

  it('validates override sets (1..50 units, reason, verified difference acceptance)', () => {
    const base = draft({ action: 'override', row: { outcome: 'ambiguous', unit_key: null }, reason: 'chosen' });
    expect(blockingIssue(base)).toBe('units_required');
    expect(blockingIssue({ ...base, unitKeys: ['a'] })).toBeNull();
    expect(blockingIssue({ ...base, unitKeys: Array.from({ length: 51 }, (_, i) => `u${i}`) })).toBe('units_too_many');
    expect(blockingIssue({ ...base, unitKeys: ['a'], reason: '' })).toBe('reason_required');
    expect(blockingIssue({ ...base, unitKeys: ['a'], netDifferenceMinor: 900, toleranceMinor: 0 })).toBe('accept_required');
  });

  it('requires exactly one unit, a member and a reason for link_pair — even at zero difference', () => {
    const base = draft({ action: 'link_pair', row: { outcome: 'missing_in_books', unit_key: null }, netDifferenceMinor: 0 });
    expect(blockingIssue(base)).toBe('units_required');
    expect(blockingIssue({ ...base, unitKeys: ['a', 'b'] })).toBe('units_required');
    expect(blockingIssue({ ...base, unitKeys: ['a'] })).toBe('pair_member_required');
    expect(blockingIssue({ ...base, unitKeys: ['a'], pairMember: 'original' })).toBe('reason_required');
    expect(blockingIssue({ ...base, unitKeys: ['a'], pairMember: 'original', reason: 'proven pair' })).toBeNull();
  });

  it('rejects an over-long reason', () => {
    expect(blockingIssue(draft({ reason: 'x'.repeat(501), row: { outcome: 'date_difference', unit_key: 'u' } }))).toBe('reason_too_long');
  });
});

describe('buildDecisionRequest', () => {
  it('sends only what the server accepts per action', () => {
    expect(buildDecisionRequest('run', 'line', draft())).toEqual({ run_id: 'run', line_id: 'line', action: 'confirm' });
    expect(buildDecisionRequest('run', 'line', draft({ reason: '  why  ' }))).toEqual({ run_id: 'run', line_id: 'line', action: 'confirm', reason: 'why' });
    expect(buildDecisionRequest('run', 'line', draft({ action: 'override', unitKeys: ['a', 'b'], reason: 'ok', acceptDifference: true }))).toEqual({
      run_id: 'run', line_id: 'line', action: 'override', unit_keys: ['a', 'b'], reason: 'ok', accept_difference: true,
    });
    expect(buildDecisionRequest('run', 'line', draft({ action: 'link_pair', unitKeys: ['a'], pairMember: 'reversal', reason: 'pair' }))).toEqual({
      run_id: 'run', line_id: 'line', action: 'link_pair', unit_keys: ['a'], pair_member: 'reversal', reason: 'pair',
    });
    // dismiss: no unit_keys, no accept_difference (the server accepts the difference itself)
    expect(buildDecisionRequest('run', 'line', draft({ action: 'dismiss', reason: 'gone', acceptDifference: true, unitKeys: ['x'] }))).toEqual({
      run_id: 'run', line_id: 'line', action: 'dismiss', reason: 'gone',
    });
    // clear never carries a reason
    expect(buildDecisionRequest('run', 'line', draft({ action: 'clear', reason: 'ignored' }))).toEqual({ run_id: 'run', line_id: 'line', action: 'clear' });
    // accept_difference is not sent unless ticked, and not on confirm without it
    expect(buildDecisionRequest('run', 'line', draft({ acceptDifference: false }))).not.toHaveProperty('accept_difference');
  });

  it('keys duplicates on every field that changes meaning, ignoring unit order', () => {
    const a = { run_id: 'r', line_id: 'l', action: 'override' as const, unit_keys: ['b', 'a'], reason: 'x' };
    expect(decisionKey(a)).toBe(decisionKey({ ...a, unit_keys: ['a', 'b'] }));
    expect(decisionKey(a)).not.toBe(decisionKey({ ...a, reason: 'y' }));
    expect(decisionKey(a)).not.toBe(decisionKey({ ...a, run_id: 'r2' }));
    expect(decisionKey(a)).not.toBe(decisionKey({ ...a, accept_difference: true }));
  });
});

describe('decision state and next undecided', () => {
  const d = (run: string) => ({ decision: { run_id: run } as never });
  it('distinguishes no decision, a current-run decision and a decision on another run', () => {
    expect(decisionState({ decision: null }, 'r1')).toBe('none');
    expect(decisionState(d('r1'), 'r1')).toBe('current');
    expect(decisionState(d('r0'), 'r1')).toBe('other_run');
    expect(decisionState(d('r1'), null)).toBe('other_run');
  });

  it('finds the next row without a valid decision, wrapping around, and treats other-run decisions as undecided', () => {
    const rows = [d('r1'), d('r1'), { decision: null }, d('r0'), d('r1')];
    expect(nextUndecidedIndex(rows, -1, 'r1')).toBe(2);
    expect(nextUndecidedIndex(rows, 2, 'r1')).toBe(3);
    expect(nextUndecidedIndex(rows, 3, 'r1')).toBe(2);
    expect(nextUndecidedIndex([], 0, 'r1')).toBe(-1);
  });
});
