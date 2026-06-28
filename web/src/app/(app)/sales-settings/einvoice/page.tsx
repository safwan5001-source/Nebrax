'use client';

import { useTranslations } from 'next-intl';
import { ConfigForm } from '@/components/sales-config/config-form';

export default function EInvoiceSettingsPage() {
  const t = useTranslations('salesSettings');
  return (
    <ConfigForm
      section="einvoice"
      title={t('c_einvoice_t')}
      description={t('c_einvoice_d')}
      fields={[
        { key: 'enabled', label: t('ein_enabled'), type: 'checkbox' },
        {
          key: 'phase',
          label: t('ein_phase'),
          type: 'select',
          options: [
            { value: '1', label: t('ein_phase1') },
            { value: '2', label: t('ein_phase2') },
          ],
        },
        { key: 'vat_number', label: t('ein_vat'), type: 'text' },
      ]}
    />
  );
}
