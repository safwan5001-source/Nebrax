'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, ReceiptText, RotateCw } from 'lucide-react';
import { formatDate } from '@/lib/formatting';
import { Button } from '@/components/ui/button';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import type { LiveTemplateRevision } from '@/modules/print-templates/services/live-template-definition';

export interface InvoiceDetailLine {
  id: string;
  product_name?: string | null;
  description: string | null;
  quantity: number;
  unit_name: string | null;
  unit_price: string;
  unit_price_before_tax?: string | null;
  tax_rate: number;
  line_discount: string;
  line_tax: string;
  line_total: string;
}

/**
 * PR-4: شكل استجابة `GET /invoices/{id}` — نفس `InvoiceResource` التي يستهلكها
 * checkout عند البيع (`PosCheckoutInvoice`/R5)، فيصلح تمرير هذا الشكل مباشرة
 * لـ`buildPosReceiptInvoice` دون طبقة تحويل جديدة. **قراءة فقط**: هذا الكيان لا
 * يُعاد حسابه محلياً؛ كل رقم مالي هنا كما أعاده الخادم حرفياً.
 */
export interface InvoiceDetail {
  id: string;
  number: string;
  invoice_date: string | null;
  status: string;
  payment_status: string | null;
  notes: string | null;
  partner?: { id: string; name: string; vat_number: string | null; city: string | null } | null;
  subtotal: string;
  discount: string;
  shipping: string;
  adjustment: string;
  tax_amount: string;
  total: string;
  paid_amount: string;
  remaining: string;
  lines: InvoiceDetailLine[];
  zatca?: { qr: string | null } | null;
  thermal_template_revision?: LiveTemplateRevision | null;
}

const PAYMENT_STATUS_KEYS: Record<string, string> = {
  paid: 'invoice_payment_status_paid',
  unpaid: 'invoice_payment_status_unpaid',
  partial: 'invoice_payment_status_partial',
};

const DOCUMENT_STATUS_KEYS: Record<string, string> = {
  posted: 'invoice_status_posted',
  draft: 'invoice_status_draft',
  cancelled: 'invoice_status_cancelled',
};

/**
 * تفاصيل الفاتورة داخل POS — عرض مستندي/تجاري بحت، مستقل عن معاينة الإيصال
 * (تلك تمثّل مخرَج الطابعة الحرارية الفعلي). لا يبدأ عرض هذه الشاشة أي مرتجع
 * أو استبدال أو تعديلاً على الفاتورة.
 */
