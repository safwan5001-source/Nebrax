'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, Copy, FileText, Pencil, Plus, Printer, ReceiptText, Trash2 } from 'lucide-react';
import { Accordion, AccordionItem } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { type CustodySettlement, type EmployeeCustody } from '@/lib/employee-custody';
import { formatRiyal, riyalToMinor } from '@/lib/money';

type MobileSection = 'details' | 'financial' | 'settlements' | 'summary';

interface SettlementTypeOption {
  id: string;
  name: string;
  description?: string | null;
  is_active: boolean;
}

interface AccountOption {
  id: string;
  code: string;
  name: string;
  is_group: boolean;
  is_active: boolean;
}

const tone: Record<EmployeeCustody['status'], 'positive' | 'warning'> = {
  draft: 'warning',
  posted: 'positive',
};

export default function EmployeeCustodyDetailPage() {
  const t = useTranslations('employeeCustodies');
  const tc = useTranslations('common');
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { success } = useToast();
  const [custody, setCustody] = useState<EmployeeCustody | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [mobileSection, setMobileSection] = useState<MobileSection>('details');
  const [mobileCollapsed, setMobileCollapsed] = useState(false);
  const [settlementDialogOpen, setSettlementDialogOpen] = useState(false);
  const [settlementQueryHandled, setSettlementQueryHandled] = useState(false);
  const [settlementTypes, setSettlementTypes] = useState<SettlementTypeOption[]>([]);
  const [debitAccounts, setDebitAccounts] = useState<AccountOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [settling, setSettling] = useState(false);
  const [settlementError, setSettlementError] = useState<string | null>(null);
  const [settlementTypeId, setSettlementTypeId] = useState('');
  const [debitAccountId, setDebitAccountId] = useState('');
  const [settlementDate, setSettlementDate] = useState('');
  const [settlementAmount, setSettlementAmount] = useState('');
  const [settlementNotes, setSettlementNotes] = useState('');

  const load = useCallback(() => {
    if (!params.id) return;
    setLoading(true);
    setError(null);
    api<{ data: EmployeeCustody }>(`/employee-custodies/${params.id}`)
      .then((response) => setCustody(response.data))
      .catch((err) => setError(err instanceof ApiError ? err.message : t('loadFailed')))
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
    if (!custody || custody.status !== 'draft' || !window.confirm(t('confirmPost'))) return;
    setActing(true);
    try {
      const response = await api<{ data: EmployeeCustody }>(`/employee-custodies/${custody.id}/post`, { method: 'POST' });
      setCustody(response.data);
      success(t('postSuccess'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setActing(false);
    }
  }

  async function duplicate() {
    if (!custody) return;
    setActing(true);
    try {
      const response = await api<{ data: { id: string } }>(`/employee-custodies/${custody.id}/duplicate`, { method: 'POST' });
      success(t('duplicateSuccess'));
      router.push(`/employee-custodies/new?edit=${response.data.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setActing(false);
    }
  }

  async function remove() {
    if (!custody || custody.status !== 'draft' || !window.confirm(t('confirmDelete'))) return;
    setActing(true);
    try {
      await api(`/employee-custodies/${custody.id}`, { method: 'DELETE' });
      success(t('deletedSuccess'));
      router.push('/employee-custodies');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setActing(false);
    }
  }

  const remainingMinor = custody ? riyalToMinor(custody.remaining_amount ?? custody.amount) : 0;
  const canSettle = Boolean(custody?.status === 'posted' && !custody.is_settled && remainingMinor > 0);
  const settlementDisabledReason = custody?.status !== 'posted'
    ? t('settlementDraftOnly')
    : t('settlementNoRemaining');

  async function openSettlementDialog() {
    if (!canSettle) return;
    setSettlementDialogOpen(true);
    setSettlementError(null);
    setSettlementTypeId('');
    setDebitAccountId('');
    setSettlementAmount('');
    setSettlementNotes('');
    setSettlementDate(new Date().toISOString().slice(0, 10));
    setOptionsLoading(true);

    const [typesResult, accountsResult] = await Promise.allSettled([
      api<{ data: SettlementTypeOption[] }>('/settlement-types'),
      api<{ data: AccountOption[] }>('/accounts'),
    ]);
    if (typesResult.status === 'fulfilled') {
      setSettlementTypes(typesResult.value.data.filter((type) => type.is_active));
    } else {
      setSettlementError(t('settlementOptionsFailed'));
    }
    if (accountsResult.status === 'fulfilled') {
      setDebitAccounts(accountsResult.value.data.filter((account) => account.is_active && !account.is_group && account.code !== '1160'));
    } else {
      setSettlementError(t('settlementOptionsFailed'));
    }
    setOptionsLoading(false);
  }

  useEffect(() => {
    if (settlementQueryHandled || searchParams.get('settlement') !== '1' || !canSettle) return;
    setSettlementQueryHandled(true);
    openSettlementDialog().catch(() => undefined);
  }, [canSettle, searchParams, settlementQueryHandled]);

  async function submitSettlement(event: React.FormEvent) {
    event.preventDefault();
    if (!custody) return;

    const amount = riyalToMinor(settlementAmount);
    if (!settlementTypeId || !debitAccountId || !settlementDate || !Number.isInteger(amount) || amount <= 0) {
      setSettlementError(t('invalidSettlement'));
      return;
    }
    if (amount > remainingMinor) {
      setSettlementError(t('settlementExceedsRemaining'));
      return;
    }

    setSettling(true);
    setSettlementError(null);
    try {
      await api<{ data: CustodySettlement }>(`/employee-custodies/${custody.id}/settlements`, {
        method: 'POST',
        body: {
          settlement_type_id: settlementTypeId,
          debit_account_id: debitAccountId,
          settlement_date: settlementDate,
          amount,
          notes: settlementNotes.trim() || undefined,
        },
      });
      setSettlementDialogOpen(false);
      success(t('settlementSuccess'));
      load();
    } catch (err) {
      setSettlementError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSettling(false);
    }
  }

  if (loading) {
    return <div className="mx-auto max-w-5xl space-y-5"><div className="h-16 animate-pulse rounded-md bg-muted" /><div className="h-96 animate-pulse rounded-md bg-muted" /></div>;
  }

  if (!custody) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <p className="rounded-md bg-negative/10 px-4 py-3 text-sm text-negative">{error ?? t('loadFailed')}</p>
        <Link href="/employee-custodies"><Button variant="outline">{t('back')}</Button></Link>
      </div>
    );
  }

  const details = [
    [t('number'), custody.number],
    [t('employee'), [custody.employee_name, custody.employee_no].filter(Boolean).join(' — ') || '—'],
    [t('date'), custody.custody_date],
    [t('dueDate'), custody.due_date || '—'],
  ];
  const financial = [
    [t('custodyAccount'), [custody.custody_account_code, custody.custody_account_name].filter(Boolean).join(' — ') || '—'],
    [t('cashAccount'), [custody.cash_account_code, custody.cash_account_name].filter(Boolean).join(' — ') || '—'],
    [t('method'), t(custody.method)],
  ];
  const mobileOpen = (section: MobileSection) => !mobileCollapsed && mobileSection === section;

  const actionButtons = (mobile = false) => (
    <>
      <Button className={mobile ? 'shrink-0' : undefined} variant="outline" onClick={() => window.print()}>
        <Printer className="h-4 w-4" strokeWidth={1.7} />
        {t('prints')}
      </Button>
      <span className={mobile ? 'shrink-0' : undefined} title={!canSettle ? settlementDisabledReason : undefined}>
        <Button variant="outline" disabled={!canSettle || acting} onClick={openSettlementDialog}>
          <Plus className="h-4 w-4" strokeWidth={1.7} />
          {t('addSettlement')}
        </Button>
      </span>
      {custody.status === 'draft' && (
        <Link className={mobile ? 'shrink-0' : undefined} href={`/employee-custodies/new?edit=${custody.id}`}>
          <Button variant="outline"><Pencil className="h-4 w-4" strokeWidth={1.7} />{t('edit')}</Button>
        </Link>
      )}
      <Button className={mobile ? 'shrink-0' : undefined} variant="outline" disabled={acting} onClick={duplicate}>
        <Copy className="h-4 w-4" strokeWidth={1.7} />
        {t('duplicate')}
      </Button>
      <Button className={mobile ? 'shrink-0' : undefined} variant="outline" disabled={custody.status !== 'draft' || acting} title={custody.status !== 'draft' ? t('draftActionOnly') : undefined} onClick={remove}>
        <Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} />
        {t('delete')}
      </Button>
      {custody.status === 'draft' && <Button className={mobile ? 'shrink-0' : undefined} disabled={acting} onClick={post}>{t('post')}</Button>}
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
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-text">{custody.notes || '—'}</p>
      </div>
    </div>
  );

  const financialContent = (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-4 p-4 sm:grid-cols-2 lg:p-0">
      {financial.map(([label, value]) => (
        <div key={label} className="space-y-1">
          <dt className="text-sm font-medium text-muted">{label}</dt>
          <dd className="text-sm text-text">{value}</dd>
        </div>
      ))}
    </dl>
  );

  const settlements = custody.settlements ?? [];
  const settlementsContent = (
    <div className="p-4 lg:p-0">
      {settlements.length === 0 ? (
        <div className="rounded-md border border-border bg-muted/40 px-4 py-4 text-sm leading-6 text-muted">
          <FileText className="mb-2 h-4 w-4 text-primary" strokeWidth={1.7} />
          {t('settlementsEmpty')}
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border" aria-label={t('settlements')}>
          {settlements.map((settlement) => (
            <li key={settlement.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="num text-sm font-medium text-text">{settlement.number}</span>
                  <span className="text-sm text-text">{settlement.settlement_type_name || '—'}</span>
                </div>
                <p className="text-xs text-muted">{settlement.settlement_date} · {[settlement.debit_account_code, settlement.debit_account_name].filter(Boolean).join(' — ') || '—'}</p>
                {settlement.notes && <p className="text-xs leading-5 text-muted">{settlement.notes}</p>}
              </div>
              <span className="num shrink-0 text-sm font-semibold text-text">{formatRiyal(settlement.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const summaryContent = (
    <div className="space-y-4 p-4 lg:p-0">
      <div className="flex justify-between gap-4"><span className="text-sm text-muted">{t('amount')}</span><span className="num text-lg font-bold text-text">{formatRiyal(custody.amount)}</span></div>
      <div className="flex justify-between gap-4"><span className="text-sm text-muted">{t('settledAmount')}</span><span className="num text-base font-medium text-text">{custody.status === 'posted' ? formatRiyal(custody.settled_amount ?? '0') : '—'}</span></div>
      <div className="flex justify-between gap-4"><span className="text-sm text-muted">{t('remaining')}</span><span className="num text-base font-medium text-text">{custody.status === 'posted' ? formatRiyal(custody.remaining_amount ?? custody.amount) : '—'}</span></div>
      <div className="rounded-md bg-muted/50 px-3 py-3 text-xs leading-5 text-muted">
        <ReceiptText className="mb-1 h-4 w-4 text-primary" strokeWidth={1.7} />
        {custody.status === 'posted' ? t('postedImmutableNote') : t('draftPostingNote')}
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push('/employee-custodies')} aria-label={t('back')}>
            <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
          </Button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-text">{t('custodyDocument', { number: custody.number })}</h1>
              <Badge tone={tone[custody.status]}>{t(custody.status)}</Badge>
              {custody.is_settled && <Badge tone="positive">{t('settled')}</Badge>}
            </div>
            <p className="mt-1 text-sm text-muted">{custody.journal_entry_id ? t('journalEntryCreated') : t('journalEntryPending')}</p>
          </div>
        </div>
        <div className="no-print hidden flex-wrap items-center gap-2 lg:flex">{actionButtons()}</div>
      </div>

      <div className="no-print -mx-4 overflow-x-auto px-4 lg:hidden"><div className="flex w-max gap-2">{actionButtons(true)}</div></div>
      {error && <p className="rounded-md bg-negative/10 px-4 py-3 text-sm text-negative">{error}</p>}

      <Accordion className="lg:hidden">
        <AccordionItem id="custody-details" title={t('detailTitle')} open={mobileOpen('details')} onToggle={() => toggleMobileSection('details')}>{mobileOpen('details') && detailContent}</AccordionItem>
        <AccordionItem id="custody-financial" title={t('financialDetails')} open={mobileOpen('financial')} onToggle={() => toggleMobileSection('financial')}>{mobileOpen('financial') && financialContent}</AccordionItem>
        <AccordionItem id="custody-settlements" title={t('settlements')} open={mobileOpen('settlements')} onToggle={() => toggleMobileSection('settlements')}>{mobileOpen('settlements') && settlementsContent}</AccordionItem>
        <AccordionItem id="custody-summary" title={t('financialSummary')} open={mobileOpen('summary')} onToggle={() => toggleMobileSection('summary')}>{mobileOpen('summary') && summaryContent}</AccordionItem>
      </Accordion>

      <div className="hidden gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-5">
          <Card><CardHeader><CardTitle>{t('detailTitle')}</CardTitle></CardHeader><CardContent>{detailContent}</CardContent></Card>
          <Card><CardHeader><CardTitle>{t('financialDetails')}</CardTitle></CardHeader><CardContent>{financialContent}</CardContent></Card>
          <Card><CardHeader><CardTitle>{t('settlements')}</CardTitle></CardHeader><CardContent>{settlementsContent}</CardContent></Card>
        </div>
        <Card className="h-fit lg:sticky lg:top-5"><CardHeader><CardTitle>{t('financialSummary')}</CardTitle></CardHeader><CardContent>{summaryContent}</CardContent></Card>
      </div>

      <Dialog open={settlementDialogOpen} onClose={() => !settling && setSettlementDialogOpen(false)} title={t('settlementDialogTitle')}>
        <form className="space-y-4" onSubmit={submitSettlement}>
          <p className="text-sm leading-6 text-muted">{t('settlementDialogDescription', { remaining: formatRiyal(custody.remaining_amount ?? custody.amount) })}</p>
          {settlementError && <p className="rounded-md bg-negative/10 px-3 py-2 text-sm text-negative" role="alert">{settlementError}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="settlement-type">{t('settlementType')}</Label>
              <Select id="settlement-type" value={settlementTypeId} onChange={(event) => setSettlementTypeId(event.target.value)} disabled={optionsLoading || settling} required aria-invalid={Boolean(settlementError && !settlementTypeId)}>
                <option value="">{t('selectSettlementType')}</option>
                {settlementTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="settlement-debit-account">{t('debitAccount')}</Label>
              <Select id="settlement-debit-account" value={debitAccountId} onChange={(event) => setDebitAccountId(event.target.value)} disabled={optionsLoading || settling} required aria-invalid={Boolean(settlementError && !debitAccountId)}>
                <option value="">{t('selectDebitAccount')}</option>
                {debitAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="settlement-date">{t('settlementDate')}</Label>
              <Input id="settlement-date" type="date" value={settlementDate} onChange={(event) => setSettlementDate(event.target.value)} disabled={settling} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="settlement-amount">{t('settlementAmount')}</Label>
              <Input id="settlement-amount" inputMode="decimal" value={settlementAmount} onChange={(event) => setSettlementAmount(event.target.value)} onBlur={() => {
                const amount = riyalToMinor(settlementAmount);
                if (settlementAmount && (!Number.isInteger(amount) || amount <= 0 || amount > remainingMinor)) setSettlementError(t('invalidSettlement'));
              }} placeholder="0.00" disabled={settling} required aria-invalid={Boolean(settlementError && !Number.isInteger(riyalToMinor(settlementAmount)))} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="settlement-notes">{t('settlementNotes')}</Label>
            <Textarea id="settlement-notes" value={settlementNotes} onChange={(event) => setSettlementNotes(event.target.value)} disabled={settling} rows={3} />
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setSettlementDialogOpen(false)} disabled={settling}>{tc('cancel')}</Button>
            <Button type="submit" disabled={optionsLoading || settling}>{settling ? t('settlementSaving') : t('settlementSubmit')}</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
