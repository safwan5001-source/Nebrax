'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CalendarClock, ChevronLeft, ChevronRight, ReceiptText, RotateCw, Search, UserRound } from 'lucide-react';
import { formatDate, formatDateTime } from '@/lib/formatting';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { filterPosCenterInvoices, type PosCenterInvoice } from '@/lib/pos-invoice-center';

/**
 * PR-4: مركز الفواتير — تطوير لِـ«آخر الفواتير» (كانت نافذة منبثقة تُحيل إلى
 * صفحة ERP خارج نقطة البيع) إلى مساحة عمل حقيقية داخل POS. نفس مصدر البيانات
 * (`GET /pos/recent-invoices`، فواتير POS للفرع النشط فقط) ونفس بنية العنصر،
 * لكن الآن لوحة ثابتة تفتح تفاصيل الفاتورة داخل POS بدل رابط خارجي، مع بحث
 * محلي فوق القائمة المحمَّلة. لا تغيّر السلة النشطة ولا الجلسة ولا العميل.
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
        <div className="mx-auto max-w-3xl space-y-2">
          {loading && Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-20 animate-pulse rounded-lg border border-border bg-surface" />
          ))}
          {!loading && error && (
            <div className="space-y-3 rounded-lg border border-negative/30 bg-negative/10 p-3 text-sm text-text" role="alert">
              <p>{error}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                <RotateCw className="h-4 w-4" strokeWidth={1.7} />
                {t('retry')}
              </Button>
            </div>
          )}
          {!loading && !error && invoices.length === 0 && (
            <div className="rounded-lg border border-dashed border-border bg-surface px-4 py-10 text-center text-sm text-muted" data-testid="pos-invoice-center-empty">
              {t('recent_invoices_empty')}
            </div>
          )}
          {!loading && !error && invoices.length > 0 && visible.length === 0 && (
            <div className="rounded-lg border border-dashed border-border bg-surface px-4 py-10 text-center text-sm text-muted">
              {t('recent_invoices_empty')}
            </div>
          )}
          {!loading && !error && visible.map((invoice) => (
            <article key={invoice.id} className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-primary-soft text-primary">
                <ReceiptText className="h-5 w-5" strokeWidth={1.7} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="num font-semibold text-text">{invoice.number}</span>
                  <span className="text-xs text-muted">{invoice.payment_status ?? invoice.status}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  <span className="inline-flex max-w-48 items-center gap-1 truncate"><UserRound className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />{invoice.customer_name ?? t('return_unknown_customer')}</span>
                  <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" strokeWidth={1.7} />{dateLabel(invoice)}</span>
                  {invoice.payment_methods.length > 0 && <span>{invoice.payment_methods.join(' · ')}</span>}
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
      </div>
    </div>
  );
}
