'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Pencil, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingState } from '@/components/nebrax';
import { api } from '@/lib/api';
import { isInvoiceDraft, isInvoiceOverdue } from '@/lib/invoices/workspace';
import { formatRiyal } from '@/lib/money';
import { cn } from '@/lib/utils';

interface PreviewLine {
  id: string;
  product_name: string | null;
  description: string | null;
  quantity: number;
  line_total: string;
}

interface PreviewInvoice {
  id: string;
  number: string;
  partner_id: string;
  status: string;
  payment_status: string;
  invoice_date: string;
  due_date: string | null;
  subtotal: string;
  tax_amount: string;
  total: string;
  paid_amount: string;
  remaining: string;
  lines: PreviewLine[];
}

const statusTone: Record<string, 'positive' | 'muted' | 'negative'> = {
  posted: 'muted',
  draft: 'muted',
  cancelled: 'negative',
};
const payTone: Record<string, 'positive' | 'warning' | 'muted'> = {
  paid: 'positive',
  partial: 'warning',
  unpaid: 'muted',
};

const LINE_PREVIEW_LIMIT = 8;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.getClientRects().length > 0 && element.tabIndex !== -1,
  );
}

export function InvoicePreviewPanel({
  invoiceId,
  customerName,
  listStatus,
  onClose,
}: {
  invoiceId: string;
  customerName: string;
  listStatus?: string;
  onClose: () => void;
}) {
  const t = useTranslations('invoices');
  const td = useTranslations('invoiceDetail');
  const ts = useTranslations('status');
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [invoice, setInvoice] = useState<PreviewInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    setInvoice(null);
    api<{ data: PreviewInvoice }>(`/invoices/${invoiceId}`)
      .then((response) => {
        if (!cancelled) setInvoice(response.data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [invoiceId]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [invoiceId, onClose]);

  function trapTab(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== 'Tab' || !panelRef.current) return;
    const nodes = focusableIn(panelRef.current);
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const number = invoice?.number ?? '';
  const status = invoice?.status ?? listStatus ?? '';
  const canEdit = isInvoiceDraft(status);
  const overdue = invoice ? isInvoiceOverdue(invoice) : false;
  const extraLines = Math.max(0, (invoice?.lines?.length ?? 0) - LINE_PREVIEW_LIMIT);
  const previewLines = invoice?.lines?.slice(0, LINE_PREVIEW_LIMIT) ?? [];

  const financials: { label: string; value: string; emphasize?: 'total' | 'remaining' }[] | null = invoice
    ? [
        { label: td('subtotal'), value: invoice.subtotal },
        { label: td('tax_amount'), value: invoice.tax_amount },
        { label: td('grand_total'), value: invoice.total, emphasize: 'total' },
        { label: td('paid'), value: invoice.paid_amount },
        { label: td('remaining'), value: invoice.remaining, emphasize: 'remaining' },
      ]
    : null;

  return (
    <>
      <div
        className="fixed inset-y-0 start-0 end-0 z-40 bg-black/40 xl:start-56 xl:bg-transparent"
        aria-hidden
        onClick={onClose}
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={trapTab}
        className="fixed inset-y-0 end-0 z-50 flex w-full flex-col border-s border-border bg-surface sm:max-w-[22rem] xl:w-[21rem] xl:max-w-[21rem]"
      >
        <header className="flex shrink-0 items-start gap-2 border-b border-border px-3 py-2.5">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <h2 id={titleId} className="truncate text-sm font-semibold text-text">
                {number ? (
                  <span className="num" dir="ltr">{number}</span>
                ) : (
                  t('preview_title')
                )}
              </h2>
              {invoice ? (
                <>
                  <Badge tone={statusTone[invoice.status] ?? 'muted'}>{ts(invoice.status)}</Badge>
                  <Badge tone={payTone[invoice.payment_status] ?? 'muted'}>{ts(invoice.payment_status)}</Badge>
                  {overdue ? <Badge tone="warning">{t('overdue')}</Badge> : null}
                </>
              ) : null}
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t('preview_close')}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded text-muted hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <X className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {error ? (
            <ErrorState
              message={td('load_error')}
              onRetry={() => {
                setLoading(true);
                setError(false);
                api<{ data: PreviewInvoice }>(`/invoices/${invoiceId}`)
                  .then((response) => setInvoice(response.data))
                  .catch(() => setError(true))
                  .finally(() => setLoading(false));
              }}
              retryLabel={td('retry')}
              surface="bare"
            />
          ) : loading ? (
            <LoadingState rows={8} surface="bare" label={t('preview_loading')} />
          ) : invoice ? (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                <div className="col-span-2">
                  <dt className="text-xs text-muted">{t('partner')}</dt>
                  <dd className="mt-0.5 truncate font-medium text-text" title={customerName}>{customerName}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">{t('date')}</dt>
                  <dd className="num mt-0.5 text-muted" dir="ltr">{invoice.invoice_date}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">{t('due_date')}</dt>
                  <dd className="num mt-0.5 text-muted" dir="ltr" title={overdue ? t('overdue') : undefined}>
                    {invoice.due_date ?? '—'}
                  </dd>
                </div>
              </dl>

              <section aria-label={td('financial_summary')}>
                <h3 className="text-xs font-medium text-muted">{td('financial_summary')}</h3>
                <dl className="mt-1.5 divide-y divide-border border-y border-border">
                  {financials?.map((row) => {
                    const totalRow = row.emphasize === 'total';
                    const remainingRow = row.emphasize === 'remaining';
                    return (
                      <div key={row.label} className="flex items-baseline justify-between gap-3 py-1.5">
                        <dt className={totalRow || remainingRow ? 'text-sm font-medium text-text' : 'text-sm text-muted'}>{row.label}</dt>
                        <dd className={cn(
                          'num text-end tabular-nums',
                          totalRow && 'text-sm font-semibold text-text',
                          remainingRow && overdue && 'text-sm font-medium text-warning',
                          remainingRow && !overdue && 'text-sm font-medium text-text',
                          !totalRow && !remainingRow && 'text-sm text-muted',
                        )}>
                          {formatRiyal(row.value)}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </section>

              <section aria-label={td('lines')}>
                <h3 className="text-xs font-medium text-muted">{td('lines')}</h3>
                {previewLines.length === 0 ? (
                  <p className="mt-2 text-sm text-muted">{t('preview_no_lines')}</p>
                ) : (
                  <div className="mt-1.5 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-border text-xs text-muted">
                        <tr>
                          <th className="py-1 pe-2 text-start font-medium">{td('description')}</th>
                          <th className="py-1 pe-2 text-end font-medium">{td('qty')}</th>
                          <th className="py-1 text-end font-medium">{t('total')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {previewLines.map((line) => {
                          const name = line.product_name ?? line.description ?? '—';
                          return (
                            <tr key={line.id}>
                              <td className="max-w-[10rem] truncate py-1 pe-2 text-text" title={name}>{name}</td>
                              <td className="num py-1 pe-2 text-end text-muted">{line.quantity}</td>
                              <td className="num py-1 text-end font-medium text-text">{formatRiyal(line.line_total)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {extraLines > 0 ? (
                  <p className="mt-2 text-xs text-muted">{t('preview_more_lines', { count: extraLines })}</p>
                ) : null}
              </section>
            </div>
          ) : null}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border p-3">
          <Button asChild className="flex-1 sm:flex-none">
            <Link href={`/invoices/${invoiceId}`}>{t('open_full')}</Link>
          </Button>
          {canEdit ? (
            <Button asChild variant="outline" className="flex-1 sm:flex-none">
              <Link href={`/invoices/${invoiceId}/edit`}>
                <Pencil className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
                {t('edit')}
              </Link>
            </Button>
          ) : null}
        </footer>
      </aside>
    </>
  );
}
