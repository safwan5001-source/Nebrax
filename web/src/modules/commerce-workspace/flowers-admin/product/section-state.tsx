'use client';

import { Clock, Gift } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState } from '@/components/nebrax';
import type { AdminFailure } from '../admin-http';
import { failureText } from '../failure-text';
import type { FlowersAdminT } from '../messages';

/** حالات التحميل/الفشل/عدم الصلاحية المشتركة لأقسام مساحة المنتج — صياغة واحدة وإعادة محاولة صريحة. */
export function SectionState({
  phase,
  t,
  onRetry,
  icon = 'gift',
}: {
  phase: { kind: 'loading' } | { kind: 'failed'; failure: AdminFailure };
  t: FlowersAdminT;
  onRetry: () => void;
  icon?: 'gift' | 'clock';
}) {
  if (phase.kind === 'loading') return <LoadingState variant="table" rows={3} label={t('loading')} />;
  const Icon = icon === 'clock' ? Clock : Gift;

  return phase.failure.kind === 'forbidden' || phase.failure.kind === 'not_found' ? (
    <EmptyState icon={Icon} title={phase.failure.kind === 'not_found' ? t('productNotFound') : t('forbidden')} />
  ) : (
    <ErrorState message={failureText(phase.failure, t, 'load')} retryLabel={t('retry')} onRetry={onRetry} />
  );
}
