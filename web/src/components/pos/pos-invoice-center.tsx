'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CalendarClock, ChevronLeft, ChevronRight, ReceiptText, RotateCw, Search, UserRound } from 'lucide-react';
import { formatDate, formatDateTime } from '@/lib/formatting';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { cn } from '@/lib/utils';
import { filterPosCenterInvoices, type PosCenterInvoice } from '@/lib/pos-invoice-center';

const PAYMENT_STATUS_TONE: Record<string, string> = {
  paid: 'text-positive',
  unpaid: 'text-negative',
  partial: 'text-warning',
};

// PR-8: نفس مفاتيح الترجمة المستعملة فعلاً في `pos-invoice-details.tsx` — كانت
// هذه القائمة تعرض رمز الحالة الخام من الخادم (`paid`/`unpaid`) بلا ترجمة،
// بينما تفاصيل الفاتورة تترجمه بشكل صحيح؛ توحيدٌ لا تصميمٌ جديد.
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
 * PR-4: مركز الفواتير — تطوير لِـ«آخر الفواتير» (كانت نافذة منبثقة تُحيل إلى
 * صفحة ERP خارج نقطة البيع) إلى مساحة عمل حقيقية داخل POS. نفس مصدر البيانات
 * (`GET /pos/recent-invoices`، فواتير POS للفرع النشط فقط) ونفس بنية العنصر
 * الأساسية، لكن الآن لوحة ثابتة تفتح تفاصيل الفاتورة داخل POS بدل رابط خارجي،
 * مع بحث محلي فوق القائمة المحمَّلة. لا تغيّر السلة النشطة ولا الجلسة ولا العميل.
 *
 * PR-4 (تصحيح المراجعة): جدول كثيف على سطح المكتب (`Table` الموحّد نفسه
 * المستخدم في شاشات الفواتير/التقارير) بدل تكديس بطاقات كبيرة في مساحة
 * فارغة — يستثمر عرض مساحة العمل ويتيح مسحاً بصرياً سريعاً لعدد أكبر من
 * الفواتير. الجوال يحتفظ ببطاقاته المدمجة كما كانت (كانت مناسبة أصلاً).
 */
export function PosInvoiceCenter({ onOpenInvoice, onBack }: { onOpenInvoice: (id: string) => void; onBack: () => void }) {
  const t = useTranslations('pos');
  const locale = useLocale();
  const [invoices, setInvoices] = useState<PosCenterInvoice[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api<{ data: PosCenterInvoice[] }>('/pos/recent-invoices?limit=50');
      setInvoices(result.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('recent_invoices_error'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const visible = filterPosCenterInvoices(invoices, query);
  const BackIcon = locale === 'ar' ? ChevronRight : ChevronLeft;

  function dateLabel(invoice: PosCenterInvoice) {
    const value = invoice.created_at ?? invoice.invoice_date;
    if (!value) return '—';
    return invoice.created_at ? formatDateTime(value, locale) : formatDate(value, locale);
  }

  function statusLabel(invoice: PosCenterInvoice) {
    if (invoice.payment_status) return t(PAYMENT_STATUS_KEYS[invoice.payment_status] ?? invoice.payment_status);
    return t(DOCUMENT_STATUS_KEYS[invoice.status] ?? invoice.status);
  }

  function statusTone(invoice: PosCenterInvoice) {
    return (invoice.payment_status && PAYMENT_STATUS_TONE[invoice.payment_status]) || 'text-muted';
  }

  const showEmpty = !loading && !error && (invoices.length === 0 || visible.length === 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="pos-invoice-center">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2.5 sm:px-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2.5 text-sm font-semibold text-text hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <BackIcon className="h-4 w-4" strokeWidth={1.8} aria-hidden />
          {t('invoice_center_back')}
        </button>
        <h1 className="text-sm font-bold text-text">{t('recent_pos_invoices')}</h1>
        <div className="relative ms-auto min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" strokeWidth={1.7} aria-hidden />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('invoice_center_search_placeholder')}
            aria-label={t('invoice_center_search_placeholder')}
            className="h-11 ps-9"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
        {loading && (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-11 animate-pulse rounded-md border border-border bg-surface" />
            ))}
          </div>
        )}
        {!loading && error && (
          <div className="mx-auto max-w-xl space-y-3 rounded-lg border border-negative/30 bg-negative/10 p-3 text-sm text-text" role="alert">
            <p>{error}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              <RotateCw className="h-4 w-4" strokeWidth={1.7} />
              {t('retry')}
            </Button>
          </div>
        )}
        {showEmpty && (
          <div className="mx-auto max-w-xl rounded-lg border border-dashed border-border bg-surface px-4 py-10 text-center text-sm text-muted" data-testid="pos-invoice-center-empty">
            {t('recent_invoices_empty')}
          </div>
        )}

        {!loading && !error && !showEmpty && (
          <>
            {/* سطح المكتب: جدول كثيف — مسح بصري سريع لعدد أكبر من الفواتير.
                عرض مقيَّد (لا يمتد لعرض مساحة العمل كاملةً) فلا تتباعد
                الأعمدة تباعداً مصطنعاً في الشاشات الواسعة. */}
            <div className="hidden md:block">
              <Table className="mx-auto max-w-5xl">
                <THead>
                  <TR>
                    <TH>{t('invoice_details_title')}</TH>
                    <TH>{t('invoice_details_customer')}</TH>
                    <TH>{t('invoice_details_status')}</TH>
                    <TH className="text-end">{t('total')}</TH>
                    <TH className="text-end">{t('invoice_center_open')}</TH>
                  </TR>
                </THead>
                <TBody>
                  {visible.map((invoice) => (
                    <TR key={invoice.id}>
                      <TD className="num font-semibold text-text">
                        {invoice.number}
                        <div className="num mt-0.5 text-xs font-normal text-muted">{dateLabel(invoice)}</div>
                      </TD>
                      <TD className="max-w-56 truncate text-text">{invoice.customer_name ?? t('return_unknown_customer')}</TD>
                      <TD className={cn('font-semibold', statusTone(invoice))}>{statusLabel(invoice)}</TD>
                      <TD className="num text-end font-bold text-text">{formatRiyal(invoice.total)}</TD>
                      <TD className="text-end">
                        <Button type="button" variant="ghost" size="sm" onClick={() => onOpenInvoice(invoice.id)}>
                          {t('invoice_center_open')}
                        </Button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>

            {/* الجوال: بطاقات مدمجة — الأنسب لعرض ضيّق، كما كانت. */}
            <div className="space-y-2 md:hidden">
              {visible.map((invoice) => (
                <article key={invoice.id} className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-primary-soft text-primary">
                    <ReceiptText className="h-5 w-5" strokeWidth={1.7} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="num font-semibold text-text">{invoice.number}</span>
                      <span className={cn('text-xs font-semibold', statusTone(invoice))}>{statusLabel(invoice)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                      <span className="inline-flex max-w-48 items-center gap-1 truncate"><UserRound className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />{invoice.customer_name ?? t('return_unknown_customer')}</span>
                      <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" strokeWidth={1.7} />{dateLabel(invoice)}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <span className="num font-bold text-text">{formatRiyal(invoice.total)}</span>
                    <Button type="button" variant="ghost" size="sm" onClick={() => onOpenInvoice(invoice.id)}>
                      {t('invoice_center_open')}
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
