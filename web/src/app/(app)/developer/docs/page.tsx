'use client';

import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/nebrax';
import { DeveloperGate, useDeveloperAccess } from '@/components/developer/developer-shell';
import { DocsExplorer } from '@/components/developer/docs/docs-explorer';

export default function DeveloperDocsPage() {
  const access = useDeveloperAccess();
  const t = useTranslations('developer.docs');

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description')} />
      <DeveloperGate access={access}>
        <DocsExplorer />
      </DeveloperGate>
    </div>
  );
}
