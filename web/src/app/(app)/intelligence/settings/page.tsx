'use client';

import { useTranslations } from 'next-intl';
import { EmptyState } from '@/components/nebrax';
import { ConsentSettings } from '@/components/intelligence/consent-settings';
import { useCan } from '@/lib/use-can';

export default function IntelligenceSettingsPage() {
  const t = useTranslations('intelligence.settings');
  const { can, hydrated } = useCan();
  if (!hydrated) return null;
  if (!can('ai.consent.manage')) {
    return <EmptyState titleAs="h1" title={t('denied_title')} description={t('denied_body')} />;
  }
  return <ConsentSettings />;
}
