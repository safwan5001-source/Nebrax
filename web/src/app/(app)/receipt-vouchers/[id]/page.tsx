'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, Copy, FileText, Pencil, Printer, ReceiptText, Trash2 } from 'lucide-react';
import { Accordion, AccordionItem } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';

interface Allocation { id: string; label: string; amount: string }
interface Voucher {
  id: string;
  number: string;
  direction: 'received' | 'paid';
  partner_name?: string | null;
  method: string;
  reference?: string | null;
  cash_account_code?: string | null;
  cash_account_name?: string | null;
  journal_entry_id?: string | null;
  payment_date: string;
  amount: string;
  notes?: string | null;
  status: 'draft' | 'posted' | 'cancelled';
  allocations?: Allocation[];
}

type MobileSection = 'details' | 'allocations' | 'summary';

const tone: Record<string, 'positive' | 'warning' | 'muted'> = {
  posted: 'positive', draft: 'warning', cancelled: 'muted',
};

export default function ReceiptVoucherDetailPage() {
  const t = useTranslations('receiptVouchers');
  const tc = useTranslations('common');
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { success } = useToast();
  const [voucher, setVoucher] = useState<Voucher | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  // على الجوال، يبقى قسم واحد مفتوحاً ولا يبدأ المستخدم بصفحة طويلة من المعلومات.
  const [mobileSection, setMobileSection] = useState<MobileSection>('details');
  const [mobileCollapsed, setMobileCollapsed] = useState(false);

  const load = useCallback(() => {
    if (!params.id) return;
    setLoading(true);
    setError(null);
    api<{ data: Voucher }>(`/payments/${params.id}`)
      .then((response) => {
        if (!response.data || response.data.direction !== 'received') {
          setError(t('load_failed'));
          return;
        }
        setVoucher(response.data);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : t('load_failed')))
      .finally(() => setLoading(false));
  }, [params.id, t]);

  useEffect(() => load(), [load]);

  function toggleMobileSection(section: MobileSection) {
    if (mobileSection === section) {
      setMobileCollapsed((collapsed) => !collapsed);
      return;
    }

    setMobileSection(section);
    setMobileCollapsed(false);
  }

  async function post() {
    if (!voucher || voucher.status !== 'draft' || !window.confirm(t('confirm_post'))) return;
    setActing(true);
    try {
      const response = await api<{ data: Voucher }>(`/payments/${voucher.id}/post`, { method: 'POST' });
      setVoucher(response.data);
      success(t('post_success'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setActing(false);
    }
  }

  async function duplicate() {
    if (!voucher) return;
    setActing(true);
    try {
      const response = await api<{ data: { id: string } }>(`/payments/${voucher.id}/duplicate`, { method: 'POST' });
      success(t('duplicate_success'));
      router.push(`/receipt-vouchers/new?edit=${response.data.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setActing(false);
    }
  }

  async function remove() {
    if (!voucher || voucher.status !== 'draft' || !window.confirm(t('confirm_delete'))) return;
    setActing(true);
    try {
      await api(`/payments/${voucher.id}`, { method: 'DELETE' });
      success(t('deleted_success'));
      router.push('/receipt-vouchers');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setActing(false);
    }
  }

  if (loading) {
    return <div className="mx-auto max-w-5xl space-y-5"><div className="h-16 animate-pulse rounded-md bg-muted" /><div className="h-96 animate-pulse rounded-md bg-muted" /></div>;
  }

  if (!voucher) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <p className="rounded-md bg-negative/10 px-4 py-3 text-sm text-negative">{error ?? t('load_failed')}</p>
        <Link href="/receipt-vouchers"><Button variant="outline">{t('back')}</Button></Link>
      </div>
    );
  }

  const details = [
    [t('number'), voucher.number],
    [t('customer'), voucher.partner_name || '—'],
    [t('date'), voucher.payment_date],
    [t('method'), t(voucher.method)],
    [t('reference'), voucher.reference || '—'],
    [t('default_treasury'), voucher.cash_account_name ? [voucher.cash_account_code, voucher.cash_account_name].filter(Boolean).join(' — ') : t('default_treasury')],
  ];

  const mobileOpen = (section: MobileSection) => !mobileCollapsed && mobileSection === section;
  const actionButtons = (mobile = false) => (
    <>
      <Button className={mobile ? 'shrink-0' : undefined} variant="outline" onClick={() => window.print()}>
        <Printer className="h-4 w-4" strokeWidth={1.7} />
        {t('prints')}
      </Button>
      {voucher.status === 'draft' && (
        <Link className={mobile ? 'shrink-0' : undefined} href={`/receipt-vouchers/new?edit=${voucher.id}`}>
          <Button variant="outline"><Pencil className="h-4 w-4" strokeWidth={1.7} />{t('edit')}</Button>
        </Link>
      )}
      <Button className={mobile ? 'shrink-0' : undefined} variant="outline" disabled={acting} onClick={duplicate}>
        <Copy className="h-4 w-4" strokeWidth={1.7} />
        {t('duplicate')}
      </Button>
      <Button className={mobile ? 'shrink-0' : undefined} variant="outline" disabled={voucher.status !== 'draft' || acting} title={voucher.status !== 'draft' ? t('draft_action_only') : undefined} onClick={remove}>
        <Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} />
        {t('delete')}
      </Button>
      {voucher.status === 'draft' && (
        <Button className={mobile ? 'shrink-0' : undefined} disabled={acting} onClick={post}>{t('post')}</Button>
      )}
    </>
  );

  const detailContent = (
    <div className="space-y-5 p-4 lg:p-0">
      <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
        {details.map(([label, value]) => (
          <div key={label} className="space-y-1">
            <dt className="text-sm font-medium text-muted">{label}</dt>
            <dd className="text-sm text-text">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="border-t border-border pt-4">
        <p className="text-sm font-medium text-muted">{t('notes')}</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-text">{voucher.notes || '—'}</p>
      </div>
    </div>
  );

  const allocationsContent = (
    <div className="p-4 lg:p-0">
      {(voucher.allocations?.length ?? 0) === 0 ? (
        <p className="py-5 text-center text-sm text-muted">{t('no_allocations')}</p>
      ) : (
        <div className="divide-y divide-border rounded-md border border-border">
          {voucher.allocations?.map((allocation) => (
            <div key={allocation.id} className="flex items-center justify-between gap-3 px-3 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.7} />
                <span className="truncate text-sm text-text">{allocation.label}</span>
              </div>
              <span className="num shrink-0 text-sm font-medium">{formatRiyal(allocation.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const summaryContent = (
    <div className="space-y-4 p-4 lg:p-0">
      <div className="flex justify-between gap-4"><span className="text-sm text-muted">{t('amount')}</span><span className="num text-lg font-bold text-text">{formatRiyal(voucher.amount)}</span></div>
      <div className="rounded-md bg-muted/50 px-3 py-3 text-xs leading-5 text-muted">
        <ReceiptText className="mb-1 h-4 w-4 text-primary" strokeWidth={1.7} />
        {voucher.status === 'posted' ? t('posted_immutable_note') : t('draft_posting_note')}
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push('/receipt-vouchers')} aria-label={t('back')}>
            <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
          </Button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-text">{t('receipt_document', { number: voucher.number })}</h1>
              <Badge tone={tone[voucher.status] ?? 'muted'}>{t(voucher.status)}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted">{voucher.journal_entry_id ? t('journal_entry_created') : t('journal_entry_pending')}</p>
          </div>
        </div>
        <div className="no-print hidden flex-wrap items-center gap-2 lg:flex">{actionButtons()}</div>
      </div>

      <div className="no-print -mx-4 overflow-x-auto px-4 lg:hidden">
        <div className="flex w-max gap-2">{actionButtons(true)}</div>
      </div>

      {error && <p className="rounded-md bg-negative/10 px-4 py-3 text-sm text-negative">{error}</p>}

      <Accordion className="lg:hidden">
        <AccordionItem id="receipt-details" title={t('detail_title')} open={mobileOpen('details')} onToggle={() => toggleMobileSection('details')}>
          {mobileOpen('details') && detailContent}
        </AccordionItem>
        <AccordionItem id="receipt-allocations" title={t('allocations')} count={voucher.allocations?.length} open={mobileOpen('allocations')} onToggle={() => toggleMobileSection('allocations')}>
          {mobileOpen('allocations') && allocationsContent}
        </AccordionItem>
        <AccordionItem id="receipt-summary" title={t('financial_summary')} open={mobileOpen('summary')} onToggle={() => toggleMobileSection('summary')}>
          {mobileOpen('summary') && summaryContent}
        </AccordionItem>
      </Accordion>

      <div className="hidden gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle>{t('detail_title')}</CardTitle></CardHeader>
            <CardContent>{detailContent}</CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t('allocations')}</CardTitle></CardHeader>
            <CardContent>{allocationsContent}</CardContent>
          </Card>
        </div>
        <Card className="h-fit lg:sticky lg:top-5">
          <CardHeader><CardTitle>{t('financial_summary')}</CardTitle></CardHeader>
          <CardContent>{summaryContent}</CardContent>
        </Card>
      </div>
    </div>
  );
}
