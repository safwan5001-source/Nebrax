'use client';

import { useTranslations } from 'next-intl';
import { ConfigListEditor } from '@/components/sales-config/config-list-editor';

export default function PriceListsPage() {
  const t = useTranslations('salesSettings');
  return (
    <ConfigListEditor
      section="pricelists"
      title={t('c_pricelists_t')}
      description={t('c_pricelists_d')}
      fields={[
        { key: 'name', label: t('list_name'), type: 'text' },
        { key: 'adjustment', label: t('adjustment_percent'), type: 'number' },
      ]}
    />
  );
}
