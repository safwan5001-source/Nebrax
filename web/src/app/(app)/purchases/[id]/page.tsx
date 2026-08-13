'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, Printer, Eye, EyeOff, Pencil, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { TaxDocument, type Party, type DocLine } from '@/components/documents/tax-document';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { useCompany } from '@/lib/company';

interface Purchase {
  id: string;
  number: string;
  partner_id: string;
  payment_type: string;
  status: string;
  payment_status: string;
  purchase_date: string;
  supplier_invoice_no: string | null;
  subtotal: string;
  tax_amount: string;
  total: string;
  paid_amount: string;
  remaining: string;
  lines: DocLine[];
}

const statusTone: Record<string, 'positive' | 'muted' | 'negative'> = { posted: 'positive', draft: 'muted', cancelled: 'negative' };
const payTone: Record<string, 'positive' | 'warning' | 'muted'> = { paid: 'positive', partial: 'warning', unpaid: 'muted' };

export default function PurchaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('invoiceDetail');
  const tp = useTranslations('purchases');
  const ts = useTranslations('status');
  const company = useCompany();

  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [supplier, setSupplier] = useState<Party | null>(null);
  const [loading, setLoading] = useState(true);
  // المعاينة تُظهر مستند A4 على الشاشة — هو نفسه المطبوع، فلا معاينةٌ تُخالف
  // ما يخرج من الطابعة.
  const [preview, setPreview] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { success, error: errorToast } = useToast();

  async function remove() {
    setDeleting(true);
    try {
      await api(`/purchases/${id}`, { method: 'DELETE' });
      success(tp('deleted'));
      router.push('/purchases');
    } catch (e) {
      errorToast(e instanceof ApiError ? e.message : tp('posted_locked'));
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    api<{ data: Purchase }>(`/purchases/${id}`)
      .then(async (r) => {
        setPurchase(r.data);
        const p = await api<{ data: Party }>(`/partners/${r.data.partner_id}`).catch(() => null);
        if (p) setSupplier(p.data);
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!purchase) return <div className="text-muted">{t('not_found')}</div>;

  const isDraft = purchase.status === 'draft';

  const info: [string, React.ReactNode][] = [
    [tp('supplier'), supplier?.name ?? '—'],
    [t('date'), <span key="d" className="num">{purchase.purchase_date}</span>],
    [t('payment_type'), purchase.payment_type === 'cash' ? t('cash') : t('credit')],
    [tp('total'), <span key="t" className="num font-semibold">{formatRiyal(purchase.total)}</span>],
    [t('paid'), <span key="p" className="num">{formatRiyal(purchase.paid_amount)}</span>],
    [t('remaining'), <span key="r" className="num">{formatRiyal(purchase.remaining)}</span>],
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="no-print" onClick={() => router.push('/purchases')} aria-label={t('back')}>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <h1 className="num text-xl font-semibold text-text">{purchase.number}</h1>
        <Badge tone={statusTone[purchase.status] ?? 'muted'}>{ts(purchase.status)}</Badge>
        <Badge tone={payTone[purchase.payment_status] ?? 'muted'}>{ts(purchase.payment_status)}</Badge>
        {/* المرحّلة لا تُعدَّل ولا تُحذف: لها قيدٌ في الدفتر وحركةُ مخزون
            غيّرت المتوسط المتحرك. الزرّان معطّلان بسبب مكتوب لا مخفيّان. */}
        <div className="no-print ms-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setPreview((v) => !v)}>
            {preview ? <EyeOff className="h-4 w-4" strokeWidth={1.7} /> : <Eye className="h-4 w-4" strokeWidth={1.7} />}
            {preview ? tp('hide_preview') : tp('view')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!isDraft}
            title={isDraft ? tp('edit') : tp('posted_locked')}
            onClick={() => router.push(`/purchases/${purchase.id}/edit`)}
          >
            <Pencil className="h-4 w-4" strokeWidth={1.7} />
            {tp('edit')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!isDraft}
            title={isDraft ? tp('delete') : tp('posted_locked')}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className={`h-4 w-4 ${isDraft ? 'text-negative' : ''}`} strokeWidth={1.7} />
            {tp('delete')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4" strokeWidth={1.7} />
            {t('print')}
          </Button>
        </div>
      </div>

      {!isDraft && (
        <p className="no-print rounded border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-muted">
          {tp('posted_locked')}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('details')}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            {info.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="text-text">{v}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('lines')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR>
                <TH>{t('description')}</TH>
                <TH className="text-end">{t('qty')}</TH>
                <TH className="text-end">{t('unit_price')}</TH>
                <TH className="text-end">{t('tax')}</TH>
                <TH className="text-end">{tp('total')}</TH>
              </TR>
            </THead>
            <TBody>
              {purchase.lines.map((l) => (
                <TR key={l.id}>
                  <TD>{l.description ?? '—'}</TD>
                  <TD className="num text-end">{l.quantity}</TD>
                  <TD className="num text-end">{formatRiyal(l.unit_price)}</TD>
                  <TD className="num text-end">{formatRiyal(l.line_tax)}</TD>
                  <TD className="num text-end">{formatRiyal(l.line_total)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      {/* مستند فاتورة المشتريات A4 — للطباعة دائماً، وعلى الشاشة عند المعاينة */}
      <div className={preview ? 'rounded border border-border bg-surface p-2 [&_.print-only]:block' : undefined}>
      <TaxDocument
        title={tp('doc_title')}
        company={company}
        partyLabel={tp('supplier')}
        party={supplier}
        metaRows={[
          [tp('number'), purchase.number],
          [t('date'), purchase.purchase_date],
          [t('payment_type'), purchase.payment_type === 'cash' ? t('cash') : t('credit')],
        ]}
        lines={purchase.lines}
        subtotal={purchase.subtotal}
        tax={purchase.tax_amount}
        total={purchase.total}
      />
      </div>

      <Dialog open={confirmDelete} onClose={() => (deleting ? null : setConfirmDelete(false))} title={tp('delete_title')}>
        <p className="text-sm text-text">
          {tp('delete_confirm')} <span className="num font-medium">{purchase.number}</span>؟
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={deleting}>{tp('cancel')}</Button>
          <Button variant="danger" onClick={remove} disabled={deleting}>{tp('delete')}</Button>
        </div>
      </Dialog>
    </div>
  );
}
