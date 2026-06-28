'use client';

import { useTranslations } from 'next-intl';
import { ConfigForm } from '@/components/sales-config/config-form';

export default function DesignsSettingsPage() {
  const t = useTranslations('salesSettings');
  return (
    <ConfigForm
      section="designs"
      title={t('c_designs_t')}
      description={t('c_designs_d')}
      fields={[
        {
          key: 'template',
          label: t('dsn_template'),
          type: 'select',
          options: [
            { value: 'classic', label: t('tpl_classic') },
            { value: 'modern', label: t('tpl_modern') },
            { value: 'minimal', label: t('tpl_minimal') },
          ],
        },
        { key: 'accent_color', label: t('dsn_accent'), type: 'color' },
        { key: 'footer_text', label: t('dsn_footer'), type: 'text' },
        { key: 'show_logo', label: t('dsn_show_logo'), type: 'checkbox' },
      ]}
    />
  );
}
