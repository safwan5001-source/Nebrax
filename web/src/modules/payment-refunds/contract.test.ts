import { describe, expect, it } from 'vitest';
import {
  autoAllocate, canCancel, canDecide, canRepost, canResolve, canSubmit, inTab, knownError, maxRefundable, newIdempotencyKey, parseMajorToMinor, reasonValid, statusTone,
  type EligibleSource,
} from './contract';

const src = (over: Partial<EligibleSource>): EligibleSource => ({ source_type: 'credit_note', id: 'n1', number: 'CN-1', date: '2026-10-01', total: 115000, refunded: 0, refundable: 115000, ...over });
const user = { id: 'u1', name: 'أ' };

describe('payment refund contract', () => {
  it('never lets the requester decide on their own request (UI mirror of the server rule)', () => {
    expect(canDecide({ status: 'requested', requested_by: user }, true, 'u1')).toBe(false);
    expect(canDecide({ status: 'requested', requested_by: user }, true, 'u2')).toBe(true);
    expect(canDecide({ status: 'requested', requested_by: user }, false, 'u2')).toBe(false);
    expect(canDecide({ status: 'approved', requested_by: user }, true, 'u2')).toBe(false);
    expect(canDecide({ status: 'requested', requested_by: user }, true, null)).toBe(false);
  });

  it('gates submit, cancel, resolve and repost by status and permission', () => {
    expect(canSubmit({ status: 'approved' }, true)).toBe(true);
    expect(canSubmit({ status: 'requested' }, true)).toBe(false);
    expect(canCancel({ status: 'requested', requested_by: user }, false, 'u1')).toBe(true);
    expect(canCancel({ status: 'requested', requested_by: user }, false, 'u2')).toBe(false);
    expect(canCancel({ status: 'approved', requested_by: user }, true, 'u2')).toBe(true);
    expect(canCancel({ status: 'confirmed', requested_by: user }, true, 'u1')).toBe(false);
    expect(canResolve({ status: 'unknown' }, true)).toBe(true);
    expect(canResolve({ status: 'unknown' }, false)).toBe(false);
    expect(canRepost({ status: 'confirmed', posting_status: 'blocked_period' }, true)).toBe(true);
    expect(canRepost({ status: 'confirmed', posting_status: 'posted' }, true)).toBe(false);
  });

  it('filters tabs and tones statuses', () => {
    expect(inTab({ status: 'requested', posting_status: null }, 'pending')).toBe(true);
    expect(inTab({ status: 'unknown', posting_status: null }, 'attention')).toBe(true);
    expect(inTab({ status: 'confirmed', posting_status: 'blocked_period' }, 'attention')).toBe(true);
    expect(inTab({ status: 'confirmed', posting_status: 'posted' }, 'attention')).toBe(false);
    expect(statusTone('confirmed', 'posted')).toBe('positive');
    expect(statusTone('confirmed', 'blocked_period')).toBe('warning');
    expect(statusTone('failed', null)).toBe('negative');
    expect(statusTone('cancelled', null)).toBe('muted');
  });

  it('allocates oldest-first without exceeding any source and fails when sources are insufficient', () => {
    const sources = [src({ id: 'n2', number: 'CN-2', date: '2026-10-05', refundable: 20000 }), src({ id: 'n1', refundable: 30000 })];
    expect(autoAllocate(sources, 40000)).toEqual([
      { source_type: 'credit_note', source_id: 'n1', amount_minor: 30000 },
      { source_type: 'credit_note', source_id: 'n2', amount_minor: 10000 },
    ]);
    expect(autoAllocate(sources, 50001)).toBeNull();
    expect(autoAllocate([], 100)).toBeNull();
    expect(maxRefundable({ refundable_minor: 40000, sources })).toBe(40000);
    expect(maxRefundable({ refundable_minor: 90000, sources })).toBe(50000);
  });

  it('parses amounts to integer halalas without floats', () => {
    expect(parseMajorToMinor('1150')).toBe(115000);
    expect(parseMajorToMinor('10.5')).toBe(1050);
    expect(parseMajorToMinor('0.07')).toBe(7);
    expect(parseMajorToMinor('١٢٣٫٤٥')).toBe(12345);
    expect(parseMajorToMinor('0')).toBeNull();
    expect(parseMajorToMinor('1.234')).toBeNull();
    expect(parseMajorToMinor('-5')).toBeNull();
    expect(parseMajorToMinor('abc')).toBeNull();
  });

  it('validates reasons, maps known error codes and mints unique idempotency keys', () => {
    expect(reasonValid('abcd')).toBe(false);
    expect(reasonValid('  سبب كافٍ ')).toBe(true);
    expect(knownError('self_approval')).toBe('self_approval');
    expect(knownError('weird')).toBe('unknown');
    expect(knownError(null)).toBe('unknown');
    const a = newIdempotencyKey();
    expect(a).toMatch(/^refund-.{8,}/);
    expect(newIdempotencyKey()).not.toBe(a);
  });
});
