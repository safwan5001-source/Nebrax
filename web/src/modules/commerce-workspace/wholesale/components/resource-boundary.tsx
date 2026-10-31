'use client';

import type { ReactNode } from 'react';
import { useLocale } from 'next-intl';
import { ShieldAlert } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState } from '@/components/nebrax';
import { commonMessages } from '../messages/common';
import type { ResourceState } from '../use-resource';

/**
 * Renders loading / error (with the right wording for permission, network, validation) / ready for one resource.
 * `forbidden` is an access state, not an outage: it explains the permission instead of offering a retry.
 */
export function ResourceBoundary<T>({
  state,
  onRetry,
  loadingVariant = 'table',
  loadingRows = 4,
  children,
}: {
  state: ResourceState<T>;
  onRetry?: () => void;
  loadingVariant?: 'table' | 'cards' | 'metrics';
  loadingRows?: number;
  children: (data: T) => ReactNode;
}) {
  const { t } = commonMessages.forLocale(useLocale());

  if (state.status === 'loading') return <LoadingState variant={loadingVariant} rows={loadingRows} label={t('loading')} />;
  if (state.status === 'error') {
    if (state.kind === 'forbidden') return <EmptyState icon={ShieldAlert} title={t('forbiddenTitle')} description={t('forbiddenServer')} />;
    const message =
      state.kind === 'network' ? t('networkError') : state.kind === 'validation' ? t('validationError') : state.kind === 'not_found' ? t('notFound') : t('loadError');
    return <ErrorState message={message} onRetry={onRetry} retryLabel={t('retry')} />;
  }
  return <>{children(state.data)}</>;
}
