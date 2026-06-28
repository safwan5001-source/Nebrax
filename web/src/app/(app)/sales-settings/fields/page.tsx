'use client';

import { useTranslations } from 'next-intl';
import { ConfigListEditor } from '@/components/sales-config/config-list-editor';

export default function FieldsPage() {
  const t = useTranslations('salesSettings');
  return (
    <ConfigListEditor
      section="fields"
      title={t('c_fields_t')}
      description={t('c_fields_d')}
      fields={[
        { key: 'label', label: t('field_label'), type: 'text' },
        {
          key: 'type',
          label: t('field_type'),
          type: 'select',
          options: [
            { value: 'text', label: t('opt_text') },
            { value: 'number', label: t('opt_number') },
            { value: 'date', label: t('opt_date') },
          ],
        },
      ]}
    />
  );
}