export function PosInvoiceDetails({
  invoiceId,
  onBack,
  onPreviewReceipt,
}: {
  invoiceId: string;
  onBack: () => void;
  onPreviewReceipt: (invoice: InvoiceDetail) => void;
}) {
  const t = useTranslations('pos');
  const locale = useLocale();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api<{ data: InvoiceDetail }>(`/invoices/${invoiceId}`);
      setInvoice(result.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('invoice_details_error'));
    } finally {
      setLoading(false);
    }
  }, [invoiceId, t]);

  useEffect(() => { void load(); }, [load]);

  const BackIcon = locale === 'ar' ? ChevronRight : ChevronLeft;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="pos-invoice-details">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2.5 sm:px-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2.5 text-sm font-semibold text-text hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <BackIcon className="h-4 w-4" strokeWidth={1.8} aria-hidden />
          {t('invoice_details_back')}
        </button>
        <h1 className="num truncate text-sm font-bold text-text">{invoice?.number ?? t('invoice_details_title')}</h1>
        {invoice && invoice.status === 'posted' && (
          <Button type="button" size="sm" className="ms-auto" onClick={() => onPreviewReceipt(invoice)}>
            <ReceiptText className="h-4 w-4" strokeWidth={1.7} />
            {t('receipt_preview_action')}
          </Button>
        )}
      </div>

      {loading && (
        <div className="space-y-2 p-3 sm:p-4" data-testid="pos-invoice-details-loading">
          <div className="h-16 animate-pulse rounded-lg border border-border bg-surface" />
          <div className="h-40 animate-pulse rounded-lg border border-border bg-surface" />
        </div>
      )}
      {!loading && error && (
        <div className="p-3 sm:p-4">
          <div className="mx-auto max-w-xl space-y-3 rounded-lg border border-negative/30 bg-negative/10 p-3 text-sm text-text" role="alert">
            <p>{error}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              <RotateCw className="h-4 w-4" strokeWidth={1.7} />
              {t('retry')}
            </Button>
          </div>
        </div>
      )}

      {!loading && !error && invoice && (
        // PR-4 (تصحيح المراجعة): عمود واحد على التابلت/الجوال (كما كان)، وعند
        // lg+ ينقسم إلى منطقة أصناف رئيسية عريضة + ملخّص مالي مضغوط جانبي —
        // يستثمر عرض مساحة عمل POS بدل عمود ضيّق وسط شاشة فارغة.
        <div className="mx-auto grid min-h-0 w-full max-w-6xl flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[1fr_320px]">
          <div className="min-h-0 space-y-3 overflow-y-auto p-3 sm:p-4 lg:border-e lg:border-border">
            <div className="rounded-lg border border-border bg-surface p-3 sm:p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-muted">{t('invoice_details_customer')}</div>
                  <div className="text-sm font-semibold text-text">{invoice.partner?.name ?? t('return_unknown_customer')}</div>
                </div>
                <div className="text-end">
                  <div className="text-xs font-semibold text-muted">{t('invoice_details_status')}</div>
                  <div className="text-sm font-semibold text-text">{t(DOCUMENT_STATUS_KEYS[invoice.status] ?? 'invoice_status_posted')}</div>
                </div>
                <div className="text-end">
                  <div className="text-xs font-semibold text-muted">{invoice.invoice_date ? formatDate(invoice.invoice_date, locale) : '—'}</div>
                  {invoice.payment_status && (
                    <div className="text-sm font-semibold text-text">{t(PAYMENT_STATUS_KEYS[invoice.payment_status] ?? invoice.payment_status)}</div>
                  )}
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-border bg-surface">
              <div className="border-b border-border px-3 py-2 text-xs font-semibold text-muted">{t('invoice_details_items')}</div>

              {/* سطح المكتب: جدول كثيف بأعمدة واضحة. الجوال: قائمة مكدّسة —
                  كما كانت قبل هذا التصحيح، فلا تنكسر على عرض ضيّق. */}
              <div className="hidden md:block">
                <Table>
                  <THead>
                    <TR>
                      <TH>{t('invoice_details_items')}</TH>
                      <TH>{t('quantity')}</TH>
                      <TH>{t('unit_price')}</TH>
                      <TH>{t('discount')}</TH>
                      <TH className="text-end">{t('total')}</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {invoice.lines.map((line) => (
                      <TR key={line.id}>
                        <TD className="max-w-64 truncate font-semibold text-text">{line.description ?? line.product_name ?? '—'}</TD>
                        <TD className="num text-muted">{line.quantity} {line.unit_name ?? ''}</TD>
                        <TD className="num text-muted">{formatRiyal(line.unit_price)}</TD>
                        <TD className="num text-muted">{Number(line.line_discount) > 0 ? `−${formatRiyal(line.line_discount)}` : '—'}</TD>
                        <TD className="num text-end font-bold text-text">{formatRiyal(line.line_total)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>

              <div className="divide-y divide-border md:hidden">
                {invoice.lines.map((line) => (
                  <div key={line.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-text">{line.description ?? line.product_name ?? '—'}</div>
                      <div className="num mt-0.5 text-xs text-muted">
                        {line.quantity} {line.unit_name ?? ''} × {formatRiyal(line.unit_price)}
                        {Number(line.line_discount) > 0 && <span className="text-positive"> · {t('discount')} −{formatRiyal(line.line_discount)}</span>}
                      </div>
                    </div>
                    <div className="num shrink-0 text-sm font-bold text-text">{formatRiyal(line.line_total)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <aside className="space-y-1.5 overflow-y-auto border-t border-border bg-surface p-3 sm:p-4 lg:border-t-0" data-testid="pos-invoice-details-totals">
            <div className="flex justify-between text-sm"><span className="text-muted">{t('subtotal')}</span><span className="num font-semibold text-text">{formatRiyal(invoice.subtotal)}</span></div>
            {Number(invoice.discount) > 0 && <div className="flex justify-between text-sm"><span className="text-muted">{t('discount')}</span><span className="num font-semibold text-positive">−{formatRiyal(invoice.discount)}</span></div>}
            {Number(invoice.shipping) > 0 && <div className="flex justify-between text-sm"><span className="text-muted">{t('invoice_details_shipping')}</span><span className="num font-semibold text-text">{formatRiyal(invoice.shipping)}</span></div>}
            {Number(invoice.adjustment) !== 0 && <div className="flex justify-between text-sm"><span className="text-muted">{t('invoice_details_adjustment')}</span><span className="num font-semibold text-text">{formatRiyal(invoice.adjustment)}</span></div>}
            <div className="flex justify-between text-sm"><span className="text-muted">{t('invoice_details_tax')}</span><span className="num font-semibold text-text">{formatRiyal(invoice.tax_amount)}</span></div>
            <div className="flex items-baseline justify-between border-t border-border pt-2"><span className="text-sm font-semibold text-text">{t('total')}</span><span className="num text-lg font-bold text-text">{formatRiyal(invoice.total)}</span></div>
            <div className="flex justify-between text-xs pt-1"><span className="text-muted">{t('invoice_details_paid')}</span><span className="num text-text">{formatRiyal(invoice.paid_amount)}</span></div>
            {Number(invoice.remaining) > 0 && <div className="flex justify-between text-xs"><span className="text-muted">{t('invoice_details_remaining')}</span><span className="num text-negative">{formatRiyal(invoice.remaining)}</span></div>}
          </aside>
        </div>
      )}
    </div>
  );
}
