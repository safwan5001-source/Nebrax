import { describe, expect, it } from 'vitest';
import {
  canContinueTemplateCreation,
  initialTemplateCreationDraft,
  publishedSourcesForDocumentType,
  sourceSupportsDocumentType,
} from './template-creation-state';

const templates = [
  {
    id: 'invoice-template',
    name: 'فاتورة ضريبية',
    document_types: ['tax_invoice', 'simplified_tax_invoice'] as const,
    published_revision: {
      id: 'invoice-r2',
      version: 2,
      document_types: ['tax_invoice', 'simplified_tax_invoice'] as const,
    },
  },
  {
    id: 'quotation-template',
    name: 'عرض سعر',
    document_types: ['quotation'] as const,
    published_revision: {
      id: 'quotation-r3',
      version: 3,
      document_types: ['quotation'] as const,
    },
  },
  {
    id: 'draft-only',
    name: 'مسودة فقط',
    document_types: ['tax_invoice'] as const,
    published_revision: null,
  },
];

describe('template creation state', () => {
  it('starts with a print context and compatible base source', () => {
    expect(initialTemplateCreationDraft('quotation', 'عرض سعر جديد')).toEqual({
      documentType: 'quotation',
      usage: 'print',
      source: { kind: 'base' },
      name: 'عرض سعر جديد',
    });
  });

  it('offers published sources only when their published revision supports the selected type', () => {
    expect(publishedSourcesForDocumentType(templates, 'tax_invoice')).toEqual([
      expect.objectContaining({ templateId: 'invoice-template', revisionId: 'invoice-r2', version: 2 }),
    ]);
    expect(publishedSourcesForDocumentType(templates, 'quotation')).toEqual([
      expect.objectContaining({ templateId: 'quotation-template', revisionId: 'quotation-r3', version: 3 }),
    ]);
  });

  it('rejects a published source after the document type becomes incompatible', () => {
    const source = { kind: 'published' as const, templateId: 'invoice-template', revisionId: 'invoice-r2', version: 2 };
    expect(sourceSupportsDocumentType(source, templates, 'tax_invoice')).toBe(true);
    expect(sourceSupportsDocumentType(source, templates, 'quotation')).toBe(false);
    expect(canContinueTemplateCreation(2, { ...initialTemplateCreationDraft('quotation'), source }, templates)).toBe(false);
  });

  it('requires a nonempty name before creating a draft', () => {
    expect(canContinueTemplateCreation(3, initialTemplateCreationDraft('tax_invoice'), templates)).toBe(false);
    expect(canContinueTemplateCreation(3, initialTemplateCreationDraft('tax_invoice', 'فاتورة التجزئة'), templates)).toBe(true);
  });
});
