'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CircleAlert, Download, FileBarChart2, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { api, ApiError, downloadFile } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DocumentOperationsNav } from '@/components/documents/document-operations-nav';

type Usage = {
  range: { from: string; to: string }; operations: number; pages: number; input_tokens: number; output_tokens: number; total_tokens: number;
  processing_duration_ms: number; successful_operations: number; failed_attempts: number; cost_available: boolean;
  cost_by_currency: { currency: string; cost_minor: number }[];
  by_provider_model: { provider: string; model: string; operations: number; pages: number; input_tokens: number; output_tokens: number }[];
};

function dateDaysAgo(days: number) { const date = new Date(); date.setDate(date.getDate() - days); return date.toISOString().slice(0, 10); }

export default function DocumentUsagePage() {
  const t = useTranslations('documentOperations');
  const [from, setFrom] = useState(dateDaysAgo(30));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const path = useMemo(() => `/document-usage?${new URLSearchParams({ from, to }).toString()}`, [from, to]);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData((await api<{ data: Usage }>(path)).data); }
    catch (exception) { setError(exception instanceof ApiError ? exception.message : t('loadFailed')); }
    finally { setLoading(false); }
  }, [path, t]);
  useEffect(() => { void load(); }, [load]);

  async function download(pathname: string, filename: string) {
    setNotice(null);
    try {
      const outcome = await downloadFile(pathname, filename);
      if (outcome === 'downloaded') setNotice(t('exported'));
    } catch (exception) { setNotice(exception instanceof ApiError ? exception.message : t('loadFailed')); }
  }

  const cards = data ? [
    ['operations', data.operations], ['pages', data.pages], ['inputTokens', data.input_tokens], ['outputTokens', data.output_tokens],
    ['totalTokens', data.total_tokens], ['duration', `${data.processing_duration_ms} ms`], ['failedAttempts', data.failed_attempts],
  ] as const : [];
  const exportQuery = new URLSearchParams({ from, to }).toString();

  return <div className="space-y-5">
    <header className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between"><div><h1 className="text-xl font-semibold text-text">{t('usageTitle')}</h1><p className="mt-1 text-sm text-muted">{t('usageSubtitle')}</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void download(`/document-usage/export?${exportQuery}`, 'document-usage.csv')}><Download className="h-4 w-4" aria-hidden="true" />{t('exportUsage')}</Button><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="h-4 w-4" aria-hidden="true" />{t('refresh')}</Button></div></header>
    <DocumentOperationsNav />
    <Card><CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-end"><label className="grid gap-1 text-sm text-text"><span>{t('rangeFrom')}</span><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-10 rounded border border-border bg-surface px-3 text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" /></label><label className="grid gap-1 text-sm text-text"><span>{t('rangeTo')}</span><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="h-10 rounded border border-border bg-surface px-3 text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" /></label><Button onClick={() => void load()}>{t('refresh')}</Button></CardContent></Card>
    {notice && <div role="status" className="rounded border border-primary/20 bg-primary-soft px-3 py-2 text-sm text-text">{notice}</div>}
    {loading ? <Card><CardContent className="py-10 text-sm text-muted">{t('loading')}</CardContent></Card> : error ? <Card><CardContent className="flex items-center gap-3 py-10 text-sm text-muted"><CircleAlert className="h-5 w-5" aria-hidden="true" />{error}<Button variant="outline" onClick={() => void load()}>{t('retry')}</Button></CardContent></Card> : data ? <>
      <section aria-label={t('usageTitle')} className="grid grid-cols-2 gap-3 lg:grid-cols-4">{cards.map(([label, value]) => <Card key={label}><CardContent className="py-4"><p className="text-xs text-muted">{t(label)}</p><p className="mt-1 text-xl font-semibold tabular-nums text-text">{value}</p></CardContent></Card>)}</section>
      <Card><CardContent className="py-4"><div className="flex items-center gap-2"><FileBarChart2 className="h-5 w-5 text-primary" aria-hidden="true" /><h2 className="font-medium text-text">{t('cost')}</h2></div>{data.cost_available ? <div className="mt-3 flex flex-wrap gap-2">{data.cost_by_currency.map((cost) => <Badge key={cost.currency} tone="neutral">{cost.currency}: {cost.cost_minor}</Badge>)}</div> : <p className="mt-2 text-sm text-muted">{t('costUnavailable')}</p>}</CardContent></Card>
      <Card><CardContent className="py-4"><h2 className="font-medium text-text">{t('providerModel')}</h2>{data.by_provider_model.length === 0 ? <p className="mt-3 text-sm text-muted">{t('empty')}</p> : <><div className="mt-3 hidden overflow-hidden rounded border border-border md:block"><table className="w-full text-sm"><thead className="bg-surface text-muted"><tr><th className="px-3 py-2 text-start">{t('providerModel')}</th><th className="px-3 py-2 text-start">{t('operations')}</th><th className="px-3 py-2 text-start">{t('pages')}</th><th className="px-3 py-2 text-start">{t('totalTokens')}</th></tr></thead><tbody>{data.by_provider_model.map((row) => <tr key={`${row.provider}:${row.model}`} className="border-t border-border"><td className="px-3 py-2">{row.provider} / {row.model}</td><td className="px-3 py-2 tabular-nums">{row.operations}</td><td className="px-3 py-2 tabular-nums">{row.pages}</td><td className="px-3 py-2 tabular-nums">{row.input_tokens + row.output_tokens}</td></tr>)}</tbody></table></div><div className="mt-3 grid gap-2 md:hidden">{data.by_provider_model.map((row) => <div key={`${row.provider}:${row.model}`} className="rounded border border-border p-3 text-sm"><p className="font-medium text-text">{row.provider} / {row.model}</p><p className="mt-1 text-muted">{t('operations')}: {row.operations} · {t('pages')}: {row.pages}</p></div>)}</div></>}</CardContent></Card>
    </> : null}
  </div>;
}
