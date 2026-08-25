'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Copy, Download, FileText, Pencil, Printer, ReceiptText, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import {
  DetailPage, DetailSummary, ErrorState, FormAlert, LoadingState, type PageAction,
} from '@/components/nebrax';
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
  document_linked?: boolean;
  source_document_url?: string | null;
  attachments?: Attachment[];
}

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
    if (!expense || expense.status !== 'draft') return;
    if (expense.document_linked) {
      setError(t('linked_draft_delete_blocked'));
      return;
    }
    if (!window.confirm(t('confirm_delete_expense'))) return;
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

  if (loading) return <LoadingState rows={8} label={tc('loading')} />;

  if (!expense) return <ErrorState message={error ?? t('expense_not_found')} onRetry={load} />;

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

  const isDraft = expense.status === 'draft';
  const actions: PageAction[] = [
    { key: 'print', label: t('prints'), icon: Printer, onClick: () => window.print(), variant: 'outline', emphasis: 'secondary' },
    ...(isDraft ? [{ key: 'edit', label: t('edit'), icon: Pencil, href: `/expenses/new?edit=${expense.id}`, variant: 'outline' as const, emphasis: 'secondary' as const }] : []),
    { key: 'duplicate', label: t('duplicate'), icon: Copy, onClick: duplicateExpense, variant: 'outline', emphasis: 'secondary', disabled: acting || posting },
    {
      key: 'delete', label: t('delete'), icon: Trash2, onClick: deleteExpense, variant: 'danger', emphasis: 'secondary',
      disabled: !isDraft || expense.document_linked || acting || posting,
      title: expense.document_linked ? t('linked_draft_delete_blocked') : !isDraft ? t('draft_action_only') : undefined,
    },
    ...(isDraft ? [{ key: 'post', label: posting ? t('posting') : t('post'), onClick: postExpense, variant: 'primary' as const, disabled: posting || acting }] : []),
  ];

  const detailContent = (
    <div className="space-y-5">
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
    <div>
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
    <DetailSummary
      rows={[
        { label: t('subtotal'), value: formatRiyal(expense.amount) },
        { label: `${t('tax_total')} (${expense.tax_rate}%)`, value: formatRiyal(expense.tax_amount) },
        { label: t('total'), value: formatRiyal(expense.total), strong: true },
      ]}
      note={<>
        <ReceiptText className="mb-1 h-4 w-4 text-primary" strokeWidth={1.7} aria-hidden="true" />
        {expense.status === 'posted' ? t('posted_immutable_note') : t('draft_posting_note')}
      </>}
    />
  );

  return (
    <DetailPage
      backHref="/expenses"
      backLabel={t('back')}
      title={t('expense_document', { number: expense.number })}
      badges={<Badge tone={statusTone[expense.status] ?? 'muted'}>{t(expense.status)}</Badge>}
      meta={<>
        <p>{expense.journal_entry_id ? t('journal_entry_created') : t('journal_entry_pending')}</p>
        {expense.source_document_url && (
          <Button asChild className="mt-3" size="sm" variant="outline">
            <Link href={expense.source_document_url}>
              <FileText className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
              {t('source_document')}
            </Link>
          </Button>
        )}
        {expense.document_linked && !expense.source_document_url && (
          <p className="mt-2 text-xs">{t('linked_draft_delete_blocked')}</p>
        )}
      </>}
      actions={actions}
      alert={error ? <FormAlert>{error}</FormAlert> : undefined}
      summaryTitle={t('financial_summary')}
      summary={summaryContent}
      sections={[
        { id: 'expense-details', title: t('detail_title'), content: detailContent },
        { id: 'expense-attachments', title: t('attachments'), count: expense.attachments?.length, content: attachmentsContent },
      ]}
    />
  );
}
