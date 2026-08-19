import { describe, expect, it } from 'vitest';
import { resolveAssignmentContext } from './print-template-assignment-resolution';

const assignments = [
  {
    id: 'company-print',
    branch_id: null,
    document_type: 'tax_invoice' as const,
    usage: 'print' as const,
    print_template_revision_id: 'revision-company',
  },
  {
    id: 'riyadh-print',
    branch_id: 'branch-riyadh',
    document_type: 'tax_invoice' as const,
    usage: 'print' as const,
    print_template_revision_id: 'revision-riyadh',
  },
];

describe('print template assignment resolution context', () => {
  it('shows the company assignment as both target and effective for the company scope', () => {
    expect(resolveAssignmentContext({
      assignments,
      scope: 'company',
      branchId: '',
      documentType: 'tax_invoice',
      usage: 'print',
    })).toMatchObject({
      target: { id: 'company-print' },
      effective: { id: 'company-print' },
      companyFallback: { id: 'company-print' },
    });
  });

  it('shows an explicit branch override before the company fallback', () => {
    expect(resolveAssignmentContext({
      assignments,
      scope: 'branch',
      branchId: 'branch-riyadh',
      documentType: 'tax_invoice',
      usage: 'print',
    })).toMatchObject({
      target: { id: 'riyadh-print' },
      effective: { id: 'riyadh-print' },
      companyFallback: { id: 'company-print' },
    });
  });

  it('shows the company fallback when the selected branch has no explicit override', () => {
    expect(resolveAssignmentContext({
      assignments,
      scope: 'branch',
      branchId: 'branch-khobar',
      documentType: 'tax_invoice',
      usage: 'print',
    })).toMatchObject({
      target: null,
      effective: { id: 'company-print' },
      companyFallback: { id: 'company-print' },
    });
  });

  it('keeps an empty branch selection unresolved instead of inventing an override', () => {
    expect(resolveAssignmentContext({
      assignments,
      scope: 'branch',
      branchId: '',
      documentType: 'tax_invoice',
      usage: 'print',
    })).toMatchObject({
      target: null,
      effective: { id: 'company-print' },
    });
  });
});
