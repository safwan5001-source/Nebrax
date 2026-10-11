import { describe, expect, it } from 'vitest';
import {
  blockedReasonKey, noteBlockedReasonKey, buildLinkedBody, evaluateLine, summarize,
  type LineInput, type ReturnableLine,
} from './invoice-linked';

// 3 × 100.00 (غير شامل): صافي 300.00 وضريبة 45.00.
const line = (over: Partial<ReturnableLine> = {}): ReturnableLine => ({
  source_line_id: 'sl-1', product_id: 'p-1', description: 'صنف', quantity: 3, returned: 0, remaining: 3,
  unit_price: '100.00', tax_rate: 15, unit_price_before_tax: '100.00',
  charged_net: '300.00', charged_tax: '45.00', remaining_net: '300.00', remaining_tax: '45.00',
  ...over,
});
const inp = (quantity: string, price = ''): LineInput => ({ quantity, price });

describe('noteBlockedReasonKey', () => {
  it('does not apply the return window to credit notes, but keeps every other block', () => {
    expect(noteBlockedReasonKey('out_of_window')).toBeNull();
    expect(noteBlockedReasonKey('fully_returned')).toBe('blocked_fully_returned');
    expect(noteBlockedReasonKey('legacy_credit_review')).toBe('blocked_legacy_credit_review');
    expect(noteBlockedReasonKey(null)).toBeNull();
  });
});

describe('blockedReasonKey', () => {
  it('maps known reasons and falls back to a generic one', () => {
    expect(blockedReasonKey(null)).toBeNull();
    expect(blockedReasonKey('fully_returned')).toBe('blocked_fully_returned');
    expect(blockedReasonKey('out_of_window')).toBe('blocked_out_of_window');
    expect(blockedReasonKey('legacy_credit_review')).toBe('blocked_legacy_credit_review');
    expect(blockedReasonKey('something_new')).toBe('blocked_generic');
  });
});

describe('evaluateLine', () => {
  it('treats empty or zero quantity as not credited, without error', () => {
    expect(evaluateLine(line(), inp(''))).toMatchObject({ quantity: 0, error: null, total: 0 });
    expect(evaluateLine(line(), inp('0'))).toMatchObject({ quantity: 0, error: null, total: 0 });
    expect(evaluateLine(line(), undefined).quantity).toBe(0);
  });

  it('rejects non-integer, negative and over-remaining quantities', () => {
    expect(evaluateLine(line(), inp('1.5')).error).toBe('qty_invalid');
    expect(evaluateLine(line(), inp('-1')).error).toBe('qty_invalid');
    expect(evaluateLine(line(), inp('abc')).error).toBe('qty_invalid');
    expect(evaluateLine(line({ returned: 1, remaining: 2 }), inp('3')).error).toBe('qty_above_remaining');
  });

  it('previews through the shared allocator (full quantity = whole charged amounts)', () => {
    expect(evaluateLine(line(), inp('3'))).toMatchObject({ net: 30000, tax: 4500, total: 34500, priceLowered: false });
    expect(evaluateLine(line(), inp('1'))).toMatchObject({ net: 10000, tax: 1500, total: 11500 });
  });

  it('scales a lowered price proportionally and flags it', () => {
    const e = evaluateLine(line(), inp('1', '50.00'));
    expect(e).toMatchObject({ net: 5000, tax: 750, priceMinor: 5000, priceLowered: true, error: null });
  });

  it('rejects a price above the invoice price or non-positive', () => {
    expect(evaluateLine(line(), inp('1', '100.01')).error).toBe('price_above_invoice');
    expect(evaluateLine(line(), inp('1', '0')).error).toBe('price_invalid');
    expect(evaluateLine(line(), inp('1', 'x')).error).toBe('price_invalid');
  });

  it('ignores a typed price when the quantity is zero', () => {
    expect(evaluateLine(line(), inp('', '999')).error).toBeNull();
  });

  it('an equal price is the default price (not lowered)', () => {
    expect(evaluateLine(line(), inp('1', '100')).priceLowered).toBe(false);
  });
});

describe('summarize', () => {
  const l1 = line();
  const l2 = line({ source_line_id: 'sl-2', quantity: 1, remaining: 0, returned: 1, remaining_net: '0.00', remaining_tax: '0.00' });

  it('sums only valid lines and ignores lines with nothing remaining', () => {
    const s = summarize([l1, l2], { 'sl-1': inp('2'), 'sl-2': inp('1') });
    expect(s).toMatchObject({ itemCount: 1, hasErrors: false, net: 20000, tax: 3000, total: 23000 });
  });

  it('reports errors and excludes the offending line from totals', () => {
    const s = summarize([l1], { 'sl-1': inp('9') });
    expect(s).toMatchObject({ itemCount: 0, hasErrors: true, total: 0 });
  });
});

describe('buildLinkedBody', () => {
  const base = { partnerId: 'c-1', invoiceId: 'inv-1', refundType: 'credit', noteDate: '2026-10-11', reason: '' };

  it('builds the invoice-linked body with only credited lines and no client tax/type', () => {
    const l2 = line({ source_line_id: 'sl-2' });
    const body = buildLinkedBody({
      ...base, lines: [line(), l2], inputs: { 'sl-1': inp('2'), 'sl-2': inp('0') },
    });
    expect(body).toEqual({
      partner_id: 'c-1', original_invoice_id: 'inv-1', refund_type: 'credit',
      note_date: '2026-10-11', reason: null,
      items: [{ source_line_id: 'sl-1', quantity: 2 }],
    });
    expect(body).not.toHaveProperty('type');
  });

  it('sends unit_price in halalas only when lowered', () => {
    const body = buildLinkedBody({
      ...base, reason: 'تالف', lines: [line(), line({ source_line_id: 'sl-2' })],
      inputs: { 'sl-1': inp('1', '75.50'), 'sl-2': inp('1', '100') },
    });
    expect(body.reason).toBe('تالف');
    expect(body.items).toEqual([
      { source_line_id: 'sl-1', quantity: 1, unit_price: 7550 },
      { source_line_id: 'sl-2', quantity: 1 },
    ]);
  });

  it('yields no items when nothing is credited or a line is invalid', () => {
    expect(buildLinkedBody({ ...base, lines: [line()], inputs: {} }).items).toEqual([]);
    expect(buildLinkedBody({ ...base, lines: [line()], inputs: { 'sl-1': inp('9') } }).items).toEqual([]);
  });
});
