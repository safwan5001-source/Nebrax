import { describe, expect, it } from 'vitest';
import { classifyAcceptError, failureMeansStale, validateRejectNote } from './accept-order';
import {
  ACCEPTANCE_STATUSES,
  DEFAULT_ORDERS_STATE,
  REJECTION_NOTE_MAX,
  acceptanceBadgeOf,
  buildOrdersQuery,
  parseOrdersState,
  serializeOrdersState,
} from './contract';

const err = (status?: number, body?: unknown) => Object.assign(new Error('x'), status === undefined ? {} : { status }, body === undefined ? {} : { body });

describe('accept/reject error classification (COPS-H1-5)', () => {
  it.each([
    [401, 'session'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [409, 'conflict'],
    [422, 'validation'],
    [500, 'unknown'],
  ])('maps HTTP %s to %s', (status, kind) => {
    expect(classifyAcceptError(err(status)).kind).toBe(kind);
  });

  it('treats a missing status as an unconfirmed network failure and keeps the matrix reason of a 409', () => {
    expect(classifyAcceptError(err()).kind).toBe('network');
    expect(classifyAcceptError(null).kind).toBe('network');
    expect(classifyAcceptError(err(409, { reason: 'payment_collected' }))).toEqual({ kind: 'conflict', reason: 'payment_collected' });
    expect(classifyAcceptError(err(409, { reason: 42 })).reason).toBeNull();
  });

  it('flags only conflict, not-found and unconfirmed network failures as stale state', () => {
    expect(['conflict', 'not_found', 'network'].every((kind) => failureMeansStale({ kind: kind as 'conflict', reason: null }))).toBe(true);
    expect(['session', 'forbidden', 'validation', 'unknown'].some((kind) => failureMeansStale({ kind: kind as 'session', reason: null }))).toBe(false);
  });

  it('validates the optional rejection note locally against the server limit', () => {
    expect(validateRejectNote('')).toBeNull();
    expect(validateRejectNote('x'.repeat(REJECTION_NOTE_MAX))).toBeNull();
    expect(validateRejectNote('x'.repeat(REJECTION_NOTE_MAX + 1))).toBe('note_too_long');
  });
});

describe('acceptance filter state (COPS-H1-5)', () => {
  it('is empty by default and never sent', () => {
    expect(DEFAULT_ORDERS_STATE.acceptanceStatus).toBe('');
    expect(buildOrdersQuery(DEFAULT_ORDERS_STATE, null).has('acceptance_status')).toBe(false);
    expect(serializeOrdersState(DEFAULT_ORDERS_STATE).has('acceptance_status')).toBe(false);
  });

  it.each(ACCEPTANCE_STATUSES)('round-trips %s through the URL and the API query', (value) => {
    const state = parseOrdersState(new URLSearchParams({ acceptance_status: value }));
    expect(state.acceptanceStatus).toBe(value);
    expect(serializeOrdersState(state).get('acceptance_status')).toBe(value);
    expect(buildOrdersQuery(state, null).get('acceptance_status')).toBe(value);
  });

  it('drops any value outside the allow-list so it never reaches the server', () => {
    for (const bad of ['rejected', 'AWAITING_ACCEPTANCE', '1 OR 1=1', '']) {
      expect(parseOrdersState(new URLSearchParams({ acceptance_status: bad })).acceptanceStatus).toBe('');
    }
  });

  it('keeps the other filters, sorting and pagination untouched when the acceptance filter is set', () => {
    const state = parseOrdersState(new URLSearchParams('acceptance_status=awaiting_acceptance&payment_status=collected&page=3&per_page=50&sort=-total'));
    const query = buildOrdersQuery(state, 's1');
    expect(Object.fromEntries(query)).toMatchObject({
      acceptance_status: 'awaiting_acceptance', payment_status: 'collected', storefront_id: 's1', page: '3', per_page: '50', sort: 'total', direction: 'desc',
    });
  });
});

describe('acceptance badge derivation (COPS-H1-5)', () => {
  const base = { acceptance: undefined, operational_status: undefined, cancellation: undefined };

  it('is silent for an older server that sends no acceptance data', () => {
    expect(acceptanceBadgeOf(base)).toBeNull();
  });

  it('prefers the merchant rejection, then manual acceptance, then awaiting, then automatic', () => {
    const manual = { mode: 'manual', effective_mode: 'manual', accepted_at: null };
    expect(acceptanceBadgeOf({ ...base, acceptance: manual, cancellation: { cancelled: true, at: 'x', reason: 'merchant_rejected' } })).toBe('rejected');
    expect(acceptanceBadgeOf({ ...base, acceptance: { ...manual, accepted_at: '2026-11-02T10:00:00Z' }, operational_status: 'accepted' })).toBe('accepted');
    expect(acceptanceBadgeOf({ ...base, acceptance: manual, operational_status: 'awaiting_acceptance' })).toBe('awaiting');
    expect(acceptanceBadgeOf({ ...base, acceptance: { mode: 'auto', effective_mode: 'auto', accepted_at: null }, operational_status: 'accepted' })).toBe('auto');
  });

  it('does not conflate payment or other cancellations with acceptance', () => {
    const manual = { mode: 'manual', effective_mode: 'manual', accepted_at: null };
    expect(acceptanceBadgeOf({ ...base, acceptance: manual, operational_status: 'awaiting_payment' })).toBeNull();
    expect(acceptanceBadgeOf({ ...base, acceptance: manual, operational_status: 'cancelled', cancellation: { cancelled: true, at: 'x', reason: 'out_of_stock' } })).toBeNull();
    // البوابة أُغلقت بعد الإنشاء: اللقطة يدوية والفعّال تلقائي ⇒ «قبول تلقائي» لا «بانتظار القبول».
    expect(acceptanceBadgeOf({ ...base, acceptance: { mode: 'manual', effective_mode: 'auto', accepted_at: null }, operational_status: 'accepted' })).toBe('auto');
  });
});
