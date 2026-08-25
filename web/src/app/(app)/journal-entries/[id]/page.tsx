'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ExternalLink, FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { DetailPage, ErrorState, LoadingState, type PageAction } from '@/components/nebrax';
import { LedgerLinesTable, type LedgerLine } from '@/components/accounting/ledger-lines-table';
import { api, ApiError } from '@/lib/api';

interface JournalEntry {
  id: string;
  number: string;
  entry_date: string;
  description?: string | null;
  status: string;
  entry_kind: 'manual' | 'automatic' | 'reversal';
  source_type?: string | null;
  source_id?: string | null;
  reversal_of?: string | null;
  lines: LedgerLine[];
}

const sourcePath = (sourceType?: string | null, sourceId?: string | null): string | null => {
  if (!sourceType || !sourceId) return null;
  const name = sourceType.split('\\').pop();
  const paths: Record<string, string> = {
    Invoice: '/invoices', Purchase: '/purchases', Payment: '/payments', Expense: '/expenses',
    CreditNote: '/credit-notes', ReturnDocument: '/returns', Asset: '/assets', ManualJournal: '/manual-journals',
  };
  return paths[name ?? ''] ? `${paths[name ?? '']}/${sourceId}` : null;
};

export default function JournalEntryDetailsPage() {
  const t = useTranslations('journalEntries');
  const tc = useTranslations('common');
  const params = useParams<{ id: string }>();
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    api<{ data: JournalEntry }>(`/journal-entries/${params.id}`)
      .then((response) => setEntry(response.data))
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : tc('loadFailed')))
      .finally(() => setLoading(false));
  }, [params.id, tc]);

  useEffect(() => load(), [load]);

  if (loading) return <LoadingState rows={8} label={tc('loading')} />;

  // القيد إمّا حُمِّل أو تعذّر — وفي الحالتين للمستخدم طريقٌ للأمام. الصفحة
  // البيضاء الصامتة التي كانت هنا كانت تترك المستخدم بلا خبرٍ ولا رجوع.
  if (!entry) return <ErrorState message={loadError ?? tc('loadFailed')} onRetry={load} />;

  const source = sourcePath(entry.source_type, entry.source_id);
  const manualSource = entry.entry_kind === 'manual' && source;
  const actions: PageAction[] = source
    ? [
        manualSource
          ? { key: 'open-manual', label: t('openManual'), icon: ExternalLink, href: source, variant: 'primary' }
          : { key: 'view-source', label: t('viewSource'), icon: ExternalLink, href: source, variant: 'outline', emphasis: 'secondary' },
      ]
    : [];

  return (
    <DetailPage
      backHref="/journal-entries"
      backLabel={t('back')}
      title={entry.number}
      badges={
        <Badge tone={entry.entry_kind === 'automatic' ? 'positive' : entry.entry_kind === 'reversal' ? 'negative' : 'muted'}>
          {t(entry.entry_kind)}
        </Badge>
      }
      meta={<><span className="num">{entry.entry_date}</span> · {entry.description || t('noDescription')}</>}
      actions={actions}
      sections={[
        {
          id: 'effect',
          title: t('accountingEffect'),
          content: (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded bg-primary-soft px-3 py-1.5 font-medium text-primary">
                {entry.lines[0]?.account_name ?? t('unknownAccount')}
              </span>
              <span className="text-muted">{t('effectHint')}</span>
              {entry.lines.slice(1).map((line) => (
                <span key={line.id} className="rounded bg-muted px-3 py-1.5 text-text">
                  {line.account_name ?? t('unknownAccount')}
                </span>
              ))}
            </div>
          ),
        },
        {
          id: 'lines',
          title: t('lines'),
          count: entry.lines.length,
          flush: true,
          content: (
            <LedgerLinesTable
              lines={entry.lines}
              labels={{
                account: t('account'),
                description: t('description'),
                debit: t('debit'),
                credit: t('credit'),
                totals: t('totals'),
                unknownAccount: t('unknownAccount'),
              }}
            />
          ),
        },
      ]}
    >
      {entry.reversal_of ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <FileText className="h-5 w-5 shrink-0 text-primary" strokeWidth={1.7} aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-medium text-text">{t('reversalEntry')}</p>
              <p className="num truncate text-sm text-muted">{entry.reversal_of}</p>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </DetailPage>
  );
}
