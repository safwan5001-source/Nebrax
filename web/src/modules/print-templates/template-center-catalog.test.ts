import { describe, expect, it } from 'vitest';
import { ASSIGNMENT_DOCUMENT_TYPES } from './components/print-template-assignment-contract';
import { filterTemplateCenterFamilies, TEMPLATE_CENTER_FAMILIES } from './template-center-catalog';

const documentLabels = {
  tax_invoice: 'فاتورة ضريبية',
  simplified_tax_invoice: 'فاتورة ضريبية مبسطة',
  quotation: 'عرض سعر',
  proforma_invoice: 'فاتورة أولية',
  sales_order: 'أمر بيع',
  purchase_order: 'أمر شراء',
  purchase_invoice: 'فاتورة مشتريات',
  delivery_note: 'إذن تسليم',
  packing_list: 'قائمة تعبئة',
  credit_note: 'إشعار دائن',
  debit_note: 'إشعار مدين',
  receipt_voucher: 'سند قبض',
  payment_voucher: 'سند صرف',
  statement_of_account: 'كشف حساب',
} as const;

const familyLabels = {
  sales: 'المبيعات',
  purchases: 'المشتريات والموردون',
  finance: 'المالية والسندات',
  logistics: 'المخزون واللوجستيات',
} as const;

describe('template center catalog', () => {
  it('stays synchronized with the currently assignable document types', () => {
    expect(TEMPLATE_CENTER_FAMILIES.flatMap((family) => family.documentTypes).sort()).toEqual([...ASSIGNMENT_DOCUMENT_TYPES].sort());
  });

  it('lists every supported family when no search is supplied', () => {
    const result = filterTemplateCenterFamilies('', (type) => documentLabels[type], (family) => familyLabels[family]);

    expect(result).toEqual(TEMPLATE_CENTER_FAMILIES);
  });

  it('filters to the document type that matches the search', () => {
    const result = filterTemplateCenterFamilies('قبض', (type) => documentLabels[type], (family) => familyLabels[family]);

    expect(result).toEqual([
      { id: 'finance', documentTypes: ['receipt_voucher'] },
    ]);
  });

  it('keeps the complete family when its business label matches the search', () => {
    const result = filterTemplateCenterFamilies('المبيعات', (type) => documentLabels[type], (family) => familyLabels[family]);

    expect(result).toEqual([
      TEMPLATE_CENTER_FAMILIES[0],
    ]);
  });

  it('returns no family for a query outside the supported document catalog', () => {
    const result = filterTemplateCenterFamilies('حجوزات', (type) => documentLabels[type], (family) => familyLabels[family]);

    expect(result).toEqual([]);
  });
});
