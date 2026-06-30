'use client';

import { useTranslations } from 'next-intl';
import { ConfigForm } from '@/components/sales-config/config-form';

export default function PosSettingsPage() {
  const t = useTranslations('posSettings');
  return (
    <ConfigForm
      section="pos"
      backHref="/pos"
      title={t('title')}
      description={t('subtitle')}
      fields={[
        { key: 'default_customer', label: t('default_customer'), type: 'text' },
        { key: 'receipt_footer', label: t('receipt_footer'), type: 'text' },
        { key: 'print_receipt', label: t('print_receipt'), type: 'checkbox' },
        { key: 'allow_discount', label: t('allow_discount'), type: 'checkbox' },
      ]}
    />
  );
}
