'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CalendarClock, ChevronLeft, Lock, Network, Route, type LucideIcon } from 'lucide-react';
import { EmptyState, LoadingState } from '@/components/nebrax';
import { currentUser } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';

/**
 * ACC-1: مركز إعدادات المحاسبة — واجهة تعريفية فقط، بلا أي أثر محاسبي أو
 * سلوك ترحيل جديد. «مراكز التكلفة» وحدها رابط حقيقي؛ البقية «قريباً» دون
 * أي عنصر تحكم وهمي (design-system/foundations/configurable-policies.md).
 */
interface AccountingSettingItem {
  key: string;
  href: string | null;
  icon: LucideIcon;
}

const ITEMS: AccountingSettingItem[] = [
  // ACC-2: بنية تحتية فقط (بلا مستهلك ترحيل) — الرابط حقيقي الآن.
  { key: 'c_accountRouting', href: '/accounting-settings/account-routing', icon: Route },
  { key: 'c_costCenters', href: '/cost-centers', icon: Network },
  { key: 'c_fiscalPeriods', href: null, icon: CalendarClock },
  { key: 'c_periodLocks', href: null, icon: Lock },
];

/**
 * بوابة صلاحية على مستوى الصفحة كاملة — نفس نمط `DeveloperGate`: إخفاء
 * الشريط الجانبي وحده ليس تفويضاً؛ الوصول المباشر بالرابط يُفحص هنا أيضاً
 * بمرآة `Rbac::allows` نفسها (`hasPermission`). الربط بـ`mounted` يمنع
 * وميض «ممنوع» قبل تركيب جلسة `localStorage` في هذه الصفحات `use client`.
 */
function useAccountingSettingsAccess(): { mounted: boolean; canView: boolean } {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const user = currentUser();
  return { mounted, canView: hasPermission(user?.permissions, user?.role, 'accounting_settings.view') };
}

export default function AccountingSettingsPage() {
  const t = useTranslations('accountingSettings');
  const tn = useTranslations('nav');
  const { mounted, canView } = useAccountingSettingsAccess();

  if (!mounted) return <LoadingState variant="cards" rows={4} />;

  if (!canView) {
    return <EmptyState icon={Lock} title={t('forbidden')} description={t('forbiddenHint')} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('hubSubtitle')}</p>
      </div>

      <section className="space-y-3" aria-labelledby="accounting-settings-heading">
        <h2 id="accounting-settings-heading" className="text-sm font-medium text-muted">{t('groupSetup')}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ITEMS.map((item) => {
            const Icon = item.icon;
            const body = (
              <>
                <Icon className="h-6 w-6 shrink-0 text-primary" strokeWidth={1.6} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-text">{t(`${item.key}_t`)}</h3>
                    {!item.href && (
                      <span className="shrink-0 rounded bg-border px-1.5 py-0.5 text-[10px] font-normal text-muted">
                        {tn('soon')}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{t(`${item.key}_d`)}</p>
                </div>
                {item.href && <ChevronLeft className="mt-1 h-4 w-4 shrink-0 text-muted" strokeWidth={1.7} />}
              </>
            );

            return item.href ? (
              <Link
                key={item.key}
                href={item.href}
                className="flex gap-3 rounded border border-border bg-surface p-4 transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {body}
              </Link>
            ) : (
              <div key={item.key} className="flex gap-3 rounded border border-border bg-surface p-4 opacity-70">
                {body}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
