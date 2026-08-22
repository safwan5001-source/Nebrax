import { describe, expect, it } from 'vitest';
import { getDocumentPreviewModel } from '@/modules/documents/registry/document-samples';
import { adaptLegacyOperationalDocument } from './from-legacy-document-model';
import {
  isLineItemDocumentType,
  isVoucherDocumentType,
} from './types';

describe('Document family compatibility adapter', () => {
  it('adapts a line-item document without changing its values', () => {
    const legacy = getDocumentPreviewModel('tax_invoice');
    const adapted = adaptLegacyOperationalDocument(legacy);

    expect(adapted.family).toBe('line_item');
    if (adapted.family !== 'line_item') throw new Error('expected-line-item-family');

    expect(adapted.type).toBe('tax_invoice');
    expect(adapted.lines).toEqual(legacy.lines);
    expect(adapted.totals).toEqual(legacy.totals);
    expect(adapted.compliance.qr).toEqual(legacy.qr);
    expect(adapted.content.notes).toBe(legacy.notes);
  });

  it('copies legacy line-item values so the compatibility boundary is not mutable by callers', () => {
    const legacy = getDocumentPreviewModel('tax_invoice');
    const adapted = adaptLegacyOperationalDocument(legacy);

    if (adapted.family !== 'line_item') throw new Error('expected-line-item-family');

    legacy.seller.name = 'تغيير في المصدر';
    legacy.lines[0].description = 'تغيير في المصدر';
    legacy.totals.total = 1;

    expect(adapted.seller.name).toBe('شركة نبراس التجريبية');
    expect(adapted.lines[0].description).toBe('خدمة استشارية شهرية');
    expect(adapted.totals.total).toBe(172500);
  });

  it('adapts a voucher without synthetic invoice lines or totals', () => {
    const legacy = getDocumentPreviewModel('payment_voucher');
    const adapted = adaptLegacyOperationalDocument(legacy);

    expect(adapted.family).toBe('voucher');
    if (adapted.family !== 'voucher') throw new Error('expected-voucher-family');

    expect(adapted.type).toBe('payment_voucher');
    expect(adapted.voucher).toEqual(legacy.voucher);
    expect('lines' in adapted).toBe(false);
    expect('totals' in adapted).toBe(false);
  });

  it('rejects a legacy voucher when its essential voucher body is absent', () => {
    const legacy = getDocumentPreviewModel('receipt_voucher');
    legacy.voucher = null;

    expect(() => adaptLegacyOperationalDocument(legacy)).toThrow('legacy_voucher_payload_missing:receipt_voucher');
  });

  it('keeps report and statement types outside the legacy operational adapter', () => {
    const legacy = getDocumentPreviewModel('statement_of_account');

    expect(() => adaptLegacyOperationalDocument(legacy)).toThrow('legacy_document_family_not_supported:statement_of_account');
  });

  it('exposes type guards that match the registered operational types only', () => {
    expect(isLineItemDocumentType('tax_invoice')).toBe(true);
    expect(isLineItemDocumentType('receipt_voucher')).toBe(false);
    expect(isVoucherDocumentType('receipt_voucher')).toBe(true);
    expect(isVoucherDocumentType('statement_of_account')).toBe(false);
  });
});
