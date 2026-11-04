'use client';

import { useTranslations } from 'next-intl';
import { ConfigForm } from '@/components/sales-config/config-form';
import { NotAppliedNotice } from '@/components/sales-config/not-applied-notice';

export default function SalesOrderSettingsPage() {
  const t = useTranslations('salesSettings');
  return (
    <div className="space-y-4">
      <NotAppliedNotice />
      <ConfigForm
        section="orders"
        title={t('c_orders_t')}
        description={t('c_orders_d')}
        fields={[
          { key: 'prefix', label: t('ord_prefix'), type: 'text' },
          { key: 'auto_convert', label: t('ord_auto'), type: 'checkbox' },
          { key: 'require_approval', label: t('ord_approval'), type: 'checkbox' },
        ]}
      />
    </div>
  );
}
