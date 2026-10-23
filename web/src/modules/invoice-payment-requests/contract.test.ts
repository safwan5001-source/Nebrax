import { describe, expect, it } from 'vitest';
import type { GatewayConnection } from '@/modules/payments/gateways/contract';
import {
  attemptPhase, buildPayUrl, canCancel, canIssueLink, expiryMinutes, hasOpenRequest, knownError, phaseTone, statusTone, usableGateways,
  type OnlineAttempt,
} from './contract';

const gateway = (over: Partial<GatewayConnection>): GatewayConnection => ({
  id: 'g', provider: 'moyasar', name: 'ميسّر', name_en: null, environment: 'sandbox', status: 'active', is_usable: true, merchant_reference: null,
  publishable_key: null, has_secret_key: true, has_webhook_secret: true, has_extra_credentials: false, credential_version: 1,
  previous_secret_valid_until: null, verified_at: '2026-10-23T00:00:00Z', activated_at: null, deactivated_at: null, created_at: null, ...over,
});
const attempt = (over: Partial<OnlineAttempt>): OnlineAttempt => ({
  id: 'a', capture_status: 'pending_customer', amount_minor: 100, captured_minor: 0, posting_status: null, checkout_url: null, review_reasons: null, ...over,
});

describe('usableGateways', () => {
  it('keeps only active, usable, verified connections of a provider with an adapter', () => {
    const kept = usableGateways([
      gateway({ id: 'ok' }),
      gateway({ id: 'draft', status: 'draft' }),
      gateway({ id: 'suspended', status: 'suspended' }),
      gateway({ id: 'unusable', is_usable: false }),
      gateway({ id: 'unverified', verified_at: null }),
      gateway({ id: 'custom', provider: 'custom' }),
      gateway({ id: 'stripe', provider: 'stripe' }),
    ]);
    expect(kept.map((g) => g.id)).toEqual(['ok']);
  });
});

describe('attemptPhase', () => {
  it.each([
    [null, 'none'],
    [attempt({ capture_status: 'pending_customer' }), 'awaiting'],
    [attempt({ capture_status: 'authorized' }), 'awaiting'],
    [attempt({ capture_status: 'captured', posting_status: 'posted' }), 'posted'],
    [attempt({ capture_status: 'captured', posting_status: 'pending' }), 'posting_pending'],
    [attempt({ capture_status: 'captured', posting_status: 'blocked_period' }), 'blocked_period'],
    [attempt({ capture_status: 'captured', posting_status: 'pending', review_reasons: ['amount_mismatch'] }), 'review'],
    [attempt({ capture_status: 'captured', posting_status: 'posted', review_reasons: ['overpayment'] }), 'posted'],
    [attempt({ capture_status: 'failed' }), 'not_completed'],
    [attempt({ capture_status: 'expired' }), 'not_completed'],
  ] as const)('maps %j → %s', (input, phase) => expect(attemptPhase(input as OnlineAttempt | null)).toBe(phase));

  it('uses semantic tones: positive paid, negative blocked/review, warning in-flight', () => {
    expect(phaseTone('posted')).toBe('positive');
    expect(phaseTone('blocked_period')).toBe('negative');
    expect(phaseTone('review')).toBe('negative');
    expect(phaseTone('awaiting')).toBe('warning');
    expect(phaseTone('none')).toBe('muted');
  });
});

describe('request helpers', () => {
  it('allows link issuing and cancelling only on open requests, and the link once', () => {
    expect(canIssueLink({ status: 'open', link_issued: false })).toBe(true);
    expect(canIssueLink({ status: 'open', link_issued: true })).toBe(false);
    expect(canIssueLink({ status: 'cancelled', link_issued: false })).toBe(false);
    expect(canCancel({ status: 'open' })).toBe(true);
    expect(canCancel({ status: 'completed' })).toBe(false);
  });
  it('detects an open request and maps statuses to tones', () => {
    expect(hasOpenRequest([{ status: 'cancelled' } as never, { status: 'open' } as never])).toBe(true);
    expect(hasOpenRequest([{ status: 'completed' } as never])).toBe(false);
    expect(statusTone('completed')).toBe('positive');
    expect(statusTone('expired')).toBe('warning');
  });
  it('builds the pay url from the origin and token and maps expiry options', () => {
    expect(buildPayUrl('https://app.example.com/', 'TOKEN')).toBe('https://app.example.com/pay/TOKEN');
    expect(expiryMinutes('none')).toBeNull();
    expect(expiryMinutes('d7')).toBe(7 * 24 * 60);
  });
  it('falls back to unknown for unrecognised error codes', () => {
    expect(knownError('open_request_exists')).toBe('open_request_exists');
    expect(knownError('weird')).toBe('unknown');
    expect(knownError(null)).toBe('unknown');
  });
});
