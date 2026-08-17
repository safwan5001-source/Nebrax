import { describe, expect, it } from 'vitest';
import type { DocumentTypeId } from '../types';
import { getDocumentPreviewModel } from './document-samples';
import {
  DOCUMENT_TYPE_REGISTRY,
  getDefaultDocumentLayout,
  isDocumentBlockAllowed,
  listDocumentVariables,
  validateDocumentLayout,
} from './document-types';

const DOCUMENT_TYPES: readonly DocumentTypeId[] = [
  'tax_invoice', 'simplified_tax_invoice', 'quotation', 'proforma_invoice',
  'sales_order', 'purchase_order', 'purchase_invoice', 'delivery_note', 'packing_list',
  'receipt_voucher', 'payment_voucher', 'credit_note', 'debit_note',
  'statement_of_account',
];

describe('Document type registry', () => {
  it('covers every declared document type with a valid default layout', () => {
    expect(Object.keys(DOCUMENT_TYPE_REGISTRY).sort()).toEqual([...DOCUMENT_TYPES].sort());

    for (const type of DOCUMENT_TYPES) {
      const definition = DOCUMENT_TYPE_REGISTRY[type];
      const layout = getDefaultDocumentLayout(type);

      expect(definition.supportedPaper.length).toBeGreaterThan(0);
      expect(definition.allowedBlocks.length).toBeGreaterThan(0);
      expect(layout).not.toBe(definition.defaultLayout);
      expect(validateDocumentLayout(type, layout)).toEqual({ valid: true, errors: [] });
    }
  });

  it('declares thermal paper for posted purchase and note outputs', () => {
    for (const type of ['purchase_invoice', 'credit_note', 'debit_note'] as const) {
      expect(DOCUMENT_TYPE_REGISTRY[type].supportedPaper).toEqual(expect.arrayContaining(['thermal_58', 'thermal_80']));
    }
  });

  it('rejects blocks that do not belong to the document family', () => {
    expect(isDocumentBlockAllowed('receipt_voucher', 'items')).toBe(false);
    expect(isDocumentBlockAllowed('tax_invoice', 'voucher')).toBe(false);

    const voucherLayout = getDefaultDocumentLayout('receipt_voucher');
    const withItems = [...voucherLayout, { key: 'items' as const, visible: true }];
    expect(validateDocumentLayout('receipt_voucher', withItems)).toEqual({
      valid: false,
      errors: ['unsupported_block:items'],
    });
  });

  it('requires core blocks to remain visible', () => {
    const layout = getDefaultDocumentLayout('tax_invoice').map((item) => (
      item.key === 'items' ? { ...item, visible: false } : item
    ));

    expect(validateDocumentLayout('tax_invoice', layout)).toEqual({
      valid: false,
      errors: ['required_block_hidden:items'],
    });
  });

  it('exposes only compatible variables for vouchers', () => {
    const variables = listDocumentVariables('receipt_voucher').map((variable) => variable.id);

    expect(variables).toContain('payment.amount');
    expect(variables).toContain('payment.allocations');
    expect(variables).not.toContain('line.items');
    expect(variables).not.toContain('compliance.zatca_qr');
  });
});

describe('Document preview samples', () => {
  it('provides a safe data shape for line-item documents', () => {
    const preview = getDocumentPreviewModel('tax_invoice');

    expect(preview.type).toBe('tax_invoice');
    expect(preview.lines).toHaveLength(2);
    expect(preview.totals.total).toBe(172500);
    expect(preview.qr?.value).toContain('preview');
  });

  it('provides a safe line-item body for purchase invoices', () => {
    const preview = getDocumentPreviewModel('purchase_invoice');

    expect(preview.type).toBe('purchase_invoice');
    expect(preview.lines).toHaveLength(2);
    expect(preview.qr).toBeNull();
  });

  it('provides a voucher body without line items for payment documents', () => {
    const preview = getDocumentPreviewModel('payment_voucher');

    expect(preview.lines).toEqual([]);
    expect(preview.voucher).toMatchObject({ direction: 'paid', amount: 172500 });
    expect(preview.voucher?.allocations).toHaveLength(2);
  });

  it('returns independent preview instances', () => {
    const first = getDocumentPreviewModel('quotation');
    const second = getDocumentPreviewModel('quotation');

    first.seller.name = 'تعديل محلي';
    first.lines[0].description = 'تعديل محلي';

    expect(second.seller.name).toBe('شركة نبراس التجريبية');
    expect(second.lines[0].description).toBe('خدمة استشارية شهرية');
  });
});
