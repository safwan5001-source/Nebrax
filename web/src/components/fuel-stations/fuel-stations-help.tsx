'use client';

import { useTranslations } from 'next-intl';
import { FuelHelpArticleView } from '@/components/fuel-help/fuel-help-article-view';
import { FuelHelpCenter } from '@/components/fuel-help/fuel-help-center';

export const FUEL_ERP_HELP_BASE = '/fuel-stations/help';

/** مركز مساعدة محطات الوقود داخل وحدة ERP: المحتوى هو نفسه المعروض في تطبيق «محطات أَوْج» (مصدر واحد). */
export function FuelStationsHelp() {
  const t = useTranslations('fuelHelp');
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header>
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <p className="mt-1 text-sm leading-6 text-muted">{t('description')}</p>
      </header>
      <FuelHelpCenter basePath={FUEL_ERP_HELP_BASE} surface="erp" />
    </div>
  );
}

export function FuelStationsHelpArticle({ slug }: { slug: string }) {
  return (
    <div className="mx-auto max-w-4xl">
      <FuelHelpArticleView slug={slug} basePath={FUEL_ERP_HELP_BASE} surface="erp" />
    </div>
  );
}
