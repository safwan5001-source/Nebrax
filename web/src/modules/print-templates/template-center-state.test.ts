import { describe, expect, it } from 'vitest';
import { getDefaultDocumentLayout } from '@/modules/documents/registry/document-types';
import {
  canOpenTemplateCenterDocumentType,
  documentTypesForDraftSave,
  resolveActiveDocumentType,
  validateLayoutForDocumentTypes,
} from './template-center-state';

describe('template center state', () => {
  it('keeps the document type requested from the center when the selected template supports it', () => {
    expect(resolveActiveDocumentType(['tax_invoice', 'quotation'], 'quotation')).toBe('quotation');
  });

  it('falls back to the template default type when opened without a document-type intent', () => {
    expect(resolveActiveDocumentType(['tax_invoice', 'quotation'], null)).toBe('tax_invoice');
  });

  it('preserves every revision document type when saving a draft from one active type', () => {
    expect(documentTypesForDraftSave(['tax_invoice', 'quotation'], ['tax_invoice', 'quotation'])).toEqual([
      'tax_invoice',
      'quotation',
    ]);
  });

  it('does not allow document-type actions while loading or after a load failure', () => {
    expect(canOpenTemplateCenterDocumentType('loading')).toBe(false);
    expect(canOpenTemplateCenterDocumentType('error')).toBe(false);
    expect(canOpenTemplateCenterDocumentType('ready')).toBe(true);
    expect(canOpenTemplateCenterDocumentType('empty')).toBe(true);
  });

  it('requires a shared layout to stay valid for every type attached to the template', () => {
    const invoiceLayout = getDefaultDocumentLayout('tax_invoice');

    expect(validateLayoutForDocumentTypes(['tax_invoice', 'quotation'], invoiceLayout)).toEqual({ valid: true, errors: [] });
    expect(validateLayoutForDocumentTypes(['tax_invoice', 'receipt_voucher'], invoiceLayout)).toEqual({
      valid: false,
      errors: ['mixed_document_families'],
    });
  });
});
