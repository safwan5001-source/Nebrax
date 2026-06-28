'use client';

import { useTranslations } from 'next-intl';
import { ConfigListEditor } from '@/components/sales-config/config-list-editor';

export default function SourcesPage() {
  const t = useTranslations('salesSettings');
  return (
    <ConfigListEditor
      section="sources"
      title={t('c_sources_t')}
      description={t('c_sources_d')}
      fields={[{ key: 'name', label: t('source_name'), type: 'text' }]}
    />
  );
}
