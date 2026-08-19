'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Building2, GitBranch, Loader2, SlidersHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import type { DocumentTypeId } from '@/modules/documents/types';
import {
  ASSIGNMENT_USAGES,
  buildPrintTemplateAssignmentPayload,
  type AssignmentScope,
  type AssignmentUsage,
} from './print-template-assignment-contract';
import {
  resolveAssignmentContext,
  type AssignmentResolutionItem,
} from './print-template-assignment-resolution';

interface PublishedRevision {
  id: string;
  version: number;
  status: 'draft' | 'published' | 'superseded';
  document_types: DocumentTypeId[];
}

interface TemplateForAssignment {
  id: string;
  name: string;
  published_revision?: PublishedRevision | null;
}

interface Branch {
  id: string;
  code: string;
  name: string;
  is_main: boolean;
  is_active: boolean;
}

interface Assignment extends AssignmentResolutionItem {
  scope: AssignmentScope;
  revision?: {
    id: string;
    version: number;
    status: 'draft' | 'published' | 'superseded';
    document_types: DocumentTypeId[];
  } | null;
}

/**
 * لوحة التعيينات لا تعدّل المراجعات ولا تنشئ سياسة جديدة؛ تستهلك حصراً مسار
 * upsert الخلفي، فتجعل تجاوز الفرع والافتراضي المؤسسي مرئيين وقابلين للتدقيق.
 */
