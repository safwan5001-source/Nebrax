'use client';

import { useTranslations } from 'next-intl';
import { ConfigListEditor } from '@/components/sales-config/config-list-editor';

export default function StatusesPage() {
  const t = useTranslations('salesSettings');
  return (
    <ConfigListEditor
      section="statuses"
      title={t('c_statuses_t')}
      description={t('c_statuses_d')}
      fields={[
        { key: 'name', label: t('status_name'), type: 'text' },
        { key: 'color', label: t('status_color'), type: 'color' },
      ]}
    />
  );
}
