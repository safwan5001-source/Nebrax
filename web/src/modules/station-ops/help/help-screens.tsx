'use client';

import { useTranslations } from 'next-intl';
import { FuelHelpArticleView } from '@/components/fuel-help/fuel-help-article-view';
import { FuelHelpCenter } from '@/components/fuel-help/fuel-help-center';
import { useStationOps } from '../context';
import { OPS_BASE, deriveOpsMode } from '../nav';
import { PageMasthead, ScreenBody } from '../masthead';

export const OPS_HELP_BASE = `${OPS_BASE}/help`;

/**
 * مركز المساعدة داخل تطبيق «محطات أَوْج»: الغلاف والرأس من التطبيق، والمحتوى هو مصدر وحدة المحطات نفسه
 * (`modules/help-center/fuel`). لا طلبات شبكة ولا أي كتابة؛ الروابط داخل التطبيق فقط.
 */
export function HelpHomeScreen() {
  const t = useTranslations('fuelHelp');
  const { can } = useStationOps();
  // البائع يرى أدلته أولاً؛ المشرف والمسؤول يحتاجان أدلة البائع أيضاً فلا تُصفَّى مسبقاً.
  const defaultAudience = deriveOpsMode(can) === 'operator' ? 'operator' : undefined;
  return (
    <>
      <PageMasthead title={t('title')} subtitle={t('description')} />
      <ScreenBody>
        <FuelHelpCenter basePath={OPS_HELP_BASE} surface="app" defaultAudience={defaultAudience} />
      </ScreenBody>
    </>
  );
}

export function HelpArticleScreen({ slug }: { slug: string }) {
  const t = useTranslations('fuelHelp');
  return (
    <>
      <PageMasthead title={t('title')} backHref={OPS_HELP_BASE} backLabel={t('backToHelp')} />
      <ScreenBody>
        <FuelHelpArticleView slug={slug} basePath={OPS_HELP_BASE} surface="app" />
      </ScreenBody>
    </>
  );
}
