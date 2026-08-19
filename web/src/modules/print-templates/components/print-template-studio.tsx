'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, Copy, Eye, FilePlus2, GitBranch, Layers3, Loader2, Save, Send, Settings2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { TabPanel, Tabs, type TabDef } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { SectionDesigner } from '@/components/settings/section-designer';
import { PrintTemplateAssignments } from './print-template-assignments';
import { PrintTemplateCenter } from './print-template-center';
import { PrintTemplateLibrary } from './print-template-library';
import { PrintTemplateCreationWizard, type TemplateCreationSubmission } from './print-template-creation-wizard';
import {
  templateStudioValidationIssues,
  type TemplateStudioWorkspace,
} from '../template-studio-validation';
import {
  canOpenTemplateCenterDocumentType,
  documentTypesForDraftSave,
  resolveActiveDocumentType,
  type TemplateCenterLoadState,
  validateLayoutForDocumentTypes,
} from '../template-center-state';
import { BlockPropertiesEditor } from './block-properties-editor';
import { TemplateRevisionHistory } from './template-revision-history';
import { ApiError, api } from '@/lib/api';
import { DocumentScaler } from '@/modules/documents/components/document-scaler';
import { DocumentView } from '@/modules/documents/components/document-view';
import { getDocumentPreviewModel } from '@/modules/documents/registry/document-samples';
import {
  getDefaultDocumentLayout,
  getDocumentTypeDefinition,
} from '@/modules/documents/registry/document-types';
import { listTemplates } from '@/modules/documents/registry/templates';
import { THEME_IDS } from '@/modules/documents/themes';
import type { DocSectionKey, DocSectionLayoutItem, DocumentTypeId, ThemeId } from '@/modules/documents/types';

interface TemplateDefinition {
  template_id?: string;
  theme_id?: ThemeId;
  show_logo?: boolean;
  layout?: DocSectionLayoutItem[];
  footer_text?: string;
}

interface Revision {
  id: string;
  version: number;
  status: 'draft' | 'published' | 'superseded';
  document_types: DocumentTypeId[];
  definition: TemplateDefinition;
  published_at?: string | null;
  created_at?: string | null;
}

interface PrintTemplate {
  id: string;
  name: string;
  status: 'draft' | 'published' | 'archived';
  source: 'custom' | 'migrated';
  document_types: DocumentTypeId[];
  published_revision?: Revision | null;
  draft_revision?: Revision | null;
  revisions?: Revision[];
}

const FALLBACK: PrintTemplate = {
  id: 'local-preview',
  name: '',
  status: 'draft',
  source: 'custom',
  document_types: ['tax_invoice'],
  draft_revision: {
    id: 'local-preview-r1',
    version: 1,
    status: 'draft',
    document_types: ['tax_invoice'],
    definition: {
      template_id: 'tax-invoice-classic',
      theme_id: 'blue',
      show_logo: true,
      layout: getDefaultDocumentLayout('tax_invoice'),
    },
  },
};

function activeRevision(template: PrintTemplate): Revision {
  return template.draft_revision ?? template.published_revision ?? FALLBACK.draft_revision!;
}

function normalizeDefinition(revision: Revision, type: DocumentTypeId): Required<TemplateDefinition> {
  const definition = revision.definition ?? {};
  return {
    template_id: definition.template_id ?? 'tax-invoice-classic',
    theme_id: definition.theme_id ?? 'blue',
    show_logo: definition.show_logo ?? true,
    layout: definition.layout ?? getDefaultDocumentLayout(type),
    footer_text: definition.footer_text ?? '',
  };
}

/**
 * مكتبة القوالب ومحرر كتله. يحافظ المحرر على صدق الواجهة: لا يسمح بإخفاء كتلة
 * مطلوبة أو إضافة كتلة خارج عقد نوع المستند، ويعيد الخادم التحقق نفسه عند الحفظ
 * والنشر لحماية المراجعات المنشورة من عميل متجاوز أو رحلة API قديمة.
 */
