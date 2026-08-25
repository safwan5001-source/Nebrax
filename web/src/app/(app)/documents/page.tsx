'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CircleAlert, FileSearch, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { api, ApiError } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type Batch = { id: string; batch_number?: string; document_type: string; status: string; version: number; created_at: string; files_count?: number };
export default function DocumentsPage() {
  const t = useTranslations('documentCenterReview');
  const [batches, setBatches] = useState<Batch[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const [query, setQuery] = useState('');
  const load = useCallback(() => { setLoading(true); setError(null); const params = new URLSearchParams(); if (query.trim()) params.set('search', query.trim()); api<{ data: Batch[] }>(`/document-batches?${params.toString()}`).then((r) => setBatches(r.data)).catch((e) => setError(e instanceof ApiError ? e.message : t('loadFailed'))).finally(() => setLoading(false)); }, [query, t]);
  useEffect(() => { const timer = window.setTimeout(load, 250); return () => window.clearTimeout(timer); }, [load]);
  const visible = batches;
  const status = (value: string) => <Badge tone={value === 'ready_for_draft' ? 'positive' : 'warning'}>{value === 'ready_for_draft' ? t('readyForDraft') : t('needsReview')}</Badge>;
  return <div className="space-y-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="text-xl font-semibold text-text">{t('title')}</h1><p className="mt-1 text-sm text-muted">{t('subtitle')}</p></div><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('search')} className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:w-80" /></div>{loading ? <Card><CardContent className="py-10 text-sm text-muted">{t('loading')}</CardContent></Card> : error ? <Card><CardContent className="flex items-center gap-3 py-10 text-sm text-muted"><CircleAlert className="h-5 w-5" aria-hidden="true" />{error}<Button variant="outline" onClick={load}><RefreshCw className="h-4 w-4" aria-hidden="true" />{t('retry')}</Button></CardContent></Card> : visible.length === 0 ? <Card><CardContent className="flex items-center gap-3 py-10 text-sm text-muted"><FileSearch className="h-5 w-5" aria-hidden="true" />{t('empty')}</CardContent></Card> : <><div className="hidden overflow-hidden rounded-md border border-border md:block"><table className="w-full text-sm"><thead className="bg-surface text-muted"><tr><th className="px-4 py-3 text-start">{t('batch')}</th><th className="px-4 py-3 text-start">{t('documentType')}</th><th className="px-4 py-3 text-start">{t('status')}</th><th className="px-4 py-3 text-end">{t('review')}</th></tr></thead><tbody>{visible.map((b) => <tr key={b.id} className="border-t border-border"><td className="px-4 py-3 font-mono">{b.batch_number ?? b.id.slice(0, 8)}</td><td className="px-4 py-3">{b.document_type}</td><td className="px-4 py-3">{status(b.status)}</td><td className="px-4 py-3 text-end"><Button asChild size="sm"><Link href={`/documents/${b.id}`}>{t('review')}</Link></Button></td></tr>)}</tbody></table></div><div className="grid gap-3 md:hidden">{visible.map((b) => <Card key={b.id}><CardContent className="space-y-3 py-4"><div className="flex items-center justify-between"><span className="font-mono text-sm">{b.batch_number ?? b.id.slice(0, 8)}</span>{status(b.status)}</div><p className="text-sm text-muted">{b.document_type}</p><Button asChild className="w-full"><Link href={`/documents/${b.id}`}>{t('review')}</Link></Button></CardContent></Card>)}</div></>}</div>;
}
