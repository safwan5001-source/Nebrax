'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronRight } from 'lucide-react';
import { DeliveryPlatformMark } from '@/components/delivery/delivery-platform-mark';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { deliveryPlatformLabel } from '@/lib/delivery-platform-registry';
import type { DeliveryAccess, DeliveryLadder } from '@/lib/integration-center';
import { LADDER_STEPS, LadderValue, useLadderText } from './delivery-ladder';
import { IntegrationBreadcrumb, RestrictedNotice } from './integration-shell';

/**
 * كتالوج منصات التوصيل (INT-UX-2) — عرض فقط. جدول على `md+` وبطاقات تحتها.
 *
 * الصفوف الست ثابتة بترتيب السجلّ المركزي في اللغتين: لا ترتيب تفضيل ولا توصية ولا شارة
 * شراكة. لا يوجد عمود إجراء سوى «عرض التفاصيل» (رابط تنقّل)، ولا أي زر ربط أو تفويض أو
 * مزامنة ولا حقل اعتماد — حتى معطّلاً. الزر الوحيد في الصفحة «إعادة المحاولة» عند فشل القراءة.
 */
export function DeliveryPlatformCatalog({
  access,
  loading,
  ladders,
  manualFailed,
  readinessFailed,
  canOpenApplications,
  onRetry,
}: {
  access: DeliveryAccess;
  loading: boolean;
  ladders: DeliveryLadder[];
  manualFailed: boolean;
  readinessFailed: boolean;
  canOpenApplications: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations('integrationCenter');
  const locale = useLocale();
  const text = useLadderText();
  const restricted = access === 'denied' || access === 'app_off';
  const bothFailed = manualFailed && readinessFailed;
  const someFailed = manualFailed || readinessFailed;

  return (
    <div className="space-y-4 pb-16 md:pb-0" data-testid="delivery-platform-catalog">
      <IntegrationBreadcrumb
        items={[
          { label: t('title'), href: '/integrations' },
          { label: t('catalog.title') },
        ]}
      />
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-text">{t('catalog.title')}</h1>
        <p className="max-w-3xl text-sm leading-relaxed text-muted">{t('catalog.subtitle')}</p>
      </header>

      {restricted ? (
        <RestrictedNotice access={access} canOpenApplications={canOpenApplications} backHref="/integrations" />
      ) : loading || access === 'checking' ? (
        <div role="status" aria-busy="true" aria-label={t('catalog.loading')} className="space-y-2" data-testid="catalog-loading">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </div>
      ) : (
        <>
          {someFailed ? (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-surface px-3 py-2 text-sm text-negative"
              data-testid="catalog-read-error"
            >
              <span>{bothFailed ? t('catalog.loadError') : t('catalog.partialError')}</span>
              <Button type="button" variant="outline" size="sm" onClick={onRetry}>{t('retry')}</Button>
            </div>
          ) : null}

          <div className="hidden md:block" data-testid="catalog-table">
            <div className="rounded border border-border bg-surface">
              <Table>
                <caption className="sr-only">{t('catalog.caption')}</caption>
                <THead>
                  <TR>
                    <TH scope="col">{t('catalog.columns.platform')}</TH>
                    {LADDER_STEPS.map((step) => (
                      <TH key={step} scope="col">{text.label(step)}</TH>
                    ))}
                    <TH scope="col"><span className="sr-only">{t('catalog.columns.action')}</span></TH>
                  </TR>
                </THead>
                <TBody>
                  {ladders.map((ladder) => {
                    const name = deliveryPlatformLabel(ladder.platformKey, locale);
                    return (
                      <TR key={ladder.platformKey} data-platform={ladder.platformKey}>
                        <TD>
                          <DeliveryPlatformMark platformKey={ladder.platformKey} name={name} />
                        </TD>
                        {LADDER_STEPS.map((step) => (
                          <TD key={step}><LadderValue step={step} ladder={ladder} /></TD>
                        ))}
                        <TD className="text-end">
                          <Link
                            href={`/integrations/delivery-platforms/${ladder.platformKey}`}
                            aria-label={`${t('catalog.view')}: ${name}`}
                            className="inline-flex min-h-11 items-center gap-1 rounded px-2 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          >
                            {t('catalog.view')}
                            <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
                          </Link>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </div>
          </div>

          <ul className="space-y-3 md:hidden" role="list" data-testid="catalog-cards">
            {ladders.map((ladder) => {
              const name = deliveryPlatformLabel(ladder.platformKey, locale);
              return (
                <li key={ladder.platformKey} className="rounded-md border border-border bg-surface p-3" data-platform={ladder.platformKey}>
                  <Link
                    href={`/integrations/delivery-platforms/${ladder.platformKey}`}
                    aria-label={`${t('catalog.view')}: ${name}`}
                    className="flex min-h-11 items-center justify-between gap-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <DeliveryPlatformMark platformKey={ladder.platformKey} name={name} />
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted rtl:rotate-180" aria-hidden="true" />
                  </Link>
                  <dl className="mt-2 divide-y divide-border">
                    {LADDER_STEPS.map((step) => (
                      <div key={step} className="flex items-start justify-between gap-3 py-2">
                        <dt className="text-xs text-muted">{text.label(step)}</dt>
                        <dd className="min-w-0 text-end"><LadderValue step={step} ladder={ladder} /></dd>
                      </div>
                    ))}
                  </dl>
                </li>
              );
            })}
          </ul>

          <p className="text-xs leading-relaxed text-muted" data-testid="catalog-boundary">{t('catalog.boundary')}</p>
        </>
      )}
    </div>
  );
}
