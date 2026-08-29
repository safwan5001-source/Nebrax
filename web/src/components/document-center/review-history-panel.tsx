'use client';

import { useTranslations } from 'next-intl';
import { History } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import type { ReviewHistory } from '@/modules/document-center/contract';

function auditValue(value: Record<string, string | number | boolean> | null): string {
  if (!value || Object.keys(value).length === 0) return '—';
  return Object.entries(value).map(([key, item]) => `${key}: ${item}`).join(' · ');
}

type Props = {
  history: ReviewHistory[];
};

export function ReviewHistoryPanel({ history }: Props) {
  const t = useTranslations('documentCenterReview');

  return (
    <Card>
      <CardContent className="py-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-text">{t('history')}</h2>
          <History className="h-5 w-5 text-muted" aria-hidden="true" />
        </div>
        {history.length === 0 ? (
          <p className="mt-4 text-sm text-muted">{t('noHistory')}</p>
        ) : (
          <ol className="mt-4 space-y-3">
            {history.map((event) => (
              <li key={event.id} className="rounded border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-text">{event.action}</span>
                  <time className="font-mono text-xs text-muted">{event.occurred_at ?? '—'}</time>
                </div>
                <p className="mt-2 text-muted">{event.actor?.name ?? '—'} · {event.reason ?? '—'}</p>
                <p className="mt-2 text-xs text-muted">{t('originalValue')}: {auditValue(event.before)}</p>
                <p className="mt-1 text-xs text-muted">{t('reviewedValue')}: {auditValue(event.after)}</p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
