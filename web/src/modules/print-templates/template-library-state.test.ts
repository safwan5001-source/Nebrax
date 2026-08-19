import { describe, expect, it } from 'vitest';
import {
  assignmentsForTemplate,
  filterTemplateLibrary,
  templateFamilyForDocumentType,
  type TemplateLibraryAssignment,
  type TemplateLibraryFilters,
  type TemplateLibraryTemplate,
} from './template-library-state';

const templates: TemplateLibraryTemplate[] = [
  {
    id: 'sales-published',
    name: 'فاتورة مبيعات الرسمية',
    status: 'published',
    document_types: ['tax_invoice'],
    published_revision: { id: 'published-sales', version: 2, status: 'published', document_types: ['tax_invoice'] },
    updated_at: '2026-08-18T05:00:00Z',
  },
  {
    id: 'purchase-draft',
    name: 'مسودة مشتريات',
    status: 'draft',
    document_types: ['purchase_invoice'],
    draft_revision: { id: 'draft-purchase', version: 1, status: 'draft', document_types: ['purchase_invoice'] },
    updated_at: '2026-08-18T05:00:00Z',
  },
  {
    id: 'sales-unassigned',
    name: 'عرض سعر غير معيّن',
    status: 'published',
    document_types: ['quotation'],
    published_revision: { id: 'published-quotation', version: 1, status: 'published', document_types: ['quotation'] },
    updated_at: '2026-08-18T05:00:00Z',
  },
];

const assignments: TemplateLibraryAssignment[] = [
  {
    id: 'assignment-company',
    branch_id: null,
    scope: 'company',
    document_type: 'tax_invoice',
    usage: 'print',
    print_template_revision_id: 'published-sales',
  },
  {
    id: 'assignment-branch',
    branch_id: 'branch-khobar',
    scope: 'branch',
    document_type: 'tax_invoice',
    usage: 'pdf',
    print_template_revision_id: 'published-sales',
  },
];

const baseFilters: TemplateLibraryFilters = {
  query: '',
  family: 'all',
  documentType: 'all',
  revisionStatus: 'all',
  usage: 'all',
  assignmentScope: 'all',
};

const labels = {
  tax_invoice: 'فاتورة ضريبية',
  simplified_tax_invoice: 'فاتورة مبسطة',
  quotation: 'عرض سعر',
  proforma_invoice: 'فاتورة أولية',
  sales_order: 'أمر بيع',
  purchase_order: 'أمر شراء',
  purchase_invoice: 'فاتورة مشتريات',
  delivery_note: 'إذن تسليم',
  packing_list: 'قائمة تعبئة',
  receipt_voucher: 'سند قبض',
  payment_voucher: 'سند صرف',
  credit_note: 'إشعار دائن',
  debit_note: 'إشعار مدين',
  statement_of_account: 'كشف حساب',
} as const;

describe('template library state', () => {
  it('derives the center family for an assignable document type', () => {
    expect(templateFamilyForDocumentType('receipt_voucher')).toBe('finance');
    expect(templateFamilyForDocumentType('purchase_invoice')).toBe('purchases');
  });

  it('links assignment badges only to the published revision of their template', () => {
    expect(assignmentsForTemplate(templates[0], assignments)).toHaveLength(2);
    expect(assignmentsForTemplate(templates[1], assignments)).toHaveLength(0);
  });

  it('filters templates by family, document type, and revision status', () => {
    expect(filterTemplateLibrary(templates, assignments, { ...baseFilters, family: 'purchases' }, (type) => labels[type])).toEqual([templates[1]]);
    expect(filterTemplateLibrary(templates, assignments, { ...baseFilters, documentType: 'quotation' }, (type) => labels[type])).toEqual([templates[2]]);
    expect(filterTemplateLibrary(templates, assignments, { ...baseFilters, revisionStatus: 'draft' }, (type) => labels[type])).toEqual([templates[1]]);
  });

  it('filters published templates by output channel and assignment scope', () => {
    expect(filterTemplateLibrary(templates, assignments, { ...baseFilters, usage: 'pdf' }, (type) => labels[type])).toEqual([templates[0]]);
    expect(filterTemplateLibrary(templates, assignments, { ...baseFilters, assignmentScope: 'branch-khobar' }, (type) => labels[type])).toEqual([templates[0]]);
    expect(filterTemplateLibrary(templates, assignments, { ...baseFilters, assignmentScope: 'company' }, (type) => labels[type])).toEqual([templates[0]]);
  });

  it('finds published templates without assignments and searches names or document labels', () => {
    expect(filterTemplateLibrary(templates, assignments, { ...baseFilters, revisionStatus: 'unassigned' }, (type) => labels[type])).toEqual([templates[2]]);
    expect(filterTemplateLibrary(templates, assignments, { ...baseFilters, query: 'مشتريات' }, (type) => labels[type])).toEqual([templates[1]]);
  });
});
