'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { IngressManagement } from './use-ingress-management';

/** حالة ملف الإسناد اليدوي للمنصة كما قرأتها الصفحة: الإنشاء يحتاج ملفاً **مفعّلاً** ولا ينشئ ملفاً. */
export type IngressProfileSupport = {
  state: 'ready' | 'missing' | 'disabled' | 'unreadable';
  /** `company.manage`: وحده يملك صفحة الإعداد القائمة. بدونها تُعرض العلّة بلا رابط. */
  canSetup: boolean;
};

/**
 * مدخل إنشاء نقطة استقبال (INT-UX-5c). مع ملف إسناد يدوي مفعّل: زرّ «إنشاء». بدونه: **حالة إرشادية** برابط إلى شاشة
 * الإعداد القائمة (`/delivery-platforms`) لمن يملك الصلاحية — لا ينشئ هذا الملف ملف منصة ولا يعدّله. إن تعذّرت قراءة الملف:
 * لا زرّ (الفشل ليس «لا ملف»).
 */
export function IngressCreateEntry({ profile, management, platformName }: { profile: IngressProfileSupport; management: IngressManagement; platformName: string }) {
  const t = useTranslations('integrationCenter.ingressManagement.create');

  if (profile.state === 'ready') {
    return (
      <div data-testid="ingress-create-entry">
        <Button type="button" variant="outline" size="sm" className="min-h-11 md:min-h-8" onClick={management.openCreate} data-testid="ingress-create-open">
          {t('open')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-1 rounded border border-dashed border-border px-3 py-2 text-sm leading-relaxed text-muted" data-testid="ingress-create-guidance" data-state={profile.state}>
      <p className="font-medium text-text">{t('guidance.title')}</p>
      <p>{t(`guidance.${profile.state}`, { platform: platformName })}</p>
      {profile.state !== 'unreadable' ? (
        profile.canSetup ? (
          <Link href="/delivery-platforms" className="font-medium text-primary hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            {t('guidance.setupLink')}
          </Link>
        ) : (
          <p data-testid="ingress-create-setup-needs-permission">{t('guidance.needsPermission')}</p>
        )
      ) : null}
    </div>
  );
}
