'use client';

import { useTranslations } from 'next-intl';
import { EmptyState } from '@/components/nebrax';
import { ConsentSettings } from '@/components/intelligence/consent-settings';
import { AiActionsEnablementCard } from '@/modules/ai-actions/enablement-card';
import { useCan } from '@/lib/use-can';
import { currentUser } from '@/lib/auth';

export default function IntelligenceSettingsPage() {
  const t = useTranslations('intelligence.settings');
  const { can, hydrated } = useCan();
  if (!hydrated) return null;
  const canConsent = can('ai.consent.manage');
  const canActions = can('ai.actions.manage');
  if (!canConsent && !canActions) {
    return <EmptyState titleAs="h1" title={t('denied_title')} description={t('denied_body')} />;
  }
  return (
    <div className="space-y-6">
      {canConsent ? <ConsentSettings /> : null}
      {canActions ? <AiActionsEnablementCard canManage isOwner={currentUser()?.role === 'owner' && can('ai.actions.execution_approve')} /> : null}
    </div>
  );
}
