'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, ExternalLink, FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { useToast } from '@/components/ui/toast';

interface JournalLine {
  id: string;
  account_code?: string | null;
  account_name?: string | null;
  description?: string | null;
  debit: string;
  credit: string;
}
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
  lines: JournalLine[];
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
  const router = useRouter();
  const { error: toastError } = useToast();
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api<{ data: JournalEntry }>(`/journal-entries/${params.id}`)
      .then((response) => setEntry(response.data))
      .catch((err) => toastError(err instanceof ApiError ? err.message : tc('loadFailed')))
      .finally(() => setLoading(false));
  }, [params.id, tc, toastError]);

  useEffect(() => load(), [load]);

  const totals = useMemo(() => (entry?.lines ?? []).reduce((sum, line) => ({ debit: sum.debit + Number(line.debit || 0), credit: sum.credit + Number(line.credit || 0) }), { debit: 0, credit: 0 }), [entry]);
  if (loading) return <div className="h-72 animate-pulse rounded-md bg-muted" />;
  if (!entry) return null;

  const source = sourcePath(entry.source_type, entry.source_id);
  const manualSource = entry.entry_kind === 'manual' && source;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3"><Button variant="ghost" size="icon" onClick={() => router.push('/journal-entries')} aria-label={t('back')}><ArrowRight className="h-4 w-4" strokeWidth={1.7} /></Button><div><div className="flex items-center gap-2"><h1 className="num text-xl font-semibold text-text">{entry.number}</h1><Badge tone={entry.entry_kind === 'automatic' ? 'positive' : entry.entry_kind === 'reversal' ? 'negative' : 'muted'}>{t(entry.entry_kind)}</Badge></div><p className="mt-1 text-sm text-muted">{entry.entry_date} · {entry.description || t('noDescription')}</p></div></div>
        <div className="flex flex-wrap gap-2">{source && <Link href={source}><Button variant="outline"><ExternalLink className="h-4 w-4" strokeWidth={1.7} />{t('viewSource')}</Button></Link>}{manualSource && <Link href={source}><Button>{t('openManual')}</Button></Link>}</div>
      </div>

      <Card>
        <CardHeader><CardTitle>{t('accountingEffect')}</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2 text-sm"><span className="rounded bg-primary-soft px-3 py-1.5 font-medium text-primary">{entry.lines[0]?.account_name ?? t('unknownAccount')}</span><span className="text-muted">{t('effectHint')}</span>{entry.lines.slice(1).map((line) => <span key={line.id} className="rounded bg-muted px-3 py-1.5 text-text">{line.account_name ?? t('unknownAccount')}</span>)}</CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('lines')}</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0"><table className="min-w-full text-sm"><thead className="border-y border-border bg-muted/40 text-muted"><tr><th className="px-4 py-3 text-start font-medium">{t('account')}</th><th className="px-4 py-3 text-start font-medium">{t('description')}</th><th className="px-4 py-3 text-end font-medium">{t('debit')}</th><th className="px-4 py-3 text-end font-medium">{t('credit')}</th></tr></thead><tbody>{entry.lines.map((line) => <tr key={line.id} className="border-b border-border last:border-0"><td className="px-4 py-3"><span className="num text-muted">{line.account_code}</span> {line.account_name}</td><td className="px-4 py-3 text-muted">{line.description || '—'}</td><td className="num px-4 py-3 text-end text-negative">{Number(line.debit) ? formatRiyal(line.debit) : '—'}</td><td className="num px-4 py-3 text-end text-positive">{Number(line.credit) ? formatRiyal(line.credit) : '—'}</td></tr>)}</tbody><tfoot className="bg-muted/40 font-semibold text-text"><tr><td colSpan={2} className="px-4 py-3">{t('totals')}</td><td className="num px-4 py-3 text-end">{formatRiyal(totals.debit)}</td><td className="num px-4 py-3 text-end">{formatRiyal(totals.credit)}</td></tr></tfoot></table></CardContent>
      </Card>

      {entry.reversal_of && <Card><CardContent className="flex items-center gap-3 p-5"><FileText className="h-5 w-5 text-primary" strokeWidth={1.7} /><div><p className="font-medium text-text">{t('reversalEntry')}</p><p className="num text-sm text-muted">{entry.reversal_of}</p></div></CardContent></Card>}
    </div>
  );
}
