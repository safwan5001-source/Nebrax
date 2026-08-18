'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, FileClock, FilePlus2, Files, GitCompareArrows, GitFork, Search, SlidersHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { DocumentScaler } from '@/modules/documents/components/document-scaler';
import { DocumentView } from '@/modules/documents/components/document-view';
import { getDocumentPreviewModel } from '@/modules/documents/registry/document-samples';
import type { DocSectionLayoutItem, DocumentTypeId, ThemeId } from '@/modules/documents/types';
import { ASSIGNMENT_DOCUMENT_TYPES, ASSIGNMENT_USAGES, type AssignmentUsage } from './print-template-assignment-contract';
import type { TemplateCenterLoadState } from '../template-center-state';
import {
  assignmentsForTemplate,
  filterTemplateLibrary,
  templateFamilyForDocumentType,
  type TemplateLibraryAssignment,
  type TemplateLibraryAssignmentScope,
  type TemplateLibraryFilters,
  type TemplateLibraryRevision,
  type TemplateLibraryRevisionStatus,
  type TemplateLibraryTemplate,
  type TemplateLibraryUsage,
} from '../template-library-state';
import { TEMPLATE_CENTER_FAMILIES, type TemplateCenterFamilyId } from '../template-center-catalog';

interface LibraryRevision extends TemplateLibraryRevision {
  definition?: {
    template_id?: string;
    theme_id?: ThemeId;
    show_logo?: boolean;
    layout?: DocSectionLayoutItem[];
    footer_text?: string;
  };
}

export interface PrintTemplateLibraryTemplate extends Omit<TemplateLibraryTemplate, 'draft_revision' | 'published_revision'> {
  draft_revision?: LibraryRevision | null;
  published_revision?: LibraryRevision | null;
}

interface Branch {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
}

interface PrintTemplateLibraryProps {
  templates: readonly PrintTemplateLibraryTemplate[];
  loadState: TemplateCenterLoadState;
  initialDocumentType: DocumentTypeId;
  canManage: boolean;
  onBack: () => void;
  onOpenTemplate: (templateId: string, documentType: DocumentTypeId) => void;
  onReviewAssignments: (templateId: string, documentType: DocumentTypeId) => void;
  onCompareRevisions: (templateId: string, documentType: DocumentTypeId) => void;
  onCreateDraftFromPublished: (templateId: string, documentType: DocumentTypeId) => void;
  onCreateTemplate: (documentType: DocumentTypeId) => void;
}

const DEFAULT_FILTERS: Omit<TemplateLibraryFilters, 'family' | 'documentType'> = {
  query: '',
  revisionStatus: 'all',
  usage: 'all',
  assignmentScope: 'all',
};

function activeRevision(template: PrintTemplateLibraryTemplate): LibraryRevision | null {
  return template.draft_revision ?? template.published_revision ?? null;
}

function templateDocumentTypes(template: PrintTemplateLibraryTemplate): DocumentTypeId[] {
  return template.draft_revision?.document_types
    ?? template.published_revision?.document_types
    ?? template.document_types;
}

/**
 * مكتبة P43: تفصل اختيار القالب عن الاستوديو كي يرى المستخدم المسودة والمنشور
 * والتعيين قبل التعديل. لا تنشئ مراجعة أو تعييناً تلقائياً.
 */
