'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, Lock, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { EmptyState, LoadingState } from '@/components/nebrax';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import type { OpeningDocument } from '@/modules/inventory-openings/contract';

export default function InventoryOpeningDetailPage() {
  const t = useTranslations('inventoryOpenings');
  const tc = useTranslations('common');
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { success } = useToast();

  const [document, setDocument] = useState<OpeningDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'post' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api<{ data: OpeningDocument }>(`/inventory-openings/${params.id}`)
      .then((response) => setDocument(response.data))
      .catch(() => setDocument(null))
      .finally(() => setLoading(false));
  }, [params.id]);

  useEffect(() => load(), [load]);

  async function post() {
    // الحارس الأول ضد النقر المزدوج: الزرّ يُعطَّل قبل أي انتظار. والحارس
    // الحقيقي في الخادم (قفل الصفّ وإعادة فحص الحالة داخل المعاملة).
    if (busy !== null) return;
    setBusy('post');
    setError(null);
    try {
      const response = await api<{ data: OpeningDocument }>(`/inventory-openings/${params.id}/post`, {
        method: 'POST',
      });
      setDocument(response.data);
      success(t('posted_success', { number: response.data.number }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (busy !== null) return;
    setBusy('delete');
    setError(null);
    try {
      await api(`/inventory-openings/${params.id}`, { method: 'DELETE' });
      router.push('/inventory-openings');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
      setBusy(null);
    }
  }

  if (loading) return <LoadingState label={tc('loading')} />;
  if (!document) return <EmptyState title={t('not_found')} />;

  const posted = document.status === 'posted';

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start gap-3">
        <Button asChild variant="ghost" size="icon" aria-label={t('back')}>
          <Link href="/inventory-openings">
            <ArrowRight className="h-4 w-4 rtl:rotate-0 ltr:rotate-180" strokeWidth={1.7} />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="num text-xl font-semibold text-text">{document.number}</h1>
            <Badge tone={posted ? 'positive' : 'muted'}>{t(document.status)}</Badge>
          </div>
          <p className="num mt-1 text-sm text-muted">{document.opening_date}</p>
        </div>

        {posted ? (
          <p className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted">
            <Lock className="h-4 w-4" strokeWidth={1.7} />
            {t('posted_immutable')}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void post()} disabled={busy !== null}>
              {busy === 'post' ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.7} />
              ) : (
                <CheckCircle2 className="h-4 w-4" strokeWidth={1.7} />
              )}
              {t('post_action')}
            </Button>
            <Button variant="outline" onClick={() => void remove()} disabled={busy !== null}>
              <Trash2 className="h-4 w-4" strokeWidth={1.7} />
              {t('delete_draft')}
            </Button>
          </div>
        )}
      </header>

      {error ? (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-negative/40 bg-negative/5 p-3 text-sm text-negative">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.7} />
          <span className="leading-relaxed">{error}</span>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('summary')}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <div>
              <dt className="text-xs text-muted">{t('col_quantity')}</dt>
              <dd className="num mt-1 text-lg font-semibold text-text">{document.total_quantity}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{t('col_total')}</dt>
              <dd className="num mt-1 text-lg font-semibold text-text">{formatRiyal(document.total_value)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{t('source_file')}</dt>
              <dd className="mt-1 truncate text-sm text-text">{document.source_filename ?? '—'}</dd>
            </div>
            <div>
              {/* قرارٌ محفوظ على المستند — يُراجَع بعد الترحيل كما يُراجَع قبله. */}
              <dt className="text-xs text-muted">{t('allow_zero_cost')}</dt>
              <dd className="mt-1 text-sm text-text">
                {t(document.allow_zero_cost ? 'zero_cost_on' : 'zero_cost_off')}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{t('journal_entry')}</dt>
              <dd className="num mt-1 text-sm text-text">
                {document.journal_entry_id ? (
                  <Link href={`/journal-entries/${document.journal_entry_id}`} className="text-primary hover:underline">
                    {t('view_entry')}
                  </Link>
                ) : (
                  '—'
                )}
              </dd>
            </div>
          </dl>
          {document.notes ? <p className="mt-3 text-sm leading-relaxed text-muted">{document.notes}</p> : null}
        </CardContent>
      </Card>

      <div className="hidden overflow-x-auto rounded border border-border md:block">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-background text-xs text-muted">
              <th className="p-2 text-start font-medium">#</th>
              <th className="p-2 text-start font-medium">{t('col_sku')}</th>
              <th className="p-2 text-start font-medium">{t('col_product')}</th>
              <th className="p-2 text-start font-medium">{t('col_warehouse')}</th>
              <th className="p-2 text-end font-medium">{t('col_quantity')}</th>
              <th className="p-2 text-end font-medium">{t('col_unit_cost')}</th>
              <th className="p-2 text-end font-medium">{t('col_total')}</th>
            </tr>
          </thead>
          <tbody>
            {(document.lines ?? []).map((line) => (
              <tr key={line.id} className="border-b border-border/60">
                <td className="num p-2 text-muted">{line.position}</td>
                <td className="num p-2 text-text">{line.product_sku ?? '—'}</td>
                <td className="p-2 text-text">{line.product_name ?? '—'}</td>
                <td className="p-2 text-text">{line.warehouse_name ?? '—'}</td>
                <td className="num p-2 text-end text-text">{line.quantity}</td>
                <td className="num p-2 text-end text-text">{formatRiyal(line.unit_cost)}</td>
                <td className="num p-2 text-end text-text">{formatRiyal(line.total_cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-2 md:hidden">
        {(document.lines ?? []).map((line) => (
          <li key={line.id} className="rounded border border-border p-3">
            <p className="truncate text-sm font-medium text-text">{line.product_name ?? line.product_sku ?? '—'}</p>
            <p className="truncate text-xs text-muted">{line.warehouse_name ?? '—'}</p>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div>
                <dt className="text-muted">{t('col_quantity')}</dt>
                <dd className="num text-text">{line.quantity}</dd>
              </div>
              <div>
                <dt className="text-muted">{t('col_total')}</dt>
                <dd className="num text-text">{formatRiyal(line.total_cost)}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
