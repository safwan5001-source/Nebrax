'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronRight } from 'lucide-react';
import type { DeliveryAccess } from '@/lib/integration-center';

/** مسار التنقّل: المركز › منصات التوصيل › المنصة. العنصر الأخير نص لا رابط (الصفحة الحالية). */
export function IntegrationBreadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  const t = useTranslations('integrationCenter');

  return (
    <nav aria-label={t('breadcrumb')} data-testid="integration-breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-muted">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1">
              {item.href && !last ? (
                <Link
                  href={item.href}
                  className="inline-flex min-h-11 items-center rounded px-1 hover:text-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {item.label}
                </Link>
              ) : (
                <span aria-current={last ? 'page' : undefined} className={last ? 'font-medium text-text' : undefined}>{item.label}</span>
              )}
              {!last ? <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** حالتا «لا صلاحية» و«تطبيق نقاط البيع معطّل»: ليستا خطأً ولا تُعرض بيانات ولا يُرسل طلب. */
export function RestrictedNotice({
  access,
  canOpenApplications,
  backHref,
}: {
  access: DeliveryAccess;
  canOpenApplications: boolean;
  backHref: string;
}) {
  const t = useTranslations('integrationCenter');
  const denied = access === 'denied';

  return (
    <div
      className="space-y-2 rounded-md border border-dashed border-border bg-surface p-4"
      data-testid="integration-restricted"
      data-state={access}
    >
      <p role="note" className="text-sm leading-relaxed text-text">
        {denied ? t('delivery.denied') : t('delivery.appOff')}
      </p>
      <div className="flex flex-wrap gap-3 text-sm font-medium">
        {!denied && canOpenApplications ? (
          <Link href="/applications" className="text-primary hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            {t('delivery.manageApplications')}
          </Link>
        ) : null}
        <Link href={backHref} className="text-primary hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          {t('backToCenter')}
        </Link>
      </div>
    </div>
  );
}
