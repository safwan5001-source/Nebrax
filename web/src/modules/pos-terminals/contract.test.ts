import { describe, expect, it } from 'vitest';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import {
  KNOWN_FAILURES, KNOWN_REASONS, REQUEST_STATUSES, attemptFingerprint, escalationSummary, holdsPayment, isRetryable, knownFailure,
  knownReason, needsCompensation, statusTone, totalBlockers, usableTerminals,
  type PosPaymentTerminal,
} from './contract';

const terminal = (over: Partial<PosPaymentTerminal>): PosPaymentTerminal => ({
  id: 't', name: 'T', code: null, provider: 'fake', simulated: true, pos_device_id: null, is_active: true, created_at: null, ...over,
});

describe('عقد أجهزة دفع POS', () => {
  it('الحالات التي تحجز الدفع هي المعلّقة والموافقة القائمة والتعويض فقط', () => {
    const holding = REQUEST_STATUSES.filter((status) => holdsPayment(status));
    expect(holding).toEqual(['created', 'sent', 'approved', 'compensation_required']);
  });

  it('الحالات القابلة لإعادة المحاولة لا تحجز دفعاً، والتعويض ليس منها', () => {
    for (const status of REQUEST_STATUSES.filter(isRetryable)) expect(holdsPayment(status)).toBe(false);
    expect(isRetryable('compensation_required')).toBe(false);
    expect(needsCompensation('compensation_required')).toBe(true);
    expect(statusTone('compensation_required')).toBe('negative');
  });

  it('الأجهزة الصالحة: نشطة وغير مخصَّصة لجهاز POS آخر', () => {
    const list = [
      terminal({ id: 'any' }),
      terminal({ id: 'mine', pos_device_id: 'dev-1' }),
      terminal({ id: 'other', pos_device_id: 'dev-2' }),
      terminal({ id: 'off', is_active: false }),
    ];
    expect(usableTerminals(list, 'dev-1').map((item) => item.id)).toEqual(['any', 'mine']);
    expect(usableTerminals(list, null).map((item) => item.id)).toEqual(['any']);
  });

  it('مجموع الموانع يتجاهل الغياب', () => {
    expect(totalBlockers(undefined)).toBe(0);
    expect(totalBlockers({ compensation_required: 1, in_flight: 2 })).toBe(3);
  });

  it('ملخص التصعيد لا يحمل رمز موافقة ولا RRN ولا آخر 4 أرقام ولا مرجع مزوّد', () => {
    const summary = escalationSummary({ id: '11111111-2222-3333-4444-555555555555', amount: '115.00', status: 'compensation_required', created_at: '2026-10-23T00:00:00Z', void_attempts: 3 }, 'جهاز 1');
    expect(summary).toContain('ref:55555555');
    expect(summary).toContain('amount:115.00');
    expect(summary).toContain('attempts:3');
    expect(summary).not.toMatch(/approval|rrn|last4|4242|AP[0-9A-F]{6}/i);
  });

  it('بصمة المحاولة تتغيّر بتغيّر المبلغ أو الجهاز أو الوسيلة', () => {
    const base = { sessionId: 's', terminalId: 't', methodId: 'm', amountMinor: 100 };
    expect(attemptFingerprint(base)).toBe(attemptFingerprint({ ...base }));
    expect(attemptFingerprint(base)).not.toBe(attemptFingerprint({ ...base, amountMinor: 101 }));
    expect(attemptFingerprint(base)).not.toBe(attemptFingerprint({ ...base, terminalId: 'u' }));
  });

  it('الأسباب والرموز المجهولة لا تُعدّ معروفة', () => {
    expect(knownReason('terminal_busy')).toBe('terminal_busy');
    expect(knownReason('weird')).toBeNull();
    expect(knownReason(null)).toBeNull();
    expect(knownFailure('void_failed')).toBe('void_failed');
    expect(knownFailure('x')).toBeNull();
  });

  it.each([['ar', ar], ['en', en]] as const)('كل حالة وسبب ورمز فشل له نص مترجم في %s', (_lang, messages) => {
    const ns = (messages as unknown as { posTerminals: Record<string, Record<string, string>> }).posTerminals;
    for (const status of REQUEST_STATUSES) expect(ns.status[status], `status.${status}`).toBeTruthy();
    for (const reason of KNOWN_REASONS) expect(ns.errors[reason], `errors.${reason}`).toBeTruthy();
    expect(ns.errors.generic).toBeTruthy();
    for (const code of KNOWN_FAILURES) expect(ns.failure[code], `failure.${code}`).toBeTruthy();
    for (const status of ['declined', 'cancelled', 'expired', 'error', 'voided'] as const) expect(ns.status_hint[status], `status_hint.${status}`).toBeTruthy();
  });

  it('مفاتيح ar وen لمساحة posTerminals متطابقة', () => {
    const flat = (value: unknown, prefix = ''): string[] => typeof value === 'object' && value !== null
      ? Object.entries(value).flatMap(([key, child]) => flat(child, `${prefix}${key}.`))
      : [prefix];
    const keysAr = flat((ar as unknown as { posTerminals: unknown }).posTerminals).sort();
    const keysEn = flat((en as unknown as { posTerminals: unknown }).posTerminals).sort();
    expect(keysAr).toEqual(keysEn);
  });
});
