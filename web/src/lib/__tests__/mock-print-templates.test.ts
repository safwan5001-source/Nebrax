import { describe, expect, it } from 'vitest';
import { mockApi } from '../mock-data';

type MockTemplate = {
  id: string;
  name: string;
  status: 'draft' | 'published' | 'archived';
  document_types: string[];
  draft_revision: { id: string; status: string; definition: Record<string, unknown> } | null;
  published_revision: { id: string; status: string; published_at?: string | null } | null;
  revisions: unknown[];
};

type MockAssignment = {
  id: string;
  branch_id: string | null;
  scope: 'company' | 'branch';
  document_type: string;
  usage: 'print' | 'pdf' | 'thermal';
  print_template_revision_id: string;
  revision: { id: string; version: number; status: string } | null;
};

describe('قوالب الطباعة في وضع المعاينة', () => {
  it('تعيد إنشاء المسودة عقد الاستوديو الكامل ثم تحفظ وتنشر وتنسخ محلياً', async () => {
    const created = await mockApi<{ data: MockTemplate }>('/print-templates', 'POST', {
      name: 'قالب فاتورة تجريبي',
      document_types: ['tax_invoice'],
      definition: { template_id: 'tax-invoice-classic', theme_id: 'blue', layout: [] },
    });

    expect(created.data).toMatchObject({
      name: 'قالب فاتورة تجريبي',
      status: 'draft',
      document_types: ['tax_invoice'],
      draft_revision: { status: 'draft', definition: { template_id: 'tax-invoice-classic' } },
    });
    expect(created.data.revisions).toHaveLength(1);

    const saved = await mockApi<{ data: MockTemplate }>(`/print-templates/${created.data.id}/draft`, 'PUT', {
      name: 'قالب فاتورة تجريبي محدّث',
      document_types: ['tax_invoice'],
      definition: { template_id: 'tax-invoice-classic', theme_id: 'green', layout: [] },
    });
    expect(saved.data.draft_revision).toMatchObject({ status: 'draft', definition: { theme_id: 'green' } });
    expect(saved.data.revisions).toHaveLength(2);

    const published = await mockApi<{ data: MockTemplate }>(`/print-templates/${created.data.id}/publish`, 'POST');
    expect(published.data).toMatchObject({ status: 'published', draft_revision: null, published_revision: { status: 'published' } });

    const copied = await mockApi<{ data: MockTemplate }>(`/print-templates/${created.data.id}/duplicate`, 'POST', {
      name: 'نسخة معاينة',
    });
    expect(copied.data).toMatchObject({ name: 'نسخة معاينة', status: 'draft', draft_revision: { status: 'draft' } });

    const list = await mockApi<{ data: MockTemplate[] }>('/print-templates');
    expect(list.data.map((template) => template.id)).toContain(copied.data.id);
  });

  it('تعرض وتحفظ أولوية افتراضي المؤسسة ثم تجاوز الفرع محلياً', async () => {
    const companyTemplate = await mockApi<{ data: MockTemplate }>('/print-templates', 'POST', {
      name: 'قالب المؤسسة',
      document_types: ['tax_invoice'],
      definition: { template_id: 'tax-invoice-classic' },
    });
    const companyPublished = await mockApi<{ data: MockTemplate }>(`/print-templates/${companyTemplate.data.id}/publish`, 'POST');
    const companyRevisionId = companyPublished.data.published_revision!.id;

    const branchTemplate = await mockApi<{ data: MockTemplate }>('/print-templates', 'POST', {
      name: 'قالب الفرع',
      document_types: ['tax_invoice'],
      definition: { template_id: 'tax-invoice-modern' },
    });
    const branchPublished = await mockApi<{ data: MockTemplate }>(`/print-templates/${branchTemplate.data.id}/publish`, 'POST');
    const branchRevisionId = branchPublished.data.published_revision!.id;

    const companyAssignment = await mockApi<{ data: MockAssignment }>('/print-templates/assignments/default', 'PUT', {
      branch_id: null,
      document_type: 'tax_invoice',
      usage: 'print',
      print_template_revision_id: companyRevisionId,
    });
    expect(companyAssignment.data).toMatchObject({
      scope: 'company',
      print_template_revision_id: companyRevisionId,
      revision: { status: 'published' },
    });

    const branchAssignment = await mockApi<{ data: MockAssignment }>('/print-templates/assignments/default', 'PUT', {
      branch_id: 'demo-branch-riyadh',
      document_type: 'tax_invoice',
      usage: 'print',
      print_template_revision_id: branchRevisionId,
    });
    expect(branchAssignment.data).toMatchObject({ scope: 'branch', branch_id: 'demo-branch-riyadh' });

    const resolvedBranch = await mockApi<{ data: MockAssignment | null }>('/print-templates/resolve?document_type=tax_invoice&usage=print&branch_id=demo-branch-riyadh');
    expect(resolvedBranch.data).toMatchObject({
      scope: 'branch',
      print_template_revision_id: branchRevisionId,
    });

    const resolvedFallback = await mockApi<{ data: MockAssignment | null }>('/print-templates/resolve?document_type=tax_invoice&usage=print&branch_id=demo-branch-khobar');
    expect(resolvedFallback.data).toMatchObject({
      scope: 'company',
      print_template_revision_id: companyRevisionId,
    });
  });
});
