import { describe, expect, it } from 'vitest';
import {
  blockedKind, buildListQuery, canRepost, knownProviderOutcome, knownRepostError, knownReviewReason, providerOutcomeTone, reasonValid, rowPhase, rowTone,
} from './contract';

const row = (over: Partial<Parameters<typeof rowPhase>[0]> = {}) => ({
  capture_status: 'captured', posting_status: 'posted', review_reasons: [] as string[], amount_minor: 100, captured_minor: 100, ...over,
});

describe('buildListQuery', () => {
  it('maps tabs to the server filters', () => {
    expect(buildListQuery({ tab: 'all', captureStatus: '', page: 1, perPage: 25 })).toBe('page=1&per_page=25');
    expect(buildListQuery({ tab: 'blocked', captureStatus: '', page: 2, perPage: 50 })).toBe('page=2&per_page=50&posting_status=blocked_period');
    expect(buildListQuery({ tab: 'review', captureStatus: '', page: 1, perPage: 25 })).toBe('page=1&per_page=25&needs_review=1');
  });

  it('applies the status filter only on the all tab', () => {
    expect(buildListQuery({ tab: 'all', captureStatus: 'captured', page: 1, perPage: 25 })).toContain('capture_status=captured');
    expect(buildListQuery({ tab: 'blocked', captureStatus: 'captured', page: 1, perPage: 25 })).not.toContain('capture_status');
  });
});

describe('rowPhase / rowTone', () => {
  it('matches the invoice section semantics', () => {
    expect(rowPhase(row())).toBe('posted');
    expect(rowTone(row())).toBe('positive');
    expect(rowPhase(row({ posting_status: 'blocked_period' }))).toBe('blocked_period');
    expect(rowTone(row({ posting_status: 'blocked_period' }))).toBe('negative');
    expect(rowPhase(row({ posting_status: 'pending' }))).toBe('posting_pending');
    expect(rowPhase(row({ capture_status: 'pending_customer', posting_status: null, captured_minor: 0 }))).toBe('awaiting');
    expect(rowPhase(row({ capture_status: 'failed', posting_status: null, captured_minor: 0 }))).toBe('not_completed');
  });

  it('lets a holding review reason win over the posting state, but not an overpayment note', () => {
    expect(rowPhase(row({ review_reasons: ['amount_mismatch'], posting_status: 'pending' }))).toBe('review');
    expect(rowPhase(row({ review_reasons: ['overpayment'] }))).toBe('posted');
  });
});

describe('canRepost', () => {
  it('needs both the permission and a blocked payment', () => {
    expect(canRepost({ posting_status: 'blocked_period' }, true)).toBe(true);
    expect(canRepost({ posting_status: 'blocked_period' }, false)).toBe(false);
    expect(canRepost({ posting_status: 'posted' }, true)).toBe(false);
    expect(canRepost({ posting_status: null }, true)).toBe(false);
  });
});

describe('reasonValid', () => {
  it('requires 5 to 500 trimmed characters', () => {
    expect(reasonValid('')).toBe(false);
    expect(reasonValid('  abc  ')).toBe(false);
    expect(reasonValid('12345')).toBe(true);
    expect(reasonValid('س'.repeat(500))).toBe(true);
    expect(reasonValid('س'.repeat(501))).toBe(false);
  });
});

describe('labels', () => {
  it('classifies known values and falls back safely', () => {
    expect(knownReviewReason('late_capture')).toBe('late_capture');
    expect(knownReviewReason('whatever')).toBe('other');
    expect(knownRepostError('not_blocked')).toBe('not_blocked');
    expect(knownRepostError('boom')).toBe('unknown');
    expect(knownRepostError(null)).toBe('unknown');
    expect(blockedKind({ blocked_reason: { kind: 'period' } })).toBe('period');
    expect(blockedKind({ blocked_reason: { kind: 'year' } })).toBe('year');
    expect(blockedKind({ blocked_reason: null })).toBe('other');
  });
});

describe('provider outcomes', () => {
  it('classifies known outcomes, hides absent ones and flags attention cases', () => {
    expect(knownProviderOutcome(null)).toBeNull();
    expect(knownProviderOutcome('')).toBeNull();
    expect(knownProviderOutcome('duplicate')).toBe('duplicate');
    expect(knownProviderOutcome('weird')).toBe('other');
    expect(providerOutcomeTone('applied')).toBe('neutral');
    expect(providerOutcomeTone('duplicate')).toBe('muted');
    expect(providerOutcomeTone('state_conflict')).toBe('warning');
    expect(providerOutcomeTone('attempt_not_found')).toBe('warning');
  });
});
