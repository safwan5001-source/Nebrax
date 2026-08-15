import { describe, expect, it } from 'vitest';
import {
  ASSIGNMENT_DOCUMENT_TYPES,
  ASSIGNMENT_USAGES,
  buildPrintTemplateAssignmentPayload,
} from './print-template-assignment-contract';

describe('print-template assignment payload', () => {
  it('uses a null branch identifier for the company default', () => {
    expect(buildPrintTemplateAssignmentPayload({
      scope: 'company',
      branchId: 'branch-ignored',
      documentType: 'tax_invoice',
      usage: 'print',
      revisionId: 'revision-1',
    })).toEqual({
      branch_id: null,
      document_type: 'tax_invoice',
      usage: 'print',
      print_template_revision_id: 'revision-1',
    });
  });

  it('preserves an explicit branch identifier for a branch override', () => {
    expect(buildPrintTemplateAssignmentPayload({
      scope: 'branch',
      branchId: 'branch-42',
      documentType: 'purchase_invoice',
      usage: 'pdf',
      revisionId: 'revision-2',
    })).toEqual({
      branch_id: 'branch-42',
      document_type: 'purchase_invoice',
      usage: 'pdf',
      print_template_revision_id: 'revision-2',
    });
  });

  it('exposes the backend-supported print usages and document family choices', () => {
    expect(ASSIGNMENT_USAGES).toEqual(['print', 'pdf', 'thermal']);
    expect(ASSIGNMENT_DOCUMENT_TYPES).toContain('tax_invoice');
    expect(ASSIGNMENT_DOCUMENT_TYPES).toContain('purchase_invoice');
    expect(ASSIGNMENT_DOCUMENT_TYPES).toContain('payment_voucher');
  });
});
