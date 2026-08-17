import { describe, expect, it } from 'vitest';
import type { DocumentTypeId } from '../types';
import { getDocumentPreviewModel } from './document-samples';
import {
  DEFAULT_DOCUMENT_ITEMS_COLUMNS,
  DOCUMENT_ITEMS_COLUMN_IDS,
  DOCUMENT_TYPE_REGISTRY,
  getDefaultDocumentLayout,
  isDocumentBlockAllowed,
  listDocumentVariables,
  validateDocumentLayout,
  validateDocumentBlockProperties,
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

  it('validates advanced block properties against the rendered contract', () => {
    const layout = getDefaultDocumentLayout('tax_invoice').map((item) => {
      if (item.key === 'items') {
        return {
          ...item,
          properties: {
            columns: [
              { id: 'description' as const, label: 'الصنف' },
              { id: 'product_code' as const },
              { id: 'barcode' as const },
              { id: 'price_before_tax' as const },
              { id: 'total' as const },
            ],
            font_size: 'md' as const,
          },
        };
      }
      if (item.key === 'footer') return { ...item, properties: { static_content: 'تذييل ثابت', alignment: 'center' as const } };
      return item;
    });

    expect(validateDocumentBlockProperties('tax_invoice', layout)).toEqual({ valid: true, errors: [] });

    const invalid = layout.map((item) => item.key === 'items'
      ? { ...item, properties: { columns: [{ id: 'description' as const }] } }
      : item,
    );
    expect(validateDocumentBlockProperties('tax_invoice', invalid)).toEqual({
      valid: false,
      errors: ['required_items_column_missing'],
    });

    const unsupported = layout.map((item) => item.key === 'header'
      ? { ...item, properties: { static_content: 'غير مدعوم' } }
      : item,
    );
    expect(validateDocumentBlockProperties('tax_invoice', unsupported)).toEqual({
      valid: false,
      errors: ['unsupported_block_property:header:static_content'],
    });
  });

  it('keeps product identity and net-price columns optional by default', () => {
    expect(DOCUMENT_ITEMS_COLUMN_IDS).toEqual(expect.arrayContaining([
      'product_code', 'barcode', 'price_before_tax',
    ]));
    expect(DEFAULT_DOCUMENT_ITEMS_COLUMNS).not.toEqual(expect.arrayContaining([
      'product_code', 'barcode', 'price_before_tax',
    ]));
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
    expect(preview.lines[0]).toMatchObject({
      productName: 'خدمة استشارية شهرية',
      productCode: 'SRV-100',
      barcode: '628100000001',
      priceBeforeTax: 100000,
    });
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