export function PrintTemplateLibrary({
  templates,
  loadState,
  initialDocumentType,
  canManage,
  onBack,
  onOpenTemplate,
  onReviewAssignments,
  onCompareRevisions,
  onCreateDraftFromPublished,
  onCreateTemplate,
}: PrintTemplateLibraryProps) {
  const locale = useLocale();
  const t = useTranslations('printTemplateStudio');
  const tTypes = useTranslations('documentTypes');
  const tAssignments = useTranslations('printTemplateAssignments');
  const [filters, setFilters] = useState<TemplateLibraryFilters>(() => ({
    ...DEFAULT_FILTERS,
    family: templateFamilyForDocumentType(initialDocumentType) ?? 'all',
    documentType: initialDocumentType,
  }));
  const [assignments, setAssignments] = useState<TemplateLibraryAssignment[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [assignmentState, setAssignmentState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    setFilters((current) => ({
      ...current,
      family: templateFamilyForDocumentType(initialDocumentType) ?? 'all',
      documentType: initialDocumentType,
    }));
  }, [initialDocumentType]);

  useEffect(() => {
    if (loadState !== 'ready' && loadState !== 'empty') return;

    let active = true;
    setAssignmentState('loading');
    Promise.all([
      api<{ data: TemplateLibraryAssignment[] }>('/print-templates/assignments'),
      api<{ data: Branch[] }>('/branches'),
    ]).then(([assignmentResponse, branchResponse]) => {
      if (!active) return;
      setAssignments(assignmentResponse.data);
      setBranches(branchResponse.data.filter((branch) => branch.is_active));
      setAssignmentState('ready');
    }).catch(() => {
      if (!active) return;
      setAssignments([]);
      setBranches([]);
      setAssignmentState('error');
    });

    return () => { active = false; };
  }, [loadState]);

  const filteredTemplates = useMemo(() => filterTemplateLibrary(
    templates,
    assignments,
    filters,
    (type) => tTypes(type),
  ), [assignments, filters, tTypes, templates]);

  const familyTypes = filters.family === 'all'
    ? ASSIGNMENT_DOCUMENT_TYPES
    : TEMPLATE_CENTER_FAMILIES.find((family) => family.id === filters.family)?.documentTypes ?? [];
  const initialFamily = templateFamilyForDocumentType(initialDocumentType);
  const libraryContext = initialFamily ? t(`center_family_${initialFamily}_title`) : tTypes(initialDocumentType);
  const showAssignmentContextWarning = assignmentState === 'error' && (filters.usage !== 'all' || filters.assignmentScope !== 'all');
  const selectedDocumentType = filters.documentType === 'all' ? null : filters.documentType;
  const formatDate = (value: string | null | undefined) => value
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(value))
    : '—';

  const updateFilters = (changes: Partial<TemplateLibraryFilters>) => {
    setFilters((current) => ({ ...current, ...changes }));
  };

  const changeFamily = (family: TemplateCenterFamilyId | 'all') => {
    const nextTypes = family === 'all'
      ? ASSIGNMENT_DOCUMENT_TYPES
      : TEMPLATE_CENTER_FAMILIES.find((item) => item.id === family)?.documentTypes ?? [];
    updateFilters({
      family,
      documentType: nextTypes.includes(filters.documentType as DocumentTypeId) ? filters.documentType : 'all',
    });
  };

  if (loadState === 'loading') {
    return <LibrarySkeleton />;
  }

  return (
    <div className="space-y-5" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" className="-ms-2 mb-2" onClick={onBack}>{t('library_back')}</Button>
          <p className="text-xs font-medium text-primary">{t('library_context', { scope: libraryContext })}</p>
          <h1 className="mt-1 text-2xl font-semibold text-text">{t('library_title')}</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">{t('library_subtitle')}</p>
        </div>
        {canManage && <Button onClick={() => onCreateTemplate(filters.documentType === 'all' ? initialDocumentType : filters.documentType)}><FilePlus2 className="h-4 w-4" aria-hidden="true" />{t('library_new_template')}</Button>}
      </div>

      <Card>
        <CardHeader className="border-b border-border py-3">
          <CardTitle className="flex items-center gap-2 text-sm"><SlidersHorizontal className="h-4 w-4 text-primary" aria-hidden="true" />{t('library_filters')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-5">
          <div className="space-y-1.5 sm:col-span-2 xl:col-span-1">
            <Label htmlFor="template-library-search">{t('library_search_label')}</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
              <Input id="template-library-search" value={filters.query} onChange={(event) => updateFilters({ query: event.target.value })} className="ps-9" placeholder={t('library_search_placeholder')} />
            </div>
          </div>
          <FilterSelect id="template-library-family" label={t('library_family')} value={filters.family} onChange={(event) => changeFamily(event.target.value as TemplateCenterFamilyId | 'all')}>
            <option value="all">{t('library_all_families')}</option>
            {TEMPLATE_CENTER_FAMILIES.map((family) => <option key={family.id} value={family.id}>{t(`center_family_${family.id}_title`)}</option>)}
          </FilterSelect>
          <FilterSelect id="template-library-type" label={t('document_type')} value={filters.documentType} onChange={(event) => updateFilters({ documentType: event.target.value as DocumentTypeId | 'all' })}>
            <option value="all">{t('library_all_types')}</option>
            {familyTypes.map((type) => <option key={type} value={type}>{tTypes(type)}</option>)}
          </FilterSelect>
          <FilterSelect id="template-library-status" label={t('library_revision_status')} value={filters.revisionStatus} onChange={(event) => updateFilters({ revisionStatus: event.target.value as TemplateLibraryRevisionStatus })}>
            <option value="all">{t('library_all_statuses')}</option>
            <option value="draft">{t('library_status_draft')}</option>
            <option value="published">{t('library_status_published')}</option>
            <option value="unassigned">{t('library_status_unassigned')}</option>
          </FilterSelect>
          <FilterSelect id="template-library-usage" label={t('library_usage')} value={filters.usage} disabled={assignmentState !== 'ready'} onChange={(event) => updateFilters({ usage: event.target.value as TemplateLibraryUsage })}>
            <option value="all">{t('library_all_usages')}</option>
            {ASSIGNMENT_USAGES.map((usage) => <option key={usage} value={usage}>{tAssignments(`usage_${usage}`)}</option>)}
          </FilterSelect>
          <FilterSelect id="template-library-assignment-scope" label={t('library_assignment_scope')} value={filters.assignmentScope} disabled={assignmentState !== 'ready'} onChange={(event) => updateFilters({ assignmentScope: event.target.value as TemplateLibraryAssignmentScope })}>
            <option value="all">{t('library_all_scopes')}</option>
            <option value="company">{tAssignments('scope_company')}</option>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name} ({branch.code})</option>)}
          </FilterSelect>
        </CardContent>
      </Card>

      {showAssignmentContextWarning && <p className="rounded border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-text">{t('library_assignment_context_failed')}</p>}

      <div className="flex items-center justify-between gap-3">
        <p role="status" aria-atomic="true" className="text-sm text-muted">{t('library_result_count', { count: filteredTemplates.length })}</p>
        {assignmentState === 'loading' && <p className="text-xs text-muted">{t('library_loading_assignments')}</p>}
      </div>

      {loadState === 'error' ? (
        <LibraryEmptyState title={t('library_load_failed_title')} hint={t('library_load_failed_hint')} />
      ) : filteredTemplates.length ? (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {filteredTemplates.map((template) => {
            const revision = activeRevision(template);
            const documentTypes = templateDocumentTypes(template);
            const previewType = filters.documentType !== 'all' && documentTypes.includes(filters.documentType)
              ? filters.documentType
              : documentTypes[0] ?? initialDocumentType;
            const templateAssignments = assignmentsForTemplate(template, assignments);
            const hasDraft = template.draft_revision !== null && template.draft_revision !== undefined;
            const hasPublished = template.published_revision !== null && template.published_revision !== undefined;
            const isUnassigned = hasPublished && assignmentState === 'ready' && templateAssignments.length === 0;
            const definition = revision?.definition;
            const preview = getDocumentPreviewModel(previewType);
            const previewWithFooter = definition?.footer_text ? { ...preview, footerText: definition.footer_text } : preview;

            return (
              <Card key={template.id} className="overflow-hidden">
                <div className="h-44 overflow-hidden border-b border-border bg-background p-2" aria-hidden="true">
                  <DocumentScaler><DocumentView model={previewWithFooter} templateId={definition?.template_id ?? 'tax-invoice-classic'} themeId={definition?.theme_id ?? 'blue'} showLogo={definition?.show_logo ?? true} layout={definition?.layout} rootId={null} /></DocumentScaler>
                </div>
                <CardHeader className="space-y-3 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="truncate text-base">{template.name || t('preview_template_name')}</CardTitle>
                      <p className="mt-1 text-xs text-muted">{t('library_updated_at', { date: formatDate(template.updated_at) })}</p>
                    </div>
                    <Badge tone={hasDraft ? 'warning' : hasPublished ? 'positive' : 'muted'}>{hasDraft ? t('library_status_draft') : hasPublished ? t('library_status_published') : t('library_status_unassigned')}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {documentTypes.map((type) => <Badge key={type} tone="muted">{tTypes(type)}</Badge>)}
                    {revision && <Badge tone="neutral">{t('revision', { version: revision.version })}</Badge>}
                    {hasPublished && assignmentState === 'ready' && (isUnassigned ? <Badge tone="warning">{t('library_badge_unassigned')}</Badge> : <Badge tone="positive"><Check className="h-3 w-3" aria-hidden="true" />{t('library_badge_assigned', { count: templateAssignments.length })}</Badge>)}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                  <p className="text-xs leading-relaxed text-muted">{hasDraft && hasPublished ? t('library_draft_over_published') : hasDraft ? t('library_draft_hint') : t('library_published_hint')}</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {hasDraft ? (
                      <Button size="sm" onClick={() => onOpenTemplate(template.id, previewType)}><Files className="h-4 w-4" aria-hidden="true" />{t('library_open_draft')}</Button>
                    ) : canManage && hasPublished ? (
                      <Button size="sm" onClick={() => onCreateDraftFromPublished(template.id, previewType)}><FilePlus2 className="h-4 w-4" aria-hidden="true" />{t('library_create_draft')}</Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => onOpenTemplate(template.id, previewType)}><FileClock className="h-4 w-4" aria-hidden="true" />{t('library_review_published')}</Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => onReviewAssignments(template.id, previewType)}><GitFork className="h-4 w-4" aria-hidden="true" />{t('library_review_assignments')}</Button>
                    {hasDraft && hasPublished && <Button size="sm" variant="ghost" className="sm:col-span-2" onClick={() => onCompareRevisions(template.id, previewType)}><GitCompareArrows className="h-4 w-4" aria-hidden="true" />{t('library_compare_revisions')}</Button>}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <LibraryEmptyState
          title={t('library_empty_title', { type: filters.documentType === 'all' ? t('library_all_types') : tTypes(filters.documentType) })}
          hint={t('library_empty_hint')}
          action={canManage && selectedDocumentType ? <Button onClick={() => onCreateTemplate(selectedDocumentType)}><FilePlus2 className="h-4 w-4" aria-hidden="true" />{t('library_start_template')}</Button> : undefined}
        />
      )}
    </div>
  );
}

function FilterSelect({ id, label, value, onChange, children, disabled = false }: {
  id: string;
  label: string;
  value: string;
  onChange: React.ChangeEventHandler<HTMLSelectElement>;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select id={id} value={value} onChange={onChange} disabled={disabled}>{children}</Select>
    </div>
  );
}

function LibraryEmptyState({ title, hint, action }: { title: string; hint: string; action?: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex min-h-52 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="font-medium text-text">{title}</p>
        <p className="max-w-md text-sm leading-relaxed text-muted">{hint}</p>
        {action}
      </CardContent>
    </Card>
  );
}

function LibrarySkeleton() {
  return (
    <div className="space-y-5" aria-busy="true">
      <div className="space-y-2"><Skeleton className="h-4 w-28" /><Skeleton className="h-8 w-64" /><Skeleton className="h-4 w-full max-w-xl" /></div>
      <Skeleton className="h-44 w-full" />
      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-96 w-full" />)}</div>
    </div>
  );
}
