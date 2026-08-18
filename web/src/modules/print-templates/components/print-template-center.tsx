'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FileText, Landmark, ReceiptText, Search, ShoppingCart, Truck, type LucideIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { DocumentTypeId } from '@/modules/documents/types';
import {
  filterTemplateCenterFamilies,
  TEMPLATE_CENTER_FAMILIES,
  type TemplateCenterFamilyId,
} from '../template-center-catalog';

interface TemplateCenterTemplate {
  id: string;
  status: 'draft' | 'published' | 'archived';
  document_types: DocumentTypeId[];
}

interface PrintTemplateCenterProps {
  templates: readonly TemplateCenterTemplate[];
  loading: boolean;
  onOpenDocumentType: (type: DocumentTypeId) => void;
}

const FAMILY_ICONS: Record<TemplateCenterFamilyId, LucideIcon> = {
  sales: ReceiptText,
  purchases: ShoppingCart,
  finance: Landmark,
  logistics: Truck,
};

/**
 * نقطة الدخول إلى الاستوديو: تعرض مجالات العمل والأنواع المدعومة بالفعل فقط.
 * لا تملك المركز حالة قالب أو مراجعة؛ يبقى هذا مصدره الاستوديو وواجهة API القائمة.
 */
export function PrintTemplateCenter({ templates, loading, onOpenDocumentType }: PrintTemplateCenterProps) {
  const t = useTranslations('printTemplateStudio');
  const tTypes = useTranslations('documentTypes');
  const [query, setQuery] = useState('');

  const families = useMemo(() => filterTemplateCenterFamilies(
    query,
    (type) => tTypes(type),
    (family) => t(`center_family_${family}_title`),
  ), [query, t, tTypes]);

  const draftCount = templates.filter((template) => template.status === 'draft').length;
  const publishedCount = templates.filter((template) => template.status === 'published').length;
  const templateCountForType = (type: DocumentTypeId) => templates.filter((template) => template.document_types.includes(type)).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-primary">{t('center_label')}</p>
          <h1 className="mt-1 text-2xl font-semibold text-text">{t('center_title')}</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">{t('center_subtitle')}</p>
        </div>
      </div>

      <section aria-label={t('center_overview')} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <CenterMetric label={t('center_total_templates')} value={loading ? '—' : templates.length} />
        <CenterMetric label={t('center_drafts')} value={loading ? '—' : draftCount} />
        <CenterMetric label={t('center_published')} value={loading ? '—' : publishedCount} />
        <CenterMetric label={t('center_supported_types')} value={TEMPLATE_CENTER_FAMILIES.reduce((total, family) => total + family.documentTypes.length, 0)} />
      </section>

      <div className="max-w-xl space-y-1.5">
        <Label htmlFor="template-center-search">{t('center_search_label')}</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <Input
            id="template-center-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="ps-9"
            placeholder={t('center_search_placeholder')}
          />
        </div>
      </div>

      <section aria-labelledby="template-center-families-title" className="space-y-3">
        <div>
          <h2 id="template-center-families-title" className="text-base font-semibold text-text">{t('center_families_title')}</h2>
          <p className="mt-1 text-sm text-muted">{t('center_families_hint')}</p>
        </div>

        {families.length ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {families.map((family) => {
              const Icon = FAMILY_ICONS[family.id];
              return (
                <Card key={family.id} className="overflow-hidden">
                  <CardHeader className="border-b border-border py-4">
                    <div className="flex items-start gap-3">
                      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" strokeWidth={1.7} aria-hidden="true" />
                      <div className="min-w-0">
                        <CardTitle className="text-base">{t(`center_family_${family.id}_title`)}</CardTitle>
                        <p className="mt-1 text-sm leading-relaxed text-muted">{t(`center_family_${family.id}_description`)}</p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-3">
                    <ul className="grid gap-2 sm:grid-cols-2" aria-label={t('center_family_types', { family: t(`center_family_${family.id}_title`) })}>
                      {family.documentTypes.map((type) => {
                        const count = templateCountForType(type);
                        return (
                          <li key={type}>
                            <button
                              type="button"
                              onClick={() => onOpenDocumentType(type)}
                              className="flex min-h-11 w-full items-center gap-2 rounded border border-border bg-surface px-3 py-2 text-start transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-primary/40"
                            >
                              <FileText className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.7} aria-hidden="true" />
                              <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">{tTypes(type)}</span>
                              <span className="shrink-0 text-xs text-muted">{t('center_template_count', { count })}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card>
            <CardContent className="p-6 text-center">
              <p className="font-medium text-text">{t('center_no_results_title')}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">{t('center_no_results_hint')}</p>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}

function CenterMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-sm text-muted">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-text">{value}</p>
      </CardContent>
    </Card>
  );
}
