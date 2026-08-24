'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, Copy, Download, FileText, Pencil, Printer, ReceiptText, Trash2 } from 'lucide-react';
import { Accordion, AccordionItem } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { api, ApiError, downloadFile } from '@/lib/api';
import { formatRiyal } from '@/lib/money';

interface Attachment { id: string; original_name: string; mime_type?: string | null; size: number }
interface Expense {
  id: string;
  number: string;
  account_code?: string | null;
  account_name?: string | null;
  category_name?: string | null;
  partner_name?: string | null;
  vendor_name?: string | null;
  cost_center_name?: string | null;
  cost_center_code?: string | null;
  journal_entry_id?: string | null;
  expense_date: string;
  payment_method: string;
  description?: string | null;
  amount: string;
  tax_rate: number;
  tax_amount: string;
  total: string;
  status: 'draft' | 'posted' | 'cancelled';
  attachments?: Attachment[];
}

type MobileSection = 'details' | 'attachments' | 'summary';

const statusTone: Record<string, 'positive' | 'warning' | 'muted'> = {
  posted: 'positive', draft: 'warning', cancelled: 'muted',
};

function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ExpenseDetailPage() {
  const t = useTranslations('expenses');
  const tc = useTranslations('common');
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { success } = useToast();
  const [expense, setExpense] = useState<Expense | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [acting, setActing] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  // الجوال يحافظ على قسم واحد ظاهر، ويتيح طيّه بالنقر عليه مرة ثانية.
  const [mobileSection, setMobileSection] = useState<MobileSection>('details');
  const [mobileCollapsed, setMobileCollapsed] = useState(false);

  const load = useCallback(() => {
    if (!params.id) return;
    setLoading(true);
    setError(null);
    api<{ data: Expense }>(`/expenses/${params.id}`)
      .then((response) => setExpense(response.data))
      .catch((err) => setError(err instanceof ApiError ? err.message : t('load_detail_failed')))
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

  async function postExpense() {
    if (!expense || expense.status !== 'draft') return;
    if (!window.confirm(t('confirm_post_expense'))) return;

    setPosting(true);
    try {
      const response = await api<{ data: Expense }>(`/expenses/${expense.id}/post`, { method: 'POST' });
      setExpense(response.data);
      success(t('post_success'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setPosting(false);
    }
  }

  async function duplicateExpense() {
    if (!expense) return;
    setActing(true);
    try {
      const response = await api<{ data: { id: string } }>(`/expenses/${expense.id}/duplicate`, { method: 'POST' });
      success(t('duplicate_success'));
      router.push(`/expenses/new?edit=${response.data.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setActing(false);
    }
  }

  async function deleteExpense() {
    if (!expense || expense.status !== 'draft' || !window.confirm(t('confirm_delete_expense'))) return;
    setActing(true);
    try {
      await api(`/expenses/${expense.id}`, { method: 'DELETE' });
      success(t('deleted_success'));
      router.push('/expenses');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setActing(false);
    }
  }

  async function downloadAttachment(attachment: Attachment) {
    if (!expense) return;
    setDownloading(attachment.id);
    try {
      await downloadFile(`/expenses/${expense.id}/attachments/${attachment.id}`, attachment.original_name);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('download_attachment_failed'));
    } finally {
      setDownloading(null);
    }
  }

  if (loading) {
    return <div className="mx-auto max-w-5xl space-y-5"><div className="h-16 animate-pulse rounded-md bg-muted" /><div className="h-96 animate-pulse rounded-md bg-muted" /></div>;
  }

  if (!expense) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <p className="rounded-md bg-negative/10 px-4 py-3 text-sm text-negative">{error ?? t('expense_not_found')}</p>
        <Button asChild variant="outline"><Link href="/expenses">{t('back')}</Link></Button>
      </div>
    );
  }

  const details = [
    [t('number'), expense.number],
    [t('date'), expense.expense_date],
    [t('account'), [expense.account_code, expense.account_name].filter(Boolean).join(' — ') || '—'],
    [t('category'), expense.category_name || t('no_category')],
    [t('vendor_name'), expense.vendor_name || '—'],
    [t('supplier'), expense.partner_name || t('none')],
    [t('cost_center'), expense.cost_center_name ? [expense.cost_center_code, expense.cost_center_name].filter(Boolean).join(' — ') : t('no_center')],
    [t('payment_method'), t(`method.${expense.payment_method}`)],
  ];

  const mobileOpen = (section: MobileSection) => !mobileCollapsed && mobileSection === section;
  const actionButtons = (mobile = false) => (
    <>
      <Button className={mobile ? 'shrink-0' : undefined} variant="outline" onClick={() => window.print()}>
        <Printer className="h-4 w-4" strokeWidth={1.7} />
        {t('prints')}
      </Button>
      {expense.status === 'draft' ? (
        <Button asChild variant="outline"><Link className={mobile ? 'shrink-0' : undefined} href={`/expenses/new?edit=${expense.id}`}><Pencil className="h-4 w-4" strokeWidth={1.7} />{t('edit')}</Link></Button>
      ) : null}
      <Button className={mobile ? 'shrink-0' : undefined} variant="outline" disabled={acting || posting} onClick={duplicateExpense}>
        <Copy className="h-4 w-4" strokeWidth={1.7} />
        {t('duplicate')}
      </Button>
      <Button className={mobile ? 'shrink-0' : undefined} variant="outline" disabled={expense.status !== 'draft' || acting || posting} title={expense.status !== 'draft' ? t('draft_action_only') : undefined} onClick={deleteExpense}>
        <Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} />
        {t('delete')}
      </Button>
      {expense.status === 'draft' && (
        <Button className={mobile ? 'shrink-0' : undefined} disabled={posting || acting} onClick={postExpense}>
          {posting ? t('posting') : t('post')}
        </Button>
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
        <p className="text-sm font-medium text-muted">{t('description')}</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-text">{expense.description || '—'}</p>
      </div>
    </div>
  );

  const attachmentsContent = (
    <div className="p-4 lg:p-0">
      {(expense.attachments?.length ?? 0) === 0 ? (
        <p className="py-5 text-center text-sm text-muted">{t('no_attachments')}</p>
      ) : (
        <div className="divide-y divide-border rounded-md border border-border">
          {expense.attachments?.map((attachment) => (
            <div key={attachment.id} className="flex items-center justify-between gap-3 px-3 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.7} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text">{attachment.original_name}</p>
                  <p className="text-xs text-muted">{attachment.mime_type || t('unknown_file_type')} · {bytes(attachment.size)}</p>
                </div>
              </div>
              <Button variant="outline" size="sm" disabled={downloading === attachment.id} onClick={() => downloadAttachment(attachment)}>
                <Download className="h-3.5 w-3.5" strokeWidth={1.7} />
                {downloading === attachment.id ? t('downloading') : t('download')}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const summaryContent = (
    <div className="space-y-3 p-4 lg:p-0">
      <div className="flex justify-between gap-4 text-sm text-muted"><span>{t('subtotal')}</span><span className="num">{formatRiyal(expense.amount)}</span></div>
      <div className="flex justify-between gap-4 text-sm text-muted"><span>{t('tax_total')} ({expense.tax_rate}%)</span><span className="num">{formatRiyal(expense.tax_amount)}</span></div>
      <div className="flex justify-between gap-4 border-t border-border pt-3"><span className="font-semibold text-text">{t('total')}</span><span className="num text-lg font-bold text-text">{formatRiyal(expense.total)}</span></div>
      <div className="mt-5 rounded-md bg-muted/50 px-3 py-3 text-xs leading-5 text-muted">
        <ReceiptText className="mb-1 h-4 w-4 text-primary" strokeWidth={1.7} />
        {expense.status === 'posted' ? t('posted_immutable_note') : t('draft_posting_note')}
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button asChild variant="ghost" size="icon" aria-label={t('back')}><Link href='/expenses'>
            <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
          </Link></Button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-text">{t('expense_document', { number: expense.number })}</h1>
              <Badge tone={statusTone[expense.status] ?? 'muted'}>{t(expense.status)}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted">
              {expense.journal_entry_id ? t('journal_entry_created') : t('journal_entry_pending')}
            </p>
          </div>
        </div>
        <div className="no-print hidden flex-wrap items-center gap-2 lg:flex">{actionButtons()}</div>
      </div>

      <div className="no-print -mx-4 overflow-x-auto px-4 lg:hidden">
        <div className="flex w-max gap-2">{actionButtons(true)}</div>
      </div>

      {error && <p className="rounded-md bg-negative/10 px-4 py-3 text-sm text-negative">{error}</p>}

      <Accordion className="lg:hidden">
        <AccordionItem id="expense-details" title={t('detail_title')} open={mobileOpen('details')} onToggle={() => toggleMobileSection('details')}>
          {mobileOpen('details') && detailContent}
        </AccordionItem>
        <AccordionItem id="expense-attachments" title={t('attachments')} count={expense.attachments?.length} open={mobileOpen('attachments')} onToggle={() => toggleMobileSection('attachments')}>
          {mobileOpen('attachments') && attachmentsContent}
        </AccordionItem>
        <AccordionItem id="expense-summary" title={t('financial_summary')} open={mobileOpen('summary')} onToggle={() => toggleMobileSection('summary')}>
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
            <CardHeader><CardTitle>{t('attachments')}</CardTitle></CardHeader>
            <CardContent>{attachmentsContent}</CardContent>
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
