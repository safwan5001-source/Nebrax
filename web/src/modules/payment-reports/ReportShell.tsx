'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/nebrax';
import type { ReportError } from './useReport';

/** حالات التحميل والخطأ الموحَّدة لكل تقرير؛ `children` تُعرض فقط عند وجود بيانات. */
export function ReportShell({ loading, error, onRetry, hasData, children }: { loading: boolean; error: ReportError | null; onRetry: () => void; hasData: boolean; children: ReactNode }) {
  const t = useTranslations('paymentReports');
  if (error === 'branch_scope_forbidden') {
    return <EmptyState title={t('branch_scope_title')} description={t('branch_scope_desc')} />;
  }
  if (error === 'forbidden') return <EmptyState title={t('forbidden')} />;
  if (error === 'failed') {
    return (
      <div role="alert" className="space-y-2 rounded border border-negative/30 bg-negative/5 p-4 text-sm text-negative">
        <p>{t('load_failed')}</p>
        <Button size="sm" variant="outline" onClick={onRetry}>{t('retry')}</Button>
      </div>
    );
  }
  if (loading && !hasData) return <p role="status" className="text-sm text-muted">{t('loading')}</p>;
  return <>{children}</>;
}

export function Stat({ label, children, tone }: { label: string; children: ReactNode; tone?: 'positive' | 'negative' }) {
  return (
    <div className="min-w-0 rounded border border-border bg-surface p-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`mt-1 truncate text-base font-semibold ${tone === 'positive' ? 'text-positive' : tone === 'negative' ? 'text-negative' : ''}`}>{children}</dd>
    </div>
  );
}
