'use client';

import Link from 'next/link';
import { DISPLAY_LOCALE } from '@/lib/formatting';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CalendarClock, ReceiptText, RotateCw, UserRound } from 'lucide-react';
import { PosDialog } from '@/components/pos/pos-dialog';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';

interface RecentPosInvoice {
  id: string;
  number: string;
  invoice_date: string | null;
  created_at: string | null;
  customer_name: string | null;
  total: string;
  payment_status: string | null;
  payment_methods: string[];
  status: string;
}

/** فواتير POS حقيقية ومحدودة خادمياً؛ لا تغيّر جلسة البيع المفتوحة. */
export function PosRecentInvoicesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('pos');
  const router = useRouter();
  const [invoices, setInvoices] = useState<RecentPosInvoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api<{ data: RecentPosInvoice[] }>('/pos/recent-invoices?limit=20');
      setInvoices(result.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('recent_invoices_error'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (open) void load();
  }, [load, open]);

  function dateLabel(invoice: RecentPosInvoice) {
    const value = invoice.created_at ?? invoice.invoice_date;
    if (!value) return '—';
    return new Intl.DateTimeFormat(DISPLAY_LOCALE, { dateStyle: 'medium', timeStyle: invoice.created_at ? 'short' : undefined }).format(new Date(value));
  }

  return (
    <PosDialog open={open} onClose={onClose} title={t('recent_invoices_title')} className="max-w-[min(42rem,calc(100vw-2rem))]">
      <div className="space-y-3">
        {loading && Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-20 animate-pulse rounded-lg border border-border bg-background" />
        ))}
        {!loading && error && (
          <div className="space-y-3 rounded-lg border border-negative/30 bg-negative/10 p-3 text-sm text-text">
            <p>{error}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              <RotateCw className="h-4 w-4" strokeWidth={1.7} />
              {t('retry')}
            </Button>
          </div>
        )}
        {!loading && !error && invoices.length === 0 && (
          <div className="rounded-lg border border-dashed border-border bg-background px-4 py-10 text-center text-sm text-muted">
            {t('recent_invoices_empty')}
          </div>
        )}
        {!loading && !error && invoices.map((invoice) => (
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
              <Button asChild type="button" variant="ghost" size="sm"><Link href={`/invoices/${invoice.id}`}>
                {t('view_invoice')}
              </Link></Button>
            </div>
          </article>
        ))}
      </div>
    </PosDialog>
  );
}
