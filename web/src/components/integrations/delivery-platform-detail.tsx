'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { DeliveryPlatformMark } from '@/components/delivery/delivery-platform-mark';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { deliveryPlatformLabel } from '@/lib/delivery-platform-registry';
import type { DeliveryAccess, DeliveryLadder, ReadinessRow } from '@/lib/integration-center';
import { CapabilityLadder } from './delivery-ladder';
import { IntegrationBreadcrumb, RestrictedNotice } from './integration-shell';
import { SignedIngressPanel } from './signed-ingress-panel';
import type { SignedIngressState } from './use-signed-ingress';

const LINK = 'font-medium text-primary hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

/**
 * تفاصيل منصة توصيل (INT-UX-2) — عرض فقط، نظرة عامة بلا تبويبات (التبويبات الأخرى مؤجَّلة).
 *
 * يشرح سُلّم القدرات الأربع ويميّز بوضوح بين «نقطة استقبال الأحداث الموقّعة» (قدرة تقنية داخلية)
 * و«حساب تاجر متصل بمنصة خارجية» (غير موجود). لا أي زر ربط أو تفويض أو إعادة ربط أو مزامنة،
 * ولا حقل اعتماد. لوحة نقاط الاستقبال (INT-UX-4) للقراءة فقط. الزر الوحيد «إعادة المحاولة».
 */
