'use client';

import { useTranslations } from 'next-intl';
import { ConfigListEditor } from '@/components/sales-config/config-list-editor';

export default function ShippingPage() {
  const t = useTranslations('salesSettings');
  return (
    <ConfigListEditor
      section="shipping"
      title={t('c_shipping_t')}
      description={t('c_shipping_d')}
      fields={[
        { key: 'name', label: t('ship_name'), type: 'text' },
        { key: 'rate', label: t('ship_rate'), type: 'number' },
      ]}
    />
  );
}
