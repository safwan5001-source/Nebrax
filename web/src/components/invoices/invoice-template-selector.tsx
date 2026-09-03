'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Eye, LayoutTemplate, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { BRANCH_CHANGED_EVENT, getActiveBranchId } from '@/lib/branch';
import { cn } from '@/lib/utils';
import { DocumentScaler } from '@/modules/documents/components/document-scaler';
import { DocumentView } from '@/modules/documents/components/document-view';
import { getDocumentPreviewModel } from '@/modules/documents/registry/document-samples';
import { DEFAULT_TEMPLATE_ID, getTemplate } from '@/modules/documents/registry/templates';
import type { ThemeId, DocSectionLayoutItem } from '@/modules/documents/types';
import type { InvoiceZatcaDocumentType } from '@/modules/print-templates/services/document-output-template';
import type { LivePrintTemplateAssignment } from '@/modules/print-templates/services/live-template-definition';
import {
  findInvoiceDesignTemplate,
  invoiceDesignCatalogType,
  publishedInvoiceDesignTemplates,
  selectedInvoiceDesignIsCompatible,
  type InvoiceLibraryTemplate,
} from '@/modules/invoices/invoice-template-selector';

type LoadState = 'loading' | 'ready' | 'error';

function assignmentFromPayload(payload: unknown): LivePrintTemplateAssignment | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const data = 'data' in payload ? (payload as { data: unknown }).data : payload;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const revisionId = (data as { print_template_revision_id?: unknown }).print_template_revision_id;
  if (typeof revisionId !== 'string' || revisionId === '') return null;
  return data as LivePrintTemplateAssignment;
}

function libraryFromPayload(payload: unknown): InvoiceLibraryTemplate[] {
  if (!payload || typeof payload !== 'object') return [];
  const data = 'data' in payload ? (payload as { data: unknown }).data : payload;
  return Array.isArray(data) ? data as InvoiceLibraryTemplate[] : [];
}