export function DeliveryPlatformDetail({
  platformKey,
  access,
  loading,
  ladder,
  readiness,
  manualFailed,
  readinessFailed,
  canOpenApplications,
  canManageProfiles,
  canViewHub,
  canViewReport,
  canViewEvidence,
  ingress = { status: 'idle' },
  onIngressRetry = () => {},
  onRetry,
}: {
  platformKey: string;
  access: DeliveryAccess;
  loading: boolean;
  ladder: DeliveryLadder;
  readiness: ReadinessRow | null;
  manualFailed: boolean;
  readinessFailed: boolean;
  canOpenApplications: boolean;
  canManageProfiles: boolean;
  canViewHub: boolean;
  canViewReport: boolean;
  canViewEvidence: boolean;
  /** حالة لوحة نقاط الاستقبال (INT-UX-4). الافتراضي `idle` = اللوحة غائبة، فلا تتغيّر الشاشة لمن لا يمرّرها. */
  ingress?: SignedIngressState;
  onIngressRetry?: () => void;
  onRetry: () => void;
}) {
  const t = useTranslations('integrationCenter');
  const locale = useLocale();
  const name = deliveryPlatformLabel(platformKey, locale);
  const restricted = access === 'denied' || access === 'app_off';
  const catalogHref = '/integrations/delivery-platforms';
  const someFailed = manualFailed || readinessFailed;
  const evidence = canViewEvidence && readiness && (readiness.technical || readiness.evidenceDate || readiness.evidenceRef || readiness.evidenceMalformed) ? readiness : null;

  return (
    <div className="space-y-5 pb-16 md:pb-0" data-testid="delivery-platform-detail" data-platform={platformKey}>
      <IntegrationBreadcrumb
        items={[
          { label: t('title'), href: '/integrations' },
          { label: t('catalog.title'), href: catalogHref },
          { label: name },
        ]}
      />
      <header>
        <h1 className="[&_img]:h-10 [&_img]:w-10 [&_span.truncate]:text-xl">
          <DeliveryPlatformMark platformKey={platformKey} name={name} />
        </h1>
      </header>

      {restricted ? (
        <RestrictedNotice access={access} canOpenApplications={canOpenApplications} backHref="/integrations" />
      ) : loading || access === 'checking' ? (
        <div role="status" aria-busy="true" aria-label={t('detail.loading')} className="space-y-3" data-testid="detail-loading">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : (
        <>
          {someFailed ? (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-surface px-3 py-2 text-sm text-negative"
              data-testid="detail-read-error"
            >
              <span>{manualFailed && readinessFailed ? t('catalog.loadError') : t('catalog.partialError')}</span>
              <Button type="button" variant="outline" size="sm" onClick={onRetry}>{t('retry')}</Button>
            </div>
          ) : null}

          <section aria-labelledby="ladder-heading" className="space-y-2">
            <h2 id="ladder-heading" className="text-sm font-semibold text-text">{t('detail.ladderTitle')}</h2>
            <CapabilityLadder ladder={ladder} />
          </section>

          <section aria-labelledby="ingress-heading" className="space-y-1 rounded-md border border-border bg-surface p-4" data-testid="ingress-note">
            <h2 id="ingress-heading" className="text-sm font-semibold text-text">{t('detail.ingressTitle')}</h2>
            <p className="text-sm leading-relaxed text-muted">{t('detail.ingressBody', { platform: name })}</p>
          </section>

          <SignedIngressPanel platformName={name} state={ingress} onRetry={onIngressRetry} />

          <section aria-labelledby="works-heading" className="space-y-2">
            <h2 id="works-heading" className="text-sm font-semibold text-text">{t('detail.worksTitle')}</h2>
            <ul className="space-y-1.5 text-sm text-muted" role="list" data-testid="works-today">
              <li>
                {t('detail.worksPos')}{' '}
                {canManageProfiles ? (
                  <Link href="/delivery-platforms" className={LINK}>{t('detail.worksPosLink')}</Link>
                ) : (
                  <span data-testid="setup-needs-permission">{t('detail.setupNeedsPermission')}</span>
                )}
              </li>
              {canViewHub ? (
                <li>
                  {t('detail.worksHub')}{' '}
                  <Link href="/delivery-hub" className={LINK}>{t('detail.worksHubLink')}</Link>
                </li>
              ) : null}
              {canViewReport ? (
                <li>
                  {t('detail.worksReport')}{' '}
                  <Link href="/reports/sales/delivery-channel" className={LINK}>{t('detail.worksReportLink')}</Link>
                </li>
              ) : null}
            </ul>
          </section>

          {/* قائمة المتطلبات تصف ما ينقص قبل أن يتاح التكامل الأصلي. إن صار متاحاً فلا معنى لها (ولا نملك بيانات ببنودها)، وإن تعذّرت قراءته فلا ندّعي «غير متوفر بعد». */}
          {ladder.b !== 'available' ? (
            <section aria-labelledby="requires-heading" className="space-y-2">
              <h2 id="requires-heading" className="text-sm font-semibold text-text">{t('detail.requiresTitle')}</h2>
              <ul className="space-y-1.5 text-sm text-muted" role="list" data-testid="requires-list">
                {(['agreement', 'testAccess', 'spec'] as const).map((item) => (
                  <li key={item} className="flex flex-wrap items-baseline justify-between gap-2 rounded border border-border bg-surface px-3 py-2">
                    <span className="text-text">{t(`detail.requires.${item}`)}</span>
                    <span>{ladder.b === 'unreadable' ? t('ladder.b.unreadable') : t('detail.requiresNotYet')}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="space-y-1 text-xs leading-relaxed text-muted" data-testid="detail-boundaries">
            <p>{t('detail.hubOnlyNote')}</p>
            <p>{t('detail.manualUnchanged')}</p>
          </section>

          {evidence ? (
            <section aria-labelledby="advanced-heading" className="space-y-2 rounded-md border border-dashed border-border bg-surface p-4" data-testid="detail-advanced">
              <h2 id="advanced-heading" className="text-sm font-semibold text-text">{t('detail.advancedTitle')}</h2>
              <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[max-content_minmax(0,1fr)]">
                {evidence.technical ? (
                  <>
                    <dt className="text-muted">{t('detail.advanced.technical')}</dt>
                    <dd className="num text-text" dir="ltr">{evidence.technical}</dd>
                  </>
                ) : null}
                {evidence.evidenceDate ? (
                  <>
                    <dt className="text-muted">{t('detail.advanced.evidenceDate')}</dt>
                    <dd className="num text-text" dir="ltr">{evidence.evidenceDate}</dd>
                  </>
                ) : null}
                {evidence.evidenceRef ? (
                  <>
                    <dt className="text-muted">{t('detail.advanced.evidenceRef')}</dt>
                    <dd className="num break-all text-text" dir="ltr">{evidence.evidenceRef}</dd>
                  </>
                ) : null}
              </dl>
              {evidence.evidenceMalformed ? (
                <p role="note" className="text-xs leading-relaxed text-muted" data-testid="detail-advanced-malformed">{t('detail.advanced.malformed')}</p>
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

/** مفتاح منصة غير معروف: لا طلبات ولا شبكة ولا تفاصيل. صفحة «غير موجود» بعودة إلى الكتالوج. */
export function UnknownDeliveryPlatform() {
  const t = useTranslations('integrationCenter');

  return (
    <div className="space-y-4" data-testid="delivery-platform-unknown">
      <IntegrationBreadcrumb
        items={[
          { label: t('title'), href: '/integrations' },
          { label: t('catalog.title'), href: '/integrations/delivery-platforms' },
          { label: t('detail.unknownTitle') },
        ]}
      />
      <div className="space-y-2 rounded-md border border-dashed border-border bg-surface p-4">
        <h1 className="text-lg font-semibold text-text">{t('detail.unknownTitle')}</h1>
        <p role="note" className="text-sm leading-relaxed text-muted">{t('detail.unknownBody')}</p>
        <Link href="/integrations/delivery-platforms" className={`${LINK} text-sm`}>{t('detail.backToCatalog')}</Link>
      </div>
    </div>
  );
}
