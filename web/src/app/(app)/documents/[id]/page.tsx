'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AlertTriangle, ArrowRight, FileText } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type Review = { batch: { id: string; status: string; version: number }; reviewed: { fields?: Record<string, unknown>; lines?: Record<string, unknown>[] }; matches: { id: string; subject_key: string; status: string; score_basis_points: number }[]; issues: { id: string; code: string; severity: string; status: string; safe_message: string }[] };
export default function DocumentReviewPage() {
 const t = useTranslations('documentCenterReview'); const { id } = useParams<{ id: string }>(); const [review, setReview] = useState<Review | null>(null); const [error, setError] = useState<string | null>(null);
 useEffect(() => { api<{ data: Review }>(`/document-batches/${id}/review`).then((r) => setReview(r.data)).catch((e) => setError(e instanceof ApiError ? e.message : t('loadFailed'))); }, [id, t]);
 if (error) return <Card><CardContent className="py-10 text-sm text-muted">{error}</CardContent></Card>;
 if (!review) return <Card><CardContent className="py-10 text-sm text-muted">{t('loading')}</CardContent></Card>;
 const fields = Object.entries(review.reviewed.fields ?? {}); return <div className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><Button asChild variant="ghost" size="sm"><Link href="/documents"><ArrowRight className="h-4 w-4" aria-hidden="true" />{t('back')}</Link></Button><h1 className="mt-2 text-xl font-semibold text-text">{t('reviewTitle')}</h1></div><div className="flex items-center gap-2"><Badge tone="warning">{t('needsReview')}</Badge><span className="font-mono text-xs text-muted">{t('version', { version: review.batch.version })}</span><Button disabled>{t('completeReview')}</Button></div></div><div className="grid gap-5 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]"><Card><CardContent className="flex min-h-72 flex-col items-center justify-center gap-3 py-8 text-center text-sm text-muted"><FileText className="h-8 w-8" aria-hidden="true" /><p>{t('noPreview')}</p></CardContent></Card><div className="space-y-5"><Card><CardContent className="py-5"><h2 className="font-semibold text-text">{t('data')}</h2><dl className="mt-4 grid gap-3 sm:grid-cols-2">{fields.map(([key, value]) => <div key={key} className="border-b border-border pb-2"><dt className="text-xs text-muted">{key}</dt><dd className="mt-1 break-words font-mono text-sm text-text">{String(value ?? '—')}</dd></div>)}</dl></CardContent></Card><Card><CardContent className="py-5"><h2 className="font-semibold text-text">{t('matches')}</h2><div className="mt-4 space-y-2">{review.matches.map((m) => <div key={m.id} className="flex items-center justify-between border-b border-border pb-2 text-sm"><span>{m.subject_key}</span><span className="flex items-center gap-2"><span className="font-mono text-muted">{m.score_basis_points}</span><Badge tone={m.status === 'confirmed' ? 'positive' : 'warning'}>{t(m.status as 'confirmed' | 'suggested' | 'rejected')}</Badge></span></div>)}</div></CardContent></Card><Card><CardContent className="py-5"><h2 className="font-semibold text-text">{t('issuesTitle')}</h2><div className="mt-4 space-y-2">{review.issues.map((issue) => <div key={issue.id} className="flex gap-2 border-b border-border pb-2 text-sm"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" /><div><p className="font-medium text-text">{issue.code}</p><p className="text-muted">{issue.safe_message}</p></div></div>)}</div></CardContent></Card></div></div></div>;
}