export function PrintTemplateAssignments({
  template,
  canManage,
}: {
  template: TemplateForAssignment;
  canManage: boolean;
}) {
  const { success, error } = useToast();
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [scope, setScope] = useState<AssignmentScope>('company');
  const [branchId, setBranchId] = useState('');
  const [documentType, setDocumentType] = useState<DocumentTypeId>('tax_invoice');
  const [usage, setUsage] = useState<AssignmentUsage>('print');
  const [saving, setSaving] = useState(false);

  const revision = template.published_revision ?? null;
  const supportedTypes = revision?.document_types ?? [];
  const activeBranches = useMemo(() => branches.filter((branch) => branch.is_active), [branches]);
  const assignmentContext = useMemo(() => resolveAssignmentContext({
    assignments: assignments ?? [],
    scope,
    branchId,
    documentType,
    usage,
  }), [assignments, branchId, documentType, scope, usage]);
  const t = useTranslations('printTemplateAssignments');

  const assignmentRevisionLabel = (assignment: Assignment | null) => assignment?.revision
    ? t('revision', { version: assignment.revision.version })
    : t('resolution_none');

  async function load() {
    const [assignmentResponse, branchResponse] = await Promise.all([
      api<{ data: Assignment[] }>('/print-templates/assignments'),
      api<{ data: Branch[] }>('/branches'),
    ]);
    setAssignments(assignmentResponse.data);
    setBranches(branchResponse.data);
  }

  useEffect(() => {
    load().catch((reason) => {
      error(reason instanceof ApiError ? reason.message : t('load_failed'));
      setAssignments([]);
    });
  // يحمّل النطاقات مرة واحدة؛ تغيير القالب لا يغيّر قائمة المؤسسة أو التعيينات.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const nextType = supportedTypes[0] ?? 'tax_invoice';
    setDocumentType(nextType);
  }, [template.id, revision?.id, supportedTypes]);

  async function saveAssignment(event: React.FormEvent) {
    event.preventDefault();
    if (!canManage || !revision || (scope === 'branch' && !branchId)) return;

    setSaving(true);
    try {
      await api('/print-templates/assignments/default', {
        method: 'PUT',
        body: buildPrintTemplateAssignmentPayload({
          scope,
          branchId,
          documentType,
          usage,
          revisionId: revision.id,
        }),
      });
      await load();
      success(t('saved'));
    } catch (reason) {
      error(reason instanceof ApiError ? reason.message : t('save_failed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 border-b border-border">
        <div>
          <CardTitle className="flex items-center gap-2 text-sm">
            <SlidersHorizontal className="h-4 w-4 text-primary" aria-hidden="true" />
            {t('title')}
          </CardTitle>
          <p className="mt-1 text-xs leading-relaxed text-muted">{t('description')}</p>
        </div>
        <Badge tone="muted">{assignments?.length ?? 0}</Badge>
      </CardHeader>
      <CardContent className="space-y-5 p-4">
        {assignments === null ? (
          <Skeleton className="h-40 w-full" />
        ) : assignments.length === 0 ? (
          <p className="rounded border border-dashed border-border bg-surface px-3 py-4 text-sm text-muted">{t('empty')}</p>
        ) : (
          <div className="overflow-x-auto rounded border border-border">
            <table className="min-w-full text-right text-xs">
              <thead className="bg-surface text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">{t('column_scope')}</th>
                  <th className="px-3 py-2 font-medium">{t('column_type')}</th>
                  <th className="px-3 py-2 font-medium">{t('column_usage')}</th>
                  <th className="px-3 py-2 font-medium">{t('column_revision')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {assignments.map((assignment) => {
                  const branch = branches.find((item) => item.id === assignment.branch_id);
                  return (
                    <tr key={assignment.id}>
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-1.5 whitespace-nowrap text-text">
                          {assignment.scope === 'company' ? <Building2 className="h-3.5 w-3.5 text-muted" aria-hidden="true" /> : <GitBranch className="h-3.5 w-3.5 text-muted" aria-hidden="true" />}
                          {assignment.scope === 'company' ? t('scope_company') : branch ? `${branch.name} (${branch.code})` : t('branch_unavailable')}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-text">{t(`type_${assignment.document_type}`)}</td>
                      <td className="px-3 py-2 text-muted">{t(`usage_${assignment.usage}`)}</td>
                      <td className="px-3 py-2 text-muted">{assignment.revision ? t('revision', { version: assignment.revision.version }) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <form onSubmit={saveAssignment} className="space-y-4 border-t border-border pt-4">
          <div>
            <h3 className="text-sm font-medium text-text">{t('form_title')}</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted">{t('form_description')}</p>
          </div>

          {!revision ? (
            <p className="rounded border border-warning/30 bg-warning/10 px-3 py-3 text-xs leading-relaxed text-text">{t('publish_required')}</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="assignment-scope">{t('scope')}</Label>
                  <Select id="assignment-scope" value={scope} disabled={!canManage || saving} onChange={(event) => setScope(event.target.value as AssignmentScope)}>
                    <option value="company">{t('scope_company')}</option>
                    <option value="branch">{t('scope_branch')}</option>
                  </Select>
                  <p className="text-xs leading-relaxed text-muted">{scope === 'company' ? t('scope_company_hint') : t('scope_branch_hint')}</p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="assignment-branch">{t('branch')}</Label>
                  <Select id="assignment-branch" value={branchId} disabled={!canManage || saving || scope !== 'branch'} onChange={(event) => setBranchId(event.target.value)}>
                    <option value="">{t('select_branch')}</option>
                    {activeBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name} ({branch.code}){branch.is_main ? ` — ${t('main_branch')}` : ''}</option>)}
                  </Select>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="assignment-document-type">{t('document_type')}</Label>
                  <Select id="assignment-document-type" value={documentType} disabled={!canManage || saving} onChange={(event) => setDocumentType(event.target.value as DocumentTypeId)}>
                    {supportedTypes.map((type) => <option key={type} value={type}>{t(`type_${type}`)}</option>)}
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="assignment-usage">{t('usage')}</Label>
                  <Select id="assignment-usage" value={usage} disabled={!canManage || saving} onChange={(event) => setUsage(event.target.value as AssignmentUsage)}>
                    {ASSIGNMENT_USAGES.map((item) => <option key={item} value={item}>{t(`usage_${item}`)}</option>)}
                  </Select>
                </div>
              </div>

              <section aria-live="polite" className="space-y-3 rounded border border-border bg-surface p-3">
                <div>
                  <h4 className="text-sm font-medium text-text">{t('resolution_title')}</h4>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{t('resolution_description')}</p>
                </div>

                {scope === 'branch' && !branchId ? (
                  <p className="rounded border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-text">{t('resolution_select_branch')}</p>
                ) : (
                  <dl className="grid gap-3 text-xs sm:grid-cols-2">
                    <div className="space-y-1 rounded border border-border bg-background px-3 py-2">
                      <dt className="text-muted">{t('resolution_effective')}</dt>
                      <dd className="font-medium text-text">{assignmentRevisionLabel(assignmentContext.effective as Assignment | null)}</dd>
                      <dd className="text-muted">{assignmentContext.effective ? (assignmentContext.effective.branch_id === null ? t('scope_company') : t('resolution_branch_override')) : t('resolution_default_output')}</dd>
                    </div>
                    <div className="space-y-1 rounded border border-border bg-background px-3 py-2">
                      <dt className="text-muted">{t('resolution_save_effect')}</dt>
                      <dd className="font-medium text-text">
                        {assignmentContext.target
                          ? assignmentContext.target.print_template_revision_id === revision.id
                            ? t('resolution_already_selected')
                            : t('resolution_replace', { revision: assignmentRevisionLabel(assignmentContext.target as Assignment) })
                          : scope === 'company'
                            ? t('resolution_create_company')
                            : t('resolution_create_branch')}
                      </dd>
                    </div>
                  </dl>
                )}

                {scope === 'branch' && branchId && assignmentContext.target === null && assignmentContext.companyFallback ? (
                  <p className="text-xs leading-relaxed text-muted">{t('resolution_fallback', { revision: assignmentRevisionLabel(assignmentContext.companyFallback as Assignment) })}</p>
                ) : null}

                <p className="rounded bg-background px-3 py-2 text-xs text-muted">
                  {t('revision_hint', { version: revision.version, name: template.name })}
                </p>
              </section>

              <div className="flex justify-end">
                <Button type="submit" disabled={!canManage || saving || (scope === 'branch' && !branchId)}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                  {saving ? t('saving') : t('save')}
                </Button>
              </div>
            </>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

