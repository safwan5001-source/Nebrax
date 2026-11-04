import { describe, expect, it } from 'vitest';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import { ApiError } from '@/lib/api';
import { ALL_ERROR_KEYS, classifyForbidden, describeError, describeMessage } from './errors';

const err = (status: number, body: Record<string, unknown> = {}) => new ApiError(status, String(body.message ?? 'x'), body);

describe('error mapping', () => {
  it('prefers the machine reason over the message', () => {
    expect(describeError(err(409, { message: 'whatever', reason: 'run_stale' }))).toMatchObject({ key: 'family_stale', kind: 'conflict', code: 'run_stale' });
    expect(describeError(err(422, { message: 'x', reason: 'overlap_ack_required' })).key).toBe('family_overlap');
    expect(describeError(err(422, { message: 'x', reason: 'closer_must_differ_from_reviewer' })).key).toBe('family_separation');
    expect(describeError(err(422, { message: 'x', reason: 'unit_conflict' })).key).toBe('family_conflict');
  });

  it('reads import-preview rejections from the `code` key', () => {
    for (const code of ['preview_invalid', 'preview_consumed', 'preview_expired', 'preview_mismatch', 'preview_required', 'options_frozen']) {
      expect(describeError(err(422, { message: 'خام', code })).key).toBe('preview_stale');
    }
  });

  it('maps known server messages to translated keys, never to the raw text', () => {
    expect(describeError(err(422, { message: 'الطرف غير متاح لك في هذا الدور.' })).key).toBe('unavailable');
    expect(describeError(err(422, { message: 'كشوف الأطراف بالريال السعودي (SAR) فقط في هذه النسخة؛ العملات الأخرى غير مدعومة.' })).key).toBe('sar_only');
    expect(describeError(err(422, { message: 'فترة الكشف تتجاوز خمس سنوات.' })).key).toBe('period_too_long');
    expect(describeError(err(422, { message: 'الاستيراد يحتاج عمود «التاريخ».' })).key).toBe('mapping_missing_date');
  });

  it('does not distinguish an unreachable branch from an unavailable partner (no existence oracle)', () => {
    const partner = describeError(err(422, { message: 'الطرف غير متاح لك في هذا الدور.' }));
    const branch = describeError(err(422, { message: 'هذا الفرع خارج نطاق صلاحياتك.' }));
    expect(branch.key).toBe(partner.key);
  });

  it('falls back safely on unknown codes and never echoes backend internals', () => {
    const unknown = describeError(err(500, { message: 'SQLSTATE[23505]: Unique violation: tenant 42', reason: 'weird_code' }));
    expect(unknown.key).toBe('unknown');
    expect(describeError(err(422, { message: 'SQLSTATE[HY000] secret detail' })).key).toBe('validation');
    expect(describeError(err(418, { message: 'teapot' })).key).toBe('unknown');
  });

  it('handles HTTP classes: 401, 403 variants, 404, 409, 413, 422 validation, 429 and network failures', () => {
    expect(describeError(err(401)).kind).toBe('auth');
    expect(describeError(err(403, { message: 'هذه القدرة غير مفعّلة لهذه المؤسسة.' })).kind).toBe('disabled');
    expect(describeError(err(403, { message: 'هذه القدرة معلّقة (قراءة فقط) — أعد تفعيلها.' })).kind).toBe('suspended');
    expect(describeError(err(403, { message: 'ليست لديك الصلاحية.' })).kind).toBe('forbidden');
    expect(describeError(err(404)).key).toBe('not_found');
    expect(describeError(err(409)).key).toBe('conflict');
    expect(describeError(err(413)).key).toBe('file_too_large');
    expect(describeError(err(422, { message: 'The file field is invalid.', errors: { file: ['bad'] } })).key).toBe('file_invalid');
    expect(describeError(err(422, { message: 'x', errors: { period_from: ['bad'] } })).key).toBe('validation');
    expect(describeError(err(429)).key).toBe('throttled');
    expect(describeError(new TypeError('Failed to fetch')).key).toBe('network');
  });

  it('classifies capability 403s and engine text-only errors', () => {
    expect(classifyForbidden('هذه القدرة غير متاحة لهذه المؤسسة.')).toBe('disabled');
    expect(describeMessage('هذه القدرة معلّقة (قراءة فقط)').key).toBe('suspended');
    expect(describeMessage('الملف فارغ.').key).toBe('file_empty');
    expect(describeMessage('something internal').key).toBe('unknown');
    expect(describeMessage(null).key).toBe('unknown');
  });
});

describe('message catalogs (ar + en)', () => {
  const arNs = (ar as unknown as { partnerStatements: Record<string, unknown> }).partnerStatements;
  const enNs = (en as unknown as { partnerStatements: Record<string, unknown> }).partnerStatements;

  const flatten = (value: unknown, prefix = ''): string[] =>
    value && typeof value === 'object'
      ? Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key))
      : [prefix];
  const leaves = (value: unknown, prefix = ''): [string, string][] =>
    value && typeof value === 'object'
      ? Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => leaves(child, prefix ? `${prefix}.${key}` : key))
      : [[prefix, String(value)]];

  it('has a translation in both languages for every error key the mapper can return', () => {
    const arErrors = arNs.errors as Record<string, string>;
    const enErrors = enNs.errors as Record<string, string>;
    for (const key of ALL_ERROR_KEYS) {
      expect(arErrors[key], `ar errors.${key}`).toBeTruthy();
      expect(enErrors[key], `en errors.${key}`).toBeTruthy();
    }
  });

  it('keeps ar and en in lockstep (same key set)', () => {
    expect(flatten(arNs).sort()).toEqual(flatten(enNs).sort());
  });

  it('uses Latin digits only in both catalogs, and keeps ICU placeholders aligned', () => {
    const arLeaves = new Map(leaves(arNs));
    for (const [key, value] of leaves(arNs)) expect(value, `ar ${key}`).not.toMatch(/[٠-٩۰-۹]/);
    for (const [key, value] of leaves(enNs)) {
      const placeholders = (text: string) => (text.match(/\{[a-z_]+\}/g) ?? []).sort().join(',');
      expect(placeholders(value), key).toBe(placeholders(arLeaves.get(key) ?? ''));
    }
  });

  it('is a separate namespace from the legacy customer-statement print screen', () => {
    expect((ar as Record<string, unknown>).partnerStatement).toBeDefined();
    expect((ar as Record<string, unknown>).partnerStatements).toBeDefined();
    expect((ar as Record<string, unknown>).partnerStatement).not.toBe((ar as Record<string, unknown>).partnerStatements);
  });
});
