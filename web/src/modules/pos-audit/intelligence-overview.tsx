'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, ClipboardCheck, ShieldAlert, WalletCards } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { Button } from '@/components/ui/button';
import type { IntelligenceOverview as OverviewData } from './types';

interface Props {
  onOpenExceptions: () => void;
  onOpenRisk: () => void;
}

export function IntelligenceOverviewPanel({ onOpenExceptions, onOpenRisk }: Props) {
  const t = useTranslations('posAudit');
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await api<{ data: OverviewData }>('/pos/audit/intelligence/overview');
      setData(result.data);
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-28 animate-pulse rounded border border-border bg-surface" />
        ))}
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded border border-border bg-surface p-4 text-sm text-muted">
        {loadError}
        <Button variant="outline" size="sm" className="ms-3" onClick={() => void load()}>{t('retry')}</Button>
      </div>
    );
  }

  const cards = [
    { icon: ClipboardCheck, label: t('needsReview'), value: String(data?.needs_review_count ?? 0), onClick: onOpenExceptions },
    { icon: ShieldAlert, label: t('priorityReview'), value: String(data?.priority_count ?? 0), onClick: onOpenExceptions },
    { icon: WalletCards, label: t('amountUnderReview'), value: formatRiyal(data?.amount_under_review ?? '0'), onClick: onOpenExceptions },
    { icon: AlertTriangle, label: t('subjectsNeedingReview'), value: String(data?.subjects_needing_review ?? 0), onClick: onOpenRisk },
  ];

  return (
    <section className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.label}
              onClick={card.onClick}
              className="rounded border border-border bg-surface p-4 text-start transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <Icon className="h-4 w-4 text-muted" strokeWidth={1.6} aria-hidden="true" />
              <p className="mt-4 text-sm text-muted">{card.label}</p>
              <p className="num mt-1 text-2xl font-semibold text-text">{card.value}</p>
            </button>
          );
        })}
      </div>
      <p className="rounded border border-border bg-background p-3 text-xs text-muted">{t('notAccusation')}</p>
    </section>
  );
}
