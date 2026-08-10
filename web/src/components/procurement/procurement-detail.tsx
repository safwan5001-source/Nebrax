'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { ArrowLeftRight, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { RevisionLog } from '@/components/documents/revision-log';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import {
  NEXT_STATUSES,
  NEXT_TARGETS,
  PROCUREMENT_ROUTE,
  canConvert,
  statusTone,
  type ProcurementStatus,
  type ProcurementType,
} from '@/lib/procurement';

interface Line {
  id: string; description: string | null; quantity: number;
  unit_price: string; tax_rate: number; line_tax: string; line_total: string;
}
interface Doc {
  id: string; type: ProcurementType; number: string; partner_id: string | null; partner_name?: string | null;
  status: ProcurementStatus; doc_date: string; due_date: string | null; requested_by: string | null;
  subtotal: string; tax_amount: string; total: string; notes: string | null;
  source_document_id: string | null; source_number?: string | null; source_type?: ProcurementType | null;
  converted_purchase_id: string | null;
  supplier_ids?: string[]; lines: Line[];
}

/**
 * تفاصيل مستند شراء + شريط إجراءاته.
 *
 * الأزرار المعروضة مشتقّة من `NEXT_STATUSES`/`NEXT_TARGETS` — مرآة قواعد
 * الخادم — فلا يُعرَض إجراء يرفضه. الخادم يبقى الحارس؛ هذه واجهة تُجنّب
 * المستخدم اكتشاف المنع بـ 422.
 */
export function ProcurementDetail({ type }: { type: ProcurementType }) {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('procurement');
  const tc = useTranslations('common');
  const { success, error: errorToast } = useToast();

  const [doc, setDoc] = useState<Doc | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api<{ data: Doc }>(`/procurement/${id}`)
      .then((r) => setDoc(r.data))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => load(), [load]);

  async function move(status: ProcurementStatus) {
    setBusy(true);
    try {
      await api(`/procurement/${id}/transition`, { method: 'POST', body: { status } });
      success(tc('updated'));
      load();
    } catch (e) {
      errorToast(e instanceof ApiError ? e.message : tc('saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function convert(target: string) {
    setBusy(true);
    try {
      const created = await api<{ data: { id: string } }>(`/procurement/${id}/convert`, {
        method: 'POST',
        body: { target, partner_id: doc?.partner_id ?? undefined },
      });
      success(tc('created'));
      // فاتورة المشتريات تعيش خارج دورة الشراء — لها شاشتها.
      router.push(target === 'purchase'
        ? `/purchases/${created.data.id}`
        : `${PROCUREMENT_ROUTE[target as ProcurementType]}/${created.data.id}`);
    } catch (e) {
      errorToast(e instanceof ApiError ? e.message : tc('saveFailed'));
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-40 w-full" /></div>;
  }
  if (!doc) return <div className="text-muted">{t('not_found')}</div>;

  const route = PROCUREMENT_ROUTE[type];
  const info: [string, React.ReactNode][] = [
    ...(doc.partner_name ? [[t('supplier'), doc.partner_name] as [string, React.ReactNode]] : []),
    ...(doc.requested_by ? [[t('requested_by'), doc.requested_by] as [string, React.ReactNode]] : []),
    [t('date'), <span key="d" className="num">{doc.doc_date}</span>],
    ...(doc.due_date ? [[t(`${type}.due_label`), <span key="u" className="num">{doc.due_date}</span>] as [string, React.ReactNode]] : []),
    [t('total'), <span key="t" className="num font-semibold">{formatRiyal(doc.total)}</span>],
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push(route)} aria-label={t('back')}>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <h1 className="num text-xl font-semibold text-text">{doc.number}</h1>
        <Badge tone={statusTone(doc.status)}>{t(`status_${doc.status}`)}</Badge>

        <div className="ms-auto flex flex-wrap gap-2">
          {NEXT_STATUSES[doc.status].map((next) => (
            <Button
              key={next}
              size="sm"
              variant={next === 'cancelled' || next === 'rejected' ? 'outline' : 'primary'}
              disabled={busy}
              onClick={() => move(next)}
            >
              {t(`action_${next}`)}
            </Button>
          ))}

          {canConvert(doc.status) && NEXT_TARGETS[type].map((target) => (
            <Button key={target} size="sm" disabled={busy} onClick={() => convert(target)}>
              <ArrowLeftRight className="h-4 w-4" strokeWidth={1.7} />
              {t(`convert_to_${target}`)}
            </Button>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>{t('details')}</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {info.map(([label, value]) => (
              <div key={label} className="space-y-0.5">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="text-sm text-text">{value}</dd>
              </div>
            ))}
          </dl>
          {doc.notes && <p className="mt-3 text-sm text-muted">{doc.notes}</p>}

          {/* سلسلة التتبّع: من أين جاء هذا المستند، وإلى أين انتهى. */}
          {(doc.source_document_id || doc.converted_purchase_id) && (
            <div className="mt-3 flex flex-wrap gap-4 border-t border-border pt-3 text-xs">
              {doc.source_document_id && doc.source_type && (
                <span className="text-muted">
                  {t('source')}:{' '}
                  <Link
                    href={`${PROCUREMENT_ROUTE[doc.source_type]}/${doc.source_document_id}`}
                    className="num text-primary hover:underline"
                  >
                    {doc.source_number ?? doc.source_document_id.slice(0, 8)}
                  </Link>
                </span>
              )}
              {doc.converted_purchase_id && (
                <Link href={`/purchases/${doc.converted_purchase_id}`} className="text-primary hover:underline">
                  {t('converted_purchase')}
                </Link>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('lines')}</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-xs text-muted">
              <tr>
                <th className="p-3 text-start font-normal">{t('description')}</th>
                <th className="p-3 text-end font-normal">{t('qty')}</th>
                <th className="p-3 text-end font-normal">{t('unit_cost')}</th>
                <th className="p-3 text-end font-normal">{t('tax_total')}</th>
                <th className="p-3 text-end font-normal">{t('total')}</th>
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((l) => (
                <tr key={l.id} className="border-b border-border last:border-0">
                  <td className="p-3 text-text">{l.description ?? '—'}</td>
                  <td className="num p-3 text-end">{l.quantity}</td>
                  <td className="num p-3 text-end">{formatRiyal(l.unit_price)}</td>
                  <td className="num p-3 text-end text-muted">{formatRiyal(l.line_tax)}</td>
                  <td className="num p-3 text-end">{formatRiyal(l.line_total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="text-sm">
              <tr>
                <td colSpan={3} />
                <td className="p-3 text-end text-muted">{t('subtotal')}</td>
                <td className="num p-3 text-end">{formatRiyal(doc.subtotal)}</td>
              </tr>
              <tr>
                <td colSpan={3} />
                <td className="p-3 text-end text-muted">{t('tax_total')}</td>
                <td className="num p-3 text-end">{formatRiyal(doc.tax_amount)}</td>
              </tr>
              <tr className="border-t border-border">
                <td colSpan={3} />
                <td className="p-3 text-end font-semibold text-text">{t('total')}</td>
                <td className="num p-3 text-end text-lg font-bold text-text">{formatRiyal(doc.total)}</td>
              </tr>
            </tfoot>
          </table>
        </CardContent>
      </Card>

      {/* سجلّ التغييرات — نفس المكوّن، بنوع المستند فقط. */}
      <RevisionLog type="procurement" id={id} />
    </div>
  );
}
