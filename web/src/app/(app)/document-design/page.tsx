'use client';

import { useTranslations } from 'next-intl';
import { DesignsSettingsCard } from '@/components/settings/designs-settings-card';
import { currentUser } from '@/lib/auth';

/** تصميم المستندات — القالب/الثيم/الشعار/التذييل/الشروط + مصمّم الأقسام بمعاينة حيّة. */
export default function DocumentDesignPage() {
  const t = useTranslations('documentDesign');
  const user = currentUser();
  const canManage = user?.role === 'owner' || user?.role === 'admin';

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
      <DesignsSettingsCard canManage={canManage} />
    </div>
  );
}
