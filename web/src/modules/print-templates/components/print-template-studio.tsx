'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, Copy, FilePlus2, Loader2, Save, Send, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { SectionDesigner } from '@/components/settings/section-designer';
import { PrintTemplateAssignments } from './print-template-assignments';
import { PrintTemplateCenter } from './print-template-center';
import { PrintTemplateLibrary } from './print-template-library';
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
import type { DocSectionLayoutItem, DocumentTypeId, ThemeId } from '@/modules/documents/types';

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
  const [templates, setTemplates] = useState<PrintTemplate[]>([]);
  const [selectedId, setSelectedId] = useState(FALLBACK.id);
  const [activeDocumentType, setActiveDocumentType] = useState<DocumentTypeId | null>(null);
  const [templateLoadState, setTemplateLoadState] = useState<TemplateCenterLoadState>('loading');
  const [saving, setSaving] = useState(false);
  const [surface, setSurface] = useState<'center' | 'library' | 'studio'>('center');
  const [templateDetails, setTemplateDetails] = useState<Record<string, PrintTemplate>>({});
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsFailed, setDetailsFailed] = useState(false);

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
  const preview = useMemo(() => {
    const model = getDocumentPreviewModel(type);
    return definition.footer_text ? { ...model, footerText: definition.footer_text } : model;
  }, [definition.footer_text, type]);
  const isPublishedOnly = selected.published_revision != null && selected.draft_revision == null;
  const editorReadOnly = !canManage || isPublishedOnly;

  const patch = (changes: Partial<PrintTemplate>, definitionChanges?: Partial<TemplateDefinition>) => {
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

  function createLocalTemplate(documentType: DocumentTypeId) {
    const now = Date.now();
    const local: PrintTemplate = {
      ...FALLBACK,
      id: `new-${now}`,
      name: t('new_template'),
      document_types: [documentType],
      draft_revision: {
        ...FALLBACK.draft_revision!,
        id: `new-r-${now}`,
        document_types: [documentType],
        definition: {
          ...FALLBACK.draft_revision!.definition,
          layout: getDefaultDocumentLayout(documentType),
        },
      },
    };
    setTemplates((current) => [local, ...current]);
    setSelectedId(local.id);
    setActiveDocumentType(documentType);
    return local;
  }

  function createTemplate() {
    createLocalTemplate('tax_invoice');
    setSurface('studio');
  }

  function openDocumentType(documentType: DocumentTypeId) {
    if (!canOpenTemplateCenterDocumentType(templateLoadState)) return;
    setActiveDocumentType(documentType);
    setSurface('library');
  }

  function openTemplateFromLibrary(templateId: string, documentType: DocumentTypeId) {
    setSelectedId(templateId);
    setActiveDocumentType(documentType);
    setSurface('studio');
  }

  function createTemplateFromLibrary(documentType: DocumentTypeId) {
    createLocalTemplate(documentType);
    setSurface('studio');
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
      error(t('layout_invalid'));
      return;
    }

    setSaving(true);
    try {
      const response = await api<{ data: PrintTemplate }>(`/print-templates/${selected.id}/publish`, { method: 'POST' });
      setTemplates((current) => current.map((template) => template.id === selected.id ? response.data : template));
      void loadTemplateDetails(response.data.id);
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

  const templatesCatalog = listTemplates();
  const selectedName = selected.name || t('preview_template_name');

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

  if (surface === 'library') {
    return (
      <PrintTemplateLibrary
        templates={templates}
        loadState={templateLoadState}
        initialDocumentType={activeDocumentType ?? 'tax_invoice'}
        canManage={canManage}
        onBack={() => setSurface('center')}
        onOpenTemplate={openTemplateFromLibrary}
        onCreateDraftFromPublished={(templateId, documentType) => void createDraftFromPublished(templateId, documentType)}
        onCreateTemplate={createTemplateFromLibrary}
      />
    );
  }

  return (
    <div className="space-y-4" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" className="-ms-2 mb-2" onClick={() => setSurface('library')}>
            {locale === 'ar'
              ? <ChevronRight className="h-4 w-4" aria-hidden="true" />
              : <ChevronLeft className="h-4 w-4" aria-hidden="true" />}
            {t('back_to_library')}
          </Button>
          <p className="text-xs font-medium text-primary">{t('library_label')}</p>
          <h1 className="mt-1 text-2xl font-semibold text-text">{t('title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">{t('subtitle')}</p>
        </div>
        {canManage && <Button onClick={createTemplate}><FilePlus2 className="h-4 w-4" aria-hidden="true" />{t('new_template')}</Button>}
      </div>

      <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader className="border-b border-border py-3"><CardTitle className="text-sm">{t('library_label')}</CardTitle></CardHeader>
          <CardContent className="space-y-1 p-2">
            {templateLoadState === 'loading' ? <p className="p-3 text-sm text-muted">{t('loading')}</p> : templates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => {
                  setSelectedId(template.id);
                  setActiveDocumentType(null);
                }}
                aria-pressed={template.id === selected.id}
                className={`w-full rounded-lg p-3 text-start transition focus-visible:ring-2 focus-visible:ring-primary/40 ${template.id === selected.id ? 'bg-primary/10 text-primary' : 'hover:bg-surface'}`}
              >
                <span className="block truncate text-sm font-medium">{template.name || t('preview_template_name')}</span>
                <span className="mt-1 flex items-center justify-between text-[11px] text-muted">
                  <span>{t('document_type_count', { count: template.document_types.length })}</span>
                  <span>{template.status === 'published' ? t('published') : t('draft')}</span>
                </span>
              </button>
            ))}
          </CardContent>
        </Card>

        <div className="grid gap-4 2xl:grid-cols-[360px_minmax(0,1fr)]">
          <Card className="h-fit">
            <CardHeader className="flex flex-row items-center justify-between border-b border-border py-3"><CardTitle className="text-sm">{t('draft_settings')}</CardTitle><Sparkles className="h-4 w-4 text-primary" aria-hidden="true" /></CardHeader>
            <CardContent className="space-y-4 p-4">
              <div className="space-y-1.5"><Label htmlFor="template-name">{t('template_name')}</Label><Input id="template-name" value={selected.name} disabled={editorReadOnly} onChange={(event) => patch({ name: event.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="document-type">{t('document_type')}</Label><Select id="document-type" value={type} disabled={editorReadOnly} onChange={(event) => setActiveDocumentType(event.target.value as DocumentTypeId)}>{documentTypes.map((id) => <option key={id} value={id}>{tTypes(id)}</option>)}</Select></div>
              <div className="space-y-1.5"><Label htmlFor="template-style">{t('display_style')}</Label><Select id="template-style" value={definition.template_id} disabled={editorReadOnly} onChange={(event) => patch({}, { template_id: event.target.value })}>{templatesCatalog.map((item) => <option key={item.id} value={item.id}>{tTemplates(item.nameKey)}</option>)}</Select></div>
              <div className="space-y-1.5"><Label htmlFor="theme">{t('theme')}</Label><Select id="theme" value={definition.theme_id} disabled={editorReadOnly} onChange={(event) => patch({}, { theme_id: event.target.value as ThemeId })}>{THEME_IDS.map((id) => <option key={id} value={id}>{id}</option>)}</Select></div>
              <div className="space-y-1.5"><Label htmlFor="footer">{t('footer')}</Label><Input id="footer" value={definition.footer_text} disabled={editorReadOnly} onChange={(event) => patch({}, { footer_text: event.target.value })} placeholder={t('footer_placeholder')} /></div>
              <div className="border-t border-border pt-4">
                <div className="mb-2 flex items-center justify-between gap-2"><p className="text-xs font-medium text-text">{t('layout_title')}</p>{!editorReadOnly && !layoutValidation.valid && <Button variant="ghost" size="sm" onClick={() => patch({}, { layout: getDefaultDocumentLayout(type) })}>{t('restore_default_layout')}</Button>}</div>
                {!editorReadOnly ? <SectionDesigner value={definition.layout} onChange={(layout) => patch({}, { layout })} allowedBlocks={documentType.allowedBlocks} requiredBlocks={documentType.requiredBlocks} /> : <p className="text-xs text-muted">{isPublishedOnly ? t('library_published_hint') : t('read_only')}</p>}
              </div>
              {!editorReadOnly && <BlockPropertiesEditor value={definition.layout} onChange={(layout) => patch({}, { layout })} documentType={type} disabled={saving} />}
              {canManage && (isPublishedOnly ? <div className="border-t border-border pt-4"><Button className="w-full" onClick={() => void createDraftFromPublished(selected.id, type)} disabled={saving}><FilePlus2 className="h-4 w-4" aria-hidden="true" />{t('library_create_draft')}</Button></div> : <div className="grid grid-cols-2 gap-2 border-t border-border pt-4"><Button variant="outline" onClick={() => void duplicate()} disabled={saving}><Copy className="h-4 w-4" aria-hidden="true" />{t('copy')}</Button><Button onClick={() => void saveDraft()} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}{t('save_draft')}</Button><Button className="col-span-2" variant="primary" onClick={() => void publish()} disabled={saving}><Send className="h-4 w-4" aria-hidden="true" />{t('publish_revision', { version: revision.version })}</Button></div>)}
            </CardContent>
          </Card>

          <Card className="overflow-hidden"><CardHeader className="flex flex-row items-center justify-between border-b border-border py-3"><div><CardTitle className="text-sm">{t('preview')}</CardTitle><p className="mt-1 text-xs text-muted">{t('preview_hint')}</p></div><span className="rounded bg-surface px-2 py-1 text-xs text-muted">{t('revision', { version: revision.version })}</span></CardHeader><CardContent className="min-h-[620px] bg-background p-3"><DocumentScaler><DocumentView model={preview} templateId={definition.template_id} themeId={definition.theme_id} showLogo={definition.show_logo} layout={definition.layout} rootId="print-template-preview" /></DocumentScaler></CardContent></Card>
        </div>
      </div>

      <TemplateRevisionHistory revisions={detailedSelected.revisions} loading={detailsLoading} failed={detailsFailed} />

      <PrintTemplateAssignments template={selected} canManage={canManage} />
    </div>
  );
}
