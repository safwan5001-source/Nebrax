'use client';

import { useTranslations } from 'next-intl';
import { TaxSettingsCard } from '@/components/settings/tax-settings-card';
import { currentUser } from '@/lib/auth';

export default function TaxSettingsPage() {
  const t = useTranslations('taxSettings');
  const user = currentUser();
  const canManage = user?.role === 'owner' || user?.role === 'admin';

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
      <TaxSettingsCard canManage={canManage} />
    </div>
  );
}