export function PrintTemplateStudio({ canManage }: { canManage: boolean }) {
  const { success, error } = useToast();
  const locale = useLocale();
  const t = useTranslations('printTemplateStudio');
  const tTypes = useTranslations('documentTypes');
  const tTemplates = useTranslations('invoiceTemplates');
  const tSections = useTranslations('documentSections');
  const [templates, setTemplates] = useState<PrintTemplate[]>([]);
  const [selectedId, setSelectedId] = useState(FALLBACK.id);
  const [activeDocumentType, setActiveDocumentType] = useState<DocumentTypeId | null>(null);
  const [templateLoadState, setTemplateLoadState] = useState<TemplateCenterLoadState>('loading');
  const [saving, setSaving] = useState(false);
  const [surface, setSurface] = useState<'center' | 'library' | 'creation' | 'studio'>('center');
  const [templateDetails, setTemplateDetails] = useState<Record<string, PrintTemplate>>({});
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsFailed, setDetailsFailed] = useState(false);
  const [studioFocus, setStudioFocus] = useState<'none' | 'history' | 'assignments'>('none');
  const [workspace, setWorkspace] = useState<TemplateStudioWorkspace>('preview');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [validationRequested, setValidationRequested] = useState(false);
  const [validationFocusTarget, setValidationFocusTarget] = useState<Extract<TemplateStudioWorkspace, 'structure' | 'properties'> | null>(null);

  const loadTemplates = useCallback(async () => {
    setTemplateLoadState('loading');
    try {
      const response = await api<{ data: PrintTemplate[] }>('/print-templates');
      setTemplates(response.data);
      setSelectedId(response.data[0]?.id ?? FALLBACK.id);
      setActiveDocumentType(null);
      setTemplateLoadState(response.data.length ? 'ready' : 'empty');
    } catch {
      setTemplates([]);
      setSelectedId(FALLBACK.id);
      setActiveDocumentType(null);
      setTemplateLoadState('error');
    }
  }, []);

  useEffect(() => { void loadTemplates(); }, [loadTemplates]);

  const selected = templates.find((template) => template.id === selectedId) ?? templates[0] ?? FALLBACK;
  const detailedSelected = templateDetails[selected.id] ?? selected;
  const revision = activeRevision(selected);
  const documentTypes = documentTypesForDraftSave(revision.document_types, selected.document_types);
  const type = resolveActiveDocumentType(documentTypes, activeDocumentType);
  const documentType = getDocumentTypeDefinition(type);
  const definition = useMemo(() => normalizeDefinition(revision, type), [revision, type]);
  const layoutValidation = useMemo(
    () => validateLayoutForDocumentTypes(documentTypes, definition.layout),
    [definition.layout, documentTypes],
  );
  const validationIssues = useMemo(
    () => templateStudioValidationIssues(layoutValidation.errors),
    [layoutValidation.errors],
  );
  const preview = useMemo(() => {
    const model = getDocumentPreviewModel(type);
    return definition.footer_text ? { ...model, footerText: definition.footer_text } : model;
  }, [definition.footer_text, type]);
  const isPublishedOnly = selected.published_revision != null && selected.draft_revision == null;
  const editorReadOnly = !canManage || isPublishedOnly;
  const workspaceTabs: TabDef[] = [
    { id: 'structure', label: t('workspace_structure'), count: validationIssues.filter((issue) => issue.target === 'structure').length || undefined },
    { id: 'properties', label: t('workspace_properties'), count: validationIssues.filter((issue) => issue.target === 'properties').length || undefined },
    { id: 'preview', label: t('workspace_preview') },
    { id: 'governance', label: t('workspace_governance') },
  ];

  const revealValidation = (target = validationIssues[0]?.target ?? 'structure') => {
    setWorkspace(target);
    setValidationFocusTarget(target);
    setValidationRequested(true);
  };

  useEffect(() => {
    if (layoutValidation.valid) {
      setValidationRequested(false);
      setValidationFocusTarget(null);
    }
  }, [layoutValidation.valid]);

  useEffect(() => {
    if (!validationRequested || validationFocusTarget === null) return;
    const target = validationFocusTarget === 'properties'
      ? 'template-properties-panel'
      : 'template-structure-panel';
    const frame = requestAnimationFrame(() => document.getElementById(target)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [validationFocusTarget, validationRequested, workspace]);

  const patch = (changes: Partial<PrintTemplate>, definitionChanges?: Partial<TemplateDefinition>) => {
    setLastSavedAt(null);
    setTemplates((current) => current.map((template) => {
      if (template.id !== selected.id) return template;
      const currentRevision = activeRevision(template);
      const nextDefinition = { ...currentRevision.definition, ...definitionChanges };
      const nextRevision = {
        ...currentRevision,
        document_types: changes.document_types ?? currentRevision.document_types,
        definition: nextDefinition,
      };
      return { ...template, ...changes, draft_revision: nextRevision };
    }));
  };

  function startTemplateCreation(documentType: DocumentTypeId = type) {
    if (!canManage) return;
    setActiveDocumentType(documentType);
    setSurface('creation');
  }

  function createTemplate() {
    startTemplateCreation(type);
  }

  function openDocumentType(documentType: DocumentTypeId) {
    if (!canOpenTemplateCenterDocumentType(templateLoadState)) return;
    setActiveDocumentType(documentType);
    setSurface('library');
  }

  function openTemplateFromLibrary(
    templateId: string,
    documentType: DocumentTypeId,
    focus: 'none' | 'history' | 'assignments' = 'none',
  ) {
    setSelectedId(templateId);
    setActiveDocumentType(documentType);
    if (focus !== 'none') setWorkspace('governance');
    setStudioFocus(focus);
    setSurface('studio');
  }

  function createTemplateFromLibrary(documentType: DocumentTypeId) {
    startTemplateCreation(documentType);
  }

  async function createTemplateFromWizard(submission: TemplateCreationSubmission) {
    if (!canManage) return;
    setSaving(true);
    try {
      const response = submission.source.kind === 'base'
        ? await api<{ data: PrintTemplate }>('/print-templates', {
          method: 'POST',
          body: {
            name: submission.name,
            document_types: [submission.documentType],
            definition: {
              ...FALLBACK.draft_revision!.definition,
              layout: getDefaultDocumentLayout(submission.documentType),
            },
          },
        })
        : await api<{ data: PrintTemplate }>(`/print-templates/${submission.source.templateId}/duplicate`, {
          method: 'POST',
          body: { name: submission.name },
        });
      setTemplates((current) => [response.data, ...current]);
      setSelectedId(response.data.id);
      setActiveDocumentType(submission.documentType);
      setTemplateLoadState('ready');
      setSurface('studio');
      void loadTemplateDetails(response.data.id);
      success(t('creation_draft_created'));
    } catch (caught) {
      error(caught instanceof ApiError ? caught.message : t('creation_failed'));
      throw caught;
    } finally {
      setSaving(false);
    }
  }

  async function createDraftFromPublished(templateId: string, documentType: DocumentTypeId) {
    if (!canManage) return;
    const template = templates.find((item) => item.id === templateId);
    const revision = template?.published_revision;
    if (!template || !revision) return;

    setSaving(true);
    try {
      const documentTypes = documentTypesForDraftSave(revision.document_types, template.document_types);
      const definition = normalizeDefinition(revision, documentType);
      const response = await api<{ data: PrintTemplate }>(`/print-templates/${template.id}/draft`, {
        method: 'PUT',
        body: { name: template.name, document_types: documentTypes, definition },
      });
      setTemplates((current) => current.map((item) => item.id === template.id ? response.data : item));
      setSelectedId(response.data.id);
      setActiveDocumentType(documentType);
      setSurface('studio');
      void loadTemplateDetails(response.data.id);
      success(t('library_draft_created'));
    } catch (caught) {
      error(caught instanceof ApiError ? caught.message : t('library_draft_create_failed'));
    } finally {
      setSaving(false);
    }
  }

  async function saveDraft() {
    if (!canManage) return;
    if (!layoutValidation.valid) {
      revealValidation();
      error(t('layout_invalid'));
      return;
    }

    setSaving(true);
    try {
      const body = { name: selected.name, document_types: documentTypes, definition };
      if (selected.id === FALLBACK.id || selected.id.startsWith('new-')) {
        const response = await api<{ data: PrintTemplate }>('/print-templates', { method: 'POST', body });
        setTemplates((current) => current.map((template) => template.id === selected.id ? response.data : template));
        setSelectedId(response.data.id);
        void loadTemplateDetails(response.data.id);
      } else {
        const response = await api<{ data: PrintTemplate }>(`/print-templates/${selected.id}/draft`, { method: 'PUT', body });
        setTemplates((current) => current.map((template) => template.id === selected.id ? response.data : template));
        void loadTemplateDetails(response.data.id);
      }
      setLastSavedAt(new Date().toISOString());
      success(t('saved'));
    } catch (caught) {
      error(caught instanceof ApiError ? caught.message : t('save_failed'));
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!canManage || selected.id === FALLBACK.id || selected.id.startsWith('new-')) {
      error(t('publish_first'));
      return;
    }
    if (!layoutValidation.valid) {
      revealValidation();
      error(t('layout_invalid'));
      return;
    }

    setSaving(true);
    try {
      const response = await api<{ data: PrintTemplate }>(`/print-templates/${selected.id}/publish`, { method: 'POST' });
      setTemplates((current) => current.map((template) => template.id === selected.id ? response.data : template));
      void loadTemplateDetails(response.data.id);
      setLastSavedAt(new Date().toISOString());
      success(t('published_success'));
    } catch {
      error(t('publish_failed'));
    } finally {
      setSaving(false);
    }
  }

  async function duplicate() {
    if (!canManage || selected.id === FALLBACK.id || selected.id.startsWith('new-')) return createTemplate();
    setSaving(true);
    try {
      const response = await api<{ data: PrintTemplate }>(`/print-templates/${selected.id}/duplicate`, {
        method: 'POST', body: { name: `${selected.name} — ${t('copy_suffix')}` },
      });
      setTemplates((current) => [response.data, ...current]);
      setSelectedId(response.data.id);
      success(t('copied'));
    } catch {
      error(t('copy_failed'));
    } finally {
      setSaving(false);
    }
  }

  async function loadTemplateDetails(templateId: string) {
    if (templateId === FALLBACK.id || templateId.startsWith('new-')) {
      setDetailsFailed(false);
      setDetailsLoading(false);
      return;
    }

    setDetailsLoading(true);
    setDetailsFailed(false);
    try {
      const response = await api<{ data: PrintTemplate }>(`/print-templates/${templateId}`);
      setTemplateDetails((current) => ({ ...current, [templateId]: response.data }));
    } catch {
      setDetailsFailed(true);
    } finally {
      setDetailsLoading(false);
    }
  }

  useEffect(() => { void loadTemplateDetails(selected.id); }, [selected.id]);
  useEffect(() => { setLastSavedAt(null); }, [selected.id]);

  useEffect(() => {
    if (surface !== 'studio' || studioFocus === 'none') return;
    const targetId = studioFocus === 'history' ? 'template-revision-history' : 'template-assignments';
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(targetId);
      target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      target?.focus({ preventScroll: true });
      setStudioFocus('none');
    });
    return () => cancelAnimationFrame(frame);
  }, [selected.id, studioFocus, surface]);

  const templatesCatalog = listTemplates();
  const selectedName = selected.name || t('preview_template_name');
  const savedAt = lastSavedAt ?? revision.published_at ?? revision.created_at ?? null;
  const lastSaveLabel = savedAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(savedAt))
    : t('workspace_no_save_time');
  const validationLabel = (issue: (typeof validationIssues)[number]) => {
    const section = issue.section ? tSections(issue.section) : t('validation_layout');
    if (issue.kind === 'required') return t('validation_required_block', { section });
    if (issue.kind === 'property') return t('validation_property_block', { section });
    return t('validation_layout_block', { section });
  };

  if (surface === 'center') {
    return (
      <div dir={locale === 'ar' ? 'rtl' : 'ltr'}>
        <PrintTemplateCenter
          templates={templates}
          loadState={templateLoadState}
          onOpenDocumentType={openDocumentType}
          onRetry={() => void loadTemplates()}
        />
      </div>
    );
  }

  if (surface === 'creation') {
    return (
      <PrintTemplateCreationWizard
        templates={templates}
        initialDocumentType={activeDocumentType ?? type}
        canManage={canManage}
        onCancel={() => setSurface('library')}
        onSubmit={createTemplateFromWizard}
      />
    );
  }

  if (surface === 'library') {
    return (
      <PrintTemplateLibrary
        templates={templates}
        loadState={templateLoadState}
        initialDocumentType={activeDocumentType ?? 'tax_invoice'}
        canManage={canManage}
        onBack={() => setSurface('center')}
        onOpenTemplate={openTemplateFromLibrary}
        onReviewAssignments={(templateId, documentType) => openTemplateFromLibrary(templateId, documentType, 'assignments')}
        onCompareRevisions={(templateId, documentType) => openTemplateFromLibrary(templateId, documentType, 'history')}
        onCreateDraftFromPublished={(templateId, documentType) => void createDraftFromPublished(templateId, documentType)}
        onCreateTemplate={createTemplateFromLibrary}
      />
    );
  }

  return (
    <div className="space-y-4" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <header className="rounded-xl border border-border bg-surface p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <Button variant="ghost" size="sm" className="-ms-2 mb-2" onClick={() => setSurface('library')}>
              {locale === 'ar' ? <ChevronRight className="h-4 w-4" aria-hidden="true" /> : <ChevronLeft className="h-4 w-4" aria-hidden="true" />}
              {t('back_to_library')}
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold text-text">{selectedName}</h1>
              <Badge tone={isPublishedOnly ? 'positive' : 'warning'}>{isPublishedOnly ? t('library_status_published') : t('library_status_draft')}</Badge>
              <Badge tone="neutral">{t('revision', { version: revision.version })}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted">{t('workspace_last_saved', { date: lastSaveLabel })}</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {canManage && <Button variant="outline" onClick={createTemplate}><FilePlus2 className="h-4 w-4" aria-hidden="true" />{t('new_template')}</Button>}
            {canManage && (isPublishedOnly ? (
              <Button onClick={() => void createDraftFromPublished(selected.id, type)} disabled={saving}><FilePlus2 className="h-4 w-4" aria-hidden="true" />{t('library_create_draft')}</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => void duplicate()} disabled={saving}><Copy className="h-4 w-4" aria-hidden="true" />{t('copy')}</Button>
                <Button onClick={() => void saveDraft()} disabled={saving || !layoutValidation.valid} aria-describedby={!layoutValidation.valid ? 'template-validation-action-hint' : undefined}>{saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}{t('save_draft')}</Button>
                <Button variant="primary" onClick={() => void publish()} disabled={saving || !layoutValidation.valid} aria-describedby={!layoutValidation.valid ? 'template-validation-action-hint' : undefined}><Send className="h-4 w-4" aria-hidden="true" />{t('publish_revision', { version: revision.version })}</Button>
              </>
            ))}
          </div>
        </div>
        {!layoutValidation.valid && <div id="template-validation-action-hint" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-text"><span>{t('workspace_publish_blocked')}</span><Button size="sm" variant="ghost" onClick={() => revealValidation()}>{t('workspace_review_issues')}</Button></div>}
      </header>

      {validationRequested && validationIssues.length > 0 && <section id="template-validation-summary" tabIndex={-1} role="alert" className="rounded-xl border border-danger/30 bg-danger/10 p-4 focus:outline-none"><h2 className="text-sm font-semibold text-text">{t('validation_summary_title')}</h2><p className="mt-1 text-sm text-muted">{t('validation_summary_hint')}</p><div className="mt-3 flex flex-wrap gap-2">{validationIssues.map((issue, index) => <Button key={`${issue.code}-${index}`} size="sm" variant="outline" onClick={() => revealValidation(issue.target)}>{validationLabel(issue)}</Button>)}</div></section>}

      <div className="grid gap-4 xl:grid-cols-[240px_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader className="border-b border-border py-3"><CardTitle className="text-sm">{t('library_label')}</CardTitle></CardHeader>
          <CardContent className="space-y-1 p-2">
            {templateLoadState === 'loading' ? <p className="p-3 text-sm text-muted">{t('loading')}</p> : templates.map((template) => (
              <button key={template.id} type="button" onClick={() => { setSelectedId(template.id); setActiveDocumentType(null); setWorkspace('preview'); }} aria-pressed={template.id === selected.id} className={`w-full rounded-lg p-3 text-start transition focus-visible:ring-2 focus-visible:ring-primary/40 ${template.id === selected.id ? 'bg-primary/10 text-primary' : 'hover:bg-surface'}`}>
                <span className="block truncate text-sm font-medium">{template.name || t('preview_template_name')}</span>
                <span className="mt-1 flex items-center justify-between text-[11px] text-muted"><span>{t('document_type_count', { count: template.document_types.length })}</span><span>{template.status === 'published' ? t('published') : t('draft')}</span></span>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <Tabs tabs={workspaceTabs} value={workspace} onChange={(id) => setWorkspace(id as TemplateStudioWorkspace)} />
          <CardContent className="p-4">
            {workspace === 'structure' && <TabPanel id="structure"><section id="template-structure-panel" tabIndex={-1} className="space-y-4 focus:outline-none"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Layers3 className="h-4 w-4 text-primary" aria-hidden="true" /><h2 className="text-base font-semibold text-text">{t('workspace_structure')}</h2></div><p className="mt-1 text-sm text-muted">{t('workspace_structure_hint')}</p></div>{!editorReadOnly && !layoutValidation.valid && <Button variant="ghost" size="sm" onClick={() => patch({}, { layout: getDefaultDocumentLayout(type) })}>{t('restore_default_layout')}</Button>}</div>{validationIssues.filter((issue) => issue.target === 'structure').map((issue, index) => <p key={`${issue.code}-${index}`} role="alert" className="rounded border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-text">{validationLabel(issue)}</p>)}{!editorReadOnly ? <SectionDesigner value={definition.layout} onChange={(layout) => patch({}, { layout })} allowedBlocks={documentType.allowedBlocks} requiredBlocks={documentType.requiredBlocks} /> : <p className="rounded border border-border bg-surface px-3 py-2 text-sm text-muted">{isPublishedOnly ? t('library_published_hint') : t('read_only')}</p>}</section></TabPanel>}
            {workspace === 'properties' && <TabPanel id="properties"><section id="template-properties-panel" tabIndex={-1} className="space-y-5 focus:outline-none"><div><div className="flex items-center gap-2"><Settings2 className="h-4 w-4 text-primary" aria-hidden="true" /><h2 className="text-base font-semibold text-text">{t('workspace_properties')}</h2></div><p className="mt-1 text-sm text-muted">{t('workspace_properties_hint')}</p></div>{validationIssues.filter((issue) => issue.target === 'properties').map((issue, index) => <p key={`${issue.code}-${index}`} role="alert" className="rounded border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-text">{validationLabel(issue)}</p>)}<div className="grid gap-4 lg:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="template-name">{t('template_name')}</Label><Input id="template-name" value={selected.name} disabled={editorReadOnly} onChange={(event) => patch({ name: event.target.value })} /></div><div className="space-y-1.5"><Label htmlFor="document-type">{t('document_type')}</Label><Select id="document-type" value={type} disabled={editorReadOnly} onChange={(event) => setActiveDocumentType(event.target.value as DocumentTypeId)}>{documentTypes.map((id) => <option key={id} value={id}>{tTypes(id)}</option>)}</Select></div><div className="space-y-1.5"><Label htmlFor="template-style">{t('display_style')}</Label><Select id="template-style" value={definition.template_id} disabled={editorReadOnly} onChange={(event) => patch({}, { template_id: event.target.value })}>{templatesCatalog.map((item) => <option key={item.id} value={item.id}>{tTemplates(item.nameKey)}</option>)}</Select></div><div className="space-y-1.5"><Label htmlFor="theme">{t('theme')}</Label><Select id="theme" value={definition.theme_id} disabled={editorReadOnly} onChange={(event) => patch({}, { theme_id: event.target.value as ThemeId })}>{THEME_IDS.map((id) => <option key={id} value={id}>{id}</option>)}</Select></div><div className="space-y-1.5 lg:col-span-2"><Label htmlFor="footer">{t('footer')}</Label><Input id="footer" value={definition.footer_text} disabled={editorReadOnly} onChange={(event) => patch({}, { footer_text: event.target.value })} placeholder={t('footer_placeholder')} /></div></div>{!editorReadOnly && <BlockPropertiesEditor value={definition.layout} onChange={(layout) => patch({}, { layout })} documentType={type} disabled={saving} />}<div className="flex justify-end"><Button variant="outline" onClick={() => setWorkspace('preview')}><Eye className="h-4 w-4" aria-hidden="true" />{t('workspace_view_preview')}</Button></div></section></TabPanel>}
            {workspace === 'preview' && <TabPanel id="preview"><section className="space-y-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Eye className="h-4 w-4 text-primary" aria-hidden="true" /><h2 className="text-base font-semibold text-text">{t('workspace_preview')}</h2></div><p className="mt-1 text-sm text-muted">{t('preview_hint')}</p></div><Badge tone="neutral">{t('workspace_safe_preview')}</Badge></div><div className="min-h-[620px] rounded-lg border border-border bg-background p-3"><DocumentScaler><DocumentView model={preview} templateId={definition.template_id} themeId={definition.theme_id} showLogo={definition.show_logo} layout={definition.layout} rootId="print-template-preview" /></DocumentScaler></div></section></TabPanel>}
            {workspace === 'governance' && <TabPanel id="governance"><section className="space-y-5"><div><div className="flex items-center gap-2"><GitBranch className="h-4 w-4 text-primary" aria-hidden="true" /><h2 className="text-base font-semibold text-text">{t('workspace_governance')}</h2></div><p className="mt-1 text-sm text-muted">{t('workspace_governance_hint')}</p></div><section id="template-revision-history" tabIndex={-1} className="scroll-mt-4 focus:outline-none"><TemplateRevisionHistory revisions={detailedSelected.revisions} loading={detailsLoading} failed={detailsFailed} /></section><section id="template-assignments" tabIndex={-1} className="scroll-mt-4 focus:outline-none"><PrintTemplateAssignments template={selected} canManage={canManage} /></section></section></TabPanel>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
