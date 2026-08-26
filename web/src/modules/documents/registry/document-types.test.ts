import { describe, expect, it } from 'vitest';
import type { DocumentTypeId } from '../types';
import { getDocumentPreviewModel } from './document-samples';
import {
  DEFAULT_DOCUMENT_ITEMS_COLUMNS,
  DOCUMENT_ITEMS_COLUMN_IDS,
  DOCUMENT_TYPE_DEFAULT_ITEM_COLUMNS,
  DOCUMENT_TYPE_REGISTRY,
  getDefaultDocumentItemColumns,
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
      if (item.key === 'stamp') return { ...item, properties: { image_size: 'lg' as const, image_opacity: 'soft' as const } };
      if (item.key === 'signature') return { ...item, properties: { image_size: 'sm' as const, image_opacity: 'solid' as const } };
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

    const invalidImageSize = layout.map((item) => item.key === 'stamp'
      ? { ...item, properties: { image_size: 'xl' as never } }
      : item,
    );
    expect(validateDocumentBlockProperties('tax_invoice', invalidImageSize)).toEqual({
      valid: false,
      errors: ['invalid_block_image_size:stamp'],
    });

    const invalidImageOpacity = layout.map((item) => item.key === 'signature'
      ? { ...item, properties: { image_opacity: 'transparent' as never } }
      : item,
    );
    expect(validateDocumentBlockProperties('tax_invoice', invalidImageOpacity)).toEqual({
      valid: false,
      errors: ['invalid_block_image_opacity:signature'],
    });
  });

  it('keeps the full financial column catalog available for builder customization', () => {
    expect(DOCUMENT_ITEMS_COLUMN_IDS).toEqual([
      'number', 'product_code', 'barcode', 'product', 'description', 'unit_price',
      'quantity', 'price_before_tax', 'tax', 'total',
    ]);
    expect(DEFAULT_DOCUMENT_ITEMS_COLUMNS).toEqual([
      'number', 'product_code', 'barcode', 'product', 'description', 'unit_price',
      'quantity', 'price_before_tax', 'tax', 'total',
    ]);
  });

  it('uses semantic fallback layouts and columns for the five commercial document types', () => {
    const expected = {
      quotation: {
        visible: ['header', 'parties', 'items', 'summary', 'notes', 'terms', 'bank', 'stamp', 'signature', 'footer'],
        columns: ['number', 'product', 'description', 'quantity', 'unit_price', 'tax', 'total'],
      },
      sales_order: {
        visible: ['header', 'parties', 'items', 'summary', 'notes', 'terms', 'signature', 'footer'],
        columns: ['number', 'product_code', 'product', 'description', 'quantity', 'unit_price', 'total'],
      },
      purchase_order: {
        visible: ['header', 'parties', 'items', 'summary', 'terms', 'notes', 'signature', 'footer'],
        columns: ['number', 'product_code', 'product', 'description', 'quantity', 'unit_price', 'total'],
      },
      purchase_invoice: {
        visible: ['header', 'parties', 'items', 'summary', 'notes', 'bank', 'footer'],
        columns: ['number', 'product_code', 'product', 'description', 'quantity', 'unit_price', 'tax', 'total'],
      },
      delivery_note: {
        visible: ['header', 'parties', 'items', 'notes', 'signature', 'footer'],
        columns: ['number', 'product_code', 'product', 'description', 'quantity'],
      },
    } as const;

    for (const [type, expectation] of Object.entries(expected) as [keyof typeof expected, (typeof expected)[keyof typeof expected]][]) {
      expect(getDefaultDocumentLayout(type).filter((item) => item.visible).map((item) => item.key)).toEqual(expectation.visible);
      expect(getDefaultDocumentItemColumns(type)).toEqual(expectation.columns);
      expect(DOCUMENT_TYPE_DEFAULT_ITEM_COLUMNS[type]).toEqual(expectation.columns);
    }
  });

  it('keeps financial summary and tax columns out of the Delivery Note fallback', () => {
    const layout = getDefaultDocumentLayout('delivery_note');

    expect(layout.find((item) => item.key === 'summary')?.visible).toBe(false);
    expect(getDefaultDocumentItemColumns('delivery_note')).not.toEqual(expect.arrayContaining(['unit_price', 'tax', 'total']));
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

  it('provides semantic safe preview data for the five commercial types', () => {
    const quotation = getDocumentPreviewModel('quotation');
    const salesOrder = getDocumentPreviewModel('sales_order');
    const purchaseOrder = getDocumentPreviewModel('purchase_order');
    const purchaseInvoice = getDocumentPreviewModel('purchase_invoice');
    const deliveryNote = getDocumentPreviewModel('delivery_note');

    expect(quotation.meta).toMatchObject({ number: 'Q-2026-0001', dueDate: '2026-09-14', paymentType: null });
    expect(salesOrder.meta).toMatchObject({ number: 'SO-2026-0001', dueDate: '2026-09-30', paymentType: null });
    expect(purchaseOrder).toMatchObject({ buyer: { name: 'المورد التجريبي' }, meta: { number: 'PO-2026-0001' } });
    expect(purchaseInvoice).toMatchObject({ buyer: { name: 'المورد التجريبي' }, meta: { number: 'PI-2026-0001', paymentType: 'credit' } });
    expect(deliveryNote).toMatchObject({ meta: { number: 'DN-2026-0001', dueDate: null, paymentType: null }, qr: null });
    expect(deliveryNote.notes).toContain('تم تسليم');
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
