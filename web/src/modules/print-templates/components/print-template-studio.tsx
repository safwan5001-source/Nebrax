'use client';

import { useEffect, useMemo, useState } from 'react';
import { Copy, FilePlus2, Loader2, Save, Send, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { SectionDesigner } from '@/components/settings/section-designer';
import { PrintTemplateAssignments } from './print-template-assignments';
import { api } from '@/lib/api';
import { DocumentScaler } from '@/modules/documents/components/document-scaler';
import { DocumentView } from '@/modules/documents/components/document-view';
import { getDocumentPreviewModel } from '@/modules/documents/registry/document-samples';
import { getDefaultDocumentLayout, getDocumentTypeDefinition } from '@/modules/documents/registry/document-types';
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
}

interface PrintTemplate {
  id: string;
  name: string;
  status: 'draft' | 'published' | 'archived';
  source: 'custom' | 'migrated';
  document_types: DocumentTypeId[];
  published_revision?: Revision | null;
  draft_revision?: Revision | null;
}

const FALLBACK: PrintTemplate = {
  id: 'local-preview',
  name: 'قالب معاينة جديد',
  status: 'draft',
  source: 'custom',
  document_types: ['tax_invoice'],
  draft_revision: {
    id: 'local-preview-r1', version: 1, status: 'draft', document_types: ['tax_invoice'],
    definition: { template_id: 'tax-invoice-classic', theme_id: 'blue', show_logo: true, layout: getDefaultDocumentLayout('tax_invoice') },
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
 * مكتبة ومحرر مرحلة الواجهة. يحرر تعريف المسودة فقط ويعرض نموذجاً آمناً؛ النشر
 * يمر دائماً عبر API الخلفية حيث تُفرض عدم قابلية تعديل المراجعة المنشورة.
 */
export function PrintTemplateStudio({ canManage }: { canManage: boolean }) {
  const { success, error } = useToast();
  const [templates, setTemplates] = useState<PrintTemplate[]>([]);
  const [selectedId, setSelectedId] = useState(FALLBACK.id);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ data: PrintTemplate[] }>('/print-templates')
      .then((response) => {
        const next = response.data.length ? response.data : [FALLBACK];
        setTemplates(next);
        setSelectedId(next[0].id);
      })
      .catch(() => setTemplates([FALLBACK]))
      .finally(() => setLoading(false));
  }, []);

  const selected = templates.find((template) => template.id === selectedId) ?? templates[0] ?? FALLBACK;
  const revision = activeRevision(selected);
  const type = revision.document_types[0] ?? selected.document_types[0] ?? 'tax_invoice';
  const definition = useMemo(() => normalizeDefinition(revision, type), [revision, type]);
  const preview = useMemo(() => {
    const model = getDocumentPreviewModel(type);
    return definition.footer_text ? { ...model, footerText: definition.footer_text } : model;
  }, [definition.footer_text, type]);

  const patch = (changes: Partial<PrintTemplate>, definitionChanges?: Partial<TemplateDefinition>) => {
    setTemplates((current) => current.map((template) => {
      if (template.id !== selected.id) return template;
      const currentRevision = activeRevision(template);
      const nextDefinition = { ...currentRevision.definition, ...definitionChanges };
      const nextRevision = { ...currentRevision, document_types: changes.document_types ?? currentRevision.document_types, definition: nextDefinition };
      return { ...template, ...changes, draft_revision: nextRevision };
    }));
  };

  async function createTemplate() {
    const local: PrintTemplate = {
      ...FALLBACK,
      id: `new-${Date.now()}`,
      name: 'قالب جديد',
      draft_revision: { ...FALLBACK.draft_revision!, id: `new-r-${Date.now()}`, definition: { ...FALLBACK.draft_revision!.definition } },
    };
    setTemplates((current) => [local, ...current]);
    setSelectedId(local.id);
  }

  async function saveDraft() {
    if (!canManage) return;
    setSaving(true);
    try {
      const body = { name: selected.name, document_types: [type], definition };
      if (selected.id === FALLBACK.id || selected.id.startsWith('new-')) {
        const response = await api<{ data: PrintTemplate }>('/print-templates', { method: 'POST', body });
        setTemplates((current) => current.map((template) => template.id === selected.id ? response.data : template));
        setSelectedId(response.data.id);
      } else {
        const response = await api<{ data: PrintTemplate }>(`/print-templates/${selected.id}/draft`, { method: 'PUT', body });
        setTemplates((current) => current.map((template) => template.id === selected.id ? response.data : template));
      }
      success('حُفظت المسودة بنجاح');
    } catch {
      error('تعذر حفظ مسودة القالب');
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!canManage || selected.id === FALLBACK.id || selected.id.startsWith('new-')) {
      error('احفظ المسودة أولاً قبل النشر');
      return;
    }
    setSaving(true);
    try {
      const response = await api<{ data: PrintTemplate }>(`/print-templates/${selected.id}/publish`, { method: 'POST' });
      setTemplates((current) => current.map((template) => template.id === selected.id ? response.data : template));
      success('نُشرت مراجعة القالب وأصبحت قابلة للتعيين');
    } catch {
      error('تعذر نشر مراجعة القالب');
    } finally {
      setSaving(false);
    }
  }

  async function duplicate() {
    if (!canManage || selected.id === FALLBACK.id || selected.id.startsWith('new-')) return createTemplate();
    setSaving(true);
    try {
      const response = await api<{ data: PrintTemplate }>(`/print-templates/${selected.id}/duplicate`, {
        method: 'POST', body: { name: `${selected.name} — نسخة` },
      });
      setTemplates((current) => [response.data, ...current]);
      setSelectedId(response.data.id);
      success('أُنشئت مسودة مستقلة من القالب');
    } catch {
      error('تعذر نسخ القالب');
    } finally {
      setSaving(false);
    }
  }

  const templatesCatalog = listTemplates();
  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-primary">مكتبة الطباعة</p>
          <h1 className="mt-1 text-2xl font-semibold text-text">قوالب المستندات</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">حرّر المسودة وشاهد النتيجة على بيانات آمنة، ثم انشر مراجعة ثابتة للتعيين والطباعة.</p>
        </div>
        {canManage && <Button onClick={() => void createTemplate()}><FilePlus2 className="h-4 w-4" /> قالب جديد</Button>}
      </div>

      <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader className="border-b border-border py-3"><CardTitle className="text-sm">المكتبة</CardTitle></CardHeader>
          <CardContent className="space-y-1 p-2">
            {loading ? <p className="p-3 text-sm text-muted">يجري تحميل القوالب…</p> : templates.map((template) => (
              <button key={template.id} type="button" onClick={() => setSelectedId(template.id)}
                className={`w-full rounded-lg p-3 text-right transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${template.id === selected.id ? 'bg-primary/10 text-primary' : 'hover:bg-surface'}`}>
                <span className="block truncate text-sm font-medium">{template.name}</span>
                <span className="mt-1 flex items-center justify-between text-[11px] text-muted"><span>{template.document_types.length} نوع مستند</span><span>{template.status === 'published' ? 'منشور' : 'مسودة'}</span></span>
              </button>
            ))}
          </CardContent>
        </Card>

        <div className="grid gap-4 2xl:grid-cols-[360px_minmax(0,1fr)]">
          <Card className="h-fit">
            <CardHeader className="flex flex-row items-center justify-between border-b border-border py-3"><CardTitle className="text-sm">إعدادات المسودة</CardTitle><Sparkles className="h-4 w-4 text-primary" /></CardHeader>
            <CardContent className="space-y-4 p-4">
              <div className="space-y-1.5"><Label htmlFor="template-name">اسم القالب</Label><Input id="template-name" value={selected.name} disabled={!canManage} onChange={(event) => patch({ name: event.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="document-type">نوع المستند</Label><Select id="document-type" value={type} disabled={!canManage} onChange={(event) => {
                const next = event.target.value as DocumentTypeId;
                patch({ document_types: [next] }, { layout: getDefaultDocumentLayout(next) });
              }}>{Object.values(['tax_invoice','simplified_tax_invoice','quotation','proforma_invoice','sales_order','purchase_order','purchase_invoice','delivery_note','packing_list','receipt_voucher','payment_voucher','credit_note','debit_note','statement_of_account'] as DocumentTypeId[]).map((id) => <option key={id} value={id}>{getDocumentTypeDefinition(id).labelKey}</option>)}</Select></div>
              <div className="space-y-1.5"><Label htmlFor="template-style">نمط العرض</Label><Select id="template-style" value={definition.template_id} disabled={!canManage} onChange={(event) => patch({}, { template_id: event.target.value })}>{templatesCatalog.map((item) => <option key={item.id} value={item.id}>{item.nameKey}</option>)}</Select></div>
              <div className="space-y-1.5"><Label htmlFor="theme">السمة اللونية</Label><Select id="theme" value={definition.theme_id} disabled={!canManage} onChange={(event) => patch({}, { theme_id: event.target.value as ThemeId })}>{THEME_IDS.map((id) => <option key={id} value={id}>{id}</option>)}</Select></div>
              <div className="space-y-1.5"><Label htmlFor="footer">تذييل القالب</Label><Input id="footer" value={definition.footer_text} disabled={!canManage} onChange={(event) => patch({}, { footer_text: event.target.value })} placeholder="شكراً لتعاملكم معنا" /></div>
              <div className="border-t border-border pt-4"><p className="mb-2 text-xs font-medium text-text">ترتيب الكتل وظهورها</p>{canManage ? <SectionDesigner value={definition.layout} onChange={(layout) => patch({}, { layout })} /> : <p className="text-xs text-muted">لديك صلاحية عرض فقط.</p>}</div>
              {canManage && <div className="grid grid-cols-2 gap-2 border-t border-border pt-4"><Button variant="outline" onClick={() => void duplicate()} disabled={saving}><Copy className="h-4 w-4" /> نسخ</Button><Button onClick={() => void saveDraft()} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} حفظ المسودة</Button><Button className="col-span-2" variant="primary" onClick={() => void publish()} disabled={saving}><Send className="h-4 w-4" /> نشر المراجعة {revision.version}</Button></div>}
            </CardContent>
          </Card>

          <Card className="overflow-hidden"><CardHeader className="flex flex-row items-center justify-between border-b border-border py-3"><div><CardTitle className="text-sm">معاينة حية</CardTitle><p className="mt-1 text-xs text-muted">بيانات تجريبية فقط — لا يظهر أي سجل عميل حقيقي.</p></div><span className="rounded bg-surface px-2 py-1 text-xs text-muted">مراجعة {revision.version}</span></CardHeader><CardContent className="min-h-[620px] bg-slate-100 p-3 dark:bg-slate-950"><DocumentScaler><DocumentView model={preview} templateId={definition.template_id} themeId={definition.theme_id} showLogo={definition.show_logo} layout={definition.layout} rootId="print-template-preview" /></DocumentScaler></CardContent></Card>
        </div>
      </div>

      <PrintTemplateAssignments template={selected} canManage={canManage} />
    </div>
  );
}