export function InvoiceTemplateSelector({
  zatcaDocumentType,
  branchId,
  overrideRevisionId,
  onChange,
  onCompatibilityChange,
}: {
  zatcaDocumentType: InvoiceZatcaDocumentType;
  branchId?: string | null;
  overrideRevisionId: string | null;
  onChange: (revisionId: string | null) => void;
  onCompatibilityChange?: (compatible: boolean) => void;
}) {
  const t = useTranslations('invoiceForm');
  const locale = useLocale();
  const catalog = invoiceDesignCatalogType(zatcaDocumentType);
  const [activeBranchId, setActiveBranchId] = useState<string | null>(() => branchId ?? getActiveBranchId());

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [library, setLibrary] = useState<InvoiceLibraryTemplate[]>([]);
  const [livePrintRevisionId, setLivePrintRevisionId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    if (branchId) {
      setActiveBranchId(branchId);
      return;
    }
    const sync = () => setActiveBranchId(getActiveBranchId());
    sync();
    window.addEventListener(BRANCH_CHANGED_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(BRANCH_CHANGED_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, [branchId]);

  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');
    const branchQuery = activeBranchId ? `&branch_id=${encodeURIComponent(activeBranchId)}` : '';
    const resolveUsage = (documentType: string, usage: 'print' | 'pdf') => (
      api(`/print-templates/resolve?document_type=${documentType}&usage=${usage}${branchQuery}`)
        .catch(() => ({ data: null }))
    );

    Promise.all([
      api('/print-templates'),
      resolveUsage(catalog, 'print'),
      catalog === 'simplified_tax_invoice' ? resolveUsage('tax_invoice', 'print') : Promise.resolve({ data: null }),
    ])
      .then(([templatesPayload, printPayload, fallbackPrintPayload]) => {
        if (cancelled) return;
        setLibrary(libraryFromPayload(templatesPayload));
        const live = assignmentFromPayload(printPayload) ?? assignmentFromPayload(fallbackPrintPayload);
        setLivePrintRevisionId(live?.print_template_revision_id ?? live?.revision?.id ?? null);
        setLoadState('ready');
      })
      .catch(() => {
        if (!cancelled) setLoadState('error');
      });

    return () => { cancelled = true; };
  }, [catalog, activeBranchId]);

  const published = useMemo(
    () => publishedInvoiceDesignTemplates(library, catalog),
    [library, catalog],
  );
  const compatible = loadState !== 'ready' || selectedInvoiceDesignIsCompatible(library, catalog, overrideRevisionId);

  useEffect(() => {
    onCompatibilityChange?.(compatible);
  }, [compatible, onCompatibilityChange]);

  const custom = overrideRevisionId !== null;
  const activeRevisionId = overrideRevisionId ?? livePrintRevisionId;
  const activeTemplate = findInvoiceDesignTemplate(published, activeRevisionId)
    ?? findInvoiceDesignTemplate(library, activeRevisionId);
  const previewRevision = activeTemplate?.published_revision;
  const previewDefinition = previewRevision?.definition;
  const previewModel = getDocumentPreviewModel(catalog);
  const previewTemplateId = previewDefinition?.template_id ?? DEFAULT_TEMPLATE_ID;
  const previewTheme = (previewDefinition?.theme_id as ThemeId | undefined)
    ?? getTemplate(previewTemplateId).defaultTheme;

  const name = activeTemplate?.name ?? t('design_safe_default');

  return (
    <div dir={locale === 'ar' ? 'rtl' : 'ltr'} className="rounded border border-border bg-surface px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <LayoutTemplate className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" strokeWidth={1.7} />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">{t('design_label')}</p>
          {loadState === 'loading' ? (
            <Skeleton className="mt-1 h-4 w-40" />
          ) : (
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-2">
              <p className="truncate text-sm font-medium text-text">{name}</p>
              <Badge tone={custom ? 'neutral' : 'muted'}>
                {custom ? t('design_custom_badge') : t('design_default_badge')}
              </Badge>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)} disabled={loadState === 'loading'}>
            {t('design_change')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setPreviewOpen(true)} disabled={loadState === 'loading'}>
            <Eye className="h-4 w-4" strokeWidth={1.7} />
            {t('design_preview')}
          </Button>
          {custom && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
              <RotateCcw className="h-4 w-4" strokeWidth={1.7} />
              {t('design_reset')}
            </Button>
          )}
        </div>
      </div>

      {loadState === 'error' && (
        <p className="mt-2 text-xs text-muted">{t('design_load_error')}</p>
      )}
      {loadState === 'ready' && published.length === 0 && (
        <p className="mt-2 text-xs text-muted">{t('design_empty')}</p>
      )}
      {!compatible && (
        <p role="alert" className="mt-2 text-xs text-negative">{t('design_incompatible')}</p>
      )}

      <Dialog open={pickerOpen} onClose={() => setPickerOpen(false)} title={t('design_picker_title')} className="max-w-2xl">
        {loadState === 'error' ? (
          <p className="text-sm text-muted">{t('design_load_error')}</p>
        ) : published.length === 0 ? (
          <p className="text-sm text-muted">{t('design_empty')}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {published.map((item) => {
              const revision = item.published_revision;
              const selected = (item.published_revision_id ?? revision?.id) === overrideRevisionId;
              const isDefault = (item.published_revision_id ?? revision?.id) === livePrintRevisionId && !custom;
              const definition = revision?.definition;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(item.published_revision_id ?? revision?.id ?? null);
                      setPickerOpen(false);
                    }}
                    className={cn(
                      'flex h-full w-full flex-col overflow-hidden rounded border text-start',
                      selected ? 'border-primary bg-primary-soft/40' : 'border-border bg-background hover:border-primary/50',
                    )}
                  >
                    <div className="h-28 overflow-hidden border-b border-border bg-background p-1.5" aria-hidden="true">
                      <DocumentScaler>
                        <DocumentView
                          model={previewModel}
                          templateId={definition?.template_id ?? DEFAULT_TEMPLATE_ID}
                          themeId={(definition?.theme_id as ThemeId | undefined) ?? 'blue'}
                          showLogo={definition?.show_logo !== false}
                          layout={Array.isArray(definition?.layout) ? definition.layout as DocSectionLayoutItem[] : undefined}
                          rootId={null}
                        />
                      </DocumentScaler>
                    </div>
                    <div className="flex items-start justify-between gap-2 p-2.5">
                      <span className="min-w-0 truncate text-sm font-medium text-text">{item.name}</span>
                      {isDefault && <Badge tone="muted">{t('design_default_badge')}</Badge>}
                      {selected && <Badge tone="neutral">{t('design_custom_badge')}</Badge>}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Dialog>

      <Dialog open={previewOpen} onClose={() => setPreviewOpen(false)} title={t('design_preview_title')} className="max-w-3xl">
        <p className="mb-3 text-xs text-muted">{t('design_preview_hint')}</p>
        <div className="rounded border border-border bg-background p-3">
          <DocumentScaler>
            <DocumentView
              model={previewModel}
              templateId={previewTemplateId}
              themeId={previewTheme}
              showLogo={previewDefinition?.show_logo !== false}
              layout={Array.isArray(previewDefinition?.layout) ? previewDefinition.layout as DocSectionLayoutItem[] : undefined}
              rootId="invoice-design-preview"
            />
          </DocumentScaler>
        </div>
      </Dialog>
    </div>
  );
}
