'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FieldGrid, FieldSpan, FormActions, FormAlert, FormPage, FormSection } from '@/components/nebrax';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NumberPreviewField } from '@/components/ui/number-preview-field';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { useNumberPreview } from '@/lib/use-number-preview';
import { formatRiyal, riyalToMinor } from '@/lib/money';

interface Account { id: string; code: string; name: string; is_group: boolean; is_active: boolean }
interface CostCenter { id: string; code: string; name: string; is_active: boolean }
interface Partner { id: string; name: string; type?: string }
interface JournalLine {
  account_id: string;
  description: string;
  debit: string;
  credit: string;
  partner_id: string;
  cost_center_id: string;
}
interface ManualJournal {
  id: string;
  status: string;
  entry_date: string;
  description?: string | null;
  lines: Array<{
    account_id: string;
    description?: string | null;
    debit: string;
    credit: string;
    partner_id?: string | null;
    cost_center_id?: string | null;
  }>;
}

const emptyLine = (): JournalLine => ({
  account_id: '', description: '', debit: '', credit: '', partner_id: '', cost_center_id: '',
});

export default function ManualJournalEditorPage() {
  const t = useTranslations('manualJournals');
  const tc = useTranslations('common');
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get('edit');
  const { success } = useToast();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [centers, setCenters] = useState<CostCenter[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [entryDate, setEntryDate] = useState('');
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<JournalLine[]>([emptyLine(), emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { number: suggestedNumber, loading: loadingNumber } = useNumberPreview('manual_journal', { date: entryDate, enabled: !editId });

  useEffect(() => {
    setEntryDate(new Date().toISOString().slice(0, 10));
    api<{ data: Account[] }>('/accounts')
      .then((response) => setAccounts(response.data.filter((account) => !account.is_group && account.is_active)))
      .catch(() => {});
    api<{ data: CostCenter[] }>('/cost-centers')
      .then((response) => setCenters(response.data.filter((center) => center.is_active)))
      .catch(() => {});
    api<{ data: Partner[] }>('/partners').then((response) => setPartners(response.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!editId) return;
    api<{ data: ManualJournal }>(`/manual-journals/${editId}`)
      .then((response) => {
        const journal = response.data;
        if (journal.status !== 'draft') {
          setError(t('draftOnly'));
          return;
        }
        setEntryDate(journal.entry_date);
        setDescription(journal.description ?? '');
        setLines(journal.lines.map((line) => ({
          account_id: line.account_id,
          description: line.description ?? '',
          debit: String(line.debit),
          credit: String(line.credit),
          partner_id: line.partner_id ?? '',
          cost_center_id: line.cost_center_id ?? '',
        })));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : t('loadFailed')));
  }, [editId, t]);

  const totals = useMemo(() => lines.reduce((sum, line) => ({
    debit: sum.debit + riyalToMinor(line.debit),
    credit: sum.credit + riyalToMinor(line.credit),
  }), { debit: 0, credit: 0 }), [lines]);
  const difference = totals.debit - totals.credit;
  const balanced = totals.debit > 0 && difference === 0;

  const updateLine = (index: number, key: keyof JournalLine, value: string) => {
    setLines((current) => current.map((line, lineIndex) => {
      if (lineIndex !== index) return line;
      if (key === 'debit' && value) return { ...line, debit: value, credit: '' };
      if (key === 'credit' && value) return { ...line, credit: value, debit: '' };
      return { ...line, [key]: value };
    }));
  };

  const addLine = () => setLines((current) => [...current, emptyLine()]);
  const removeLine = (index: number) => setLines((current) => current.length <= 2 ? current : current.filter((_, itemIndex) => itemIndex !== index));

  const normalizedLines = () => lines.map((line) => ({
    account_id: line.account_id,
    description: line.description.trim() || null,
    debit: riyalToMinor(line.debit),
    credit: riyalToMinor(line.credit),
    partner_id: line.partner_id || null,
    cost_center_id: line.cost_center_id || null,
  }));

  const submit = useCallback(async () => {
    if (lines.some((line) => !line.account_id)) {
      setError(t('accountRequired'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = { entry_date: entryDate, description: description.trim() || null, lines: normalizedLines() };
      const target = editId ? `/manual-journals/${editId}` : '/manual-journals';
      const response = await api<{ data: ManualJournal }>(target, { method: editId ? 'PUT' : 'POST', body });
      success(editId ? t('draftUpdated') : t('draftSaved'));
      router.push(`/manual-journals/${response.data.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [description, editId, entryDate, lines, router, success, t, tc]);

  return (
    <FormPage
      width="wide"
      backHref="/manual-journals"
      backLabel={t('back')}
      title={t(editId ? 'editTitle' : 'newTitle')}
      description={t('draftHint')}
      status={<Badge tone="muted">{t('draft')}</Badge>}
      actions={
        <FormActions
          secondary={<Button asChild type="button" variant="outline"><Link href='/manual-journals'>{t('cancel')}</Link></Button>}
          primary={<Button type="button" disabled={saving} onClick={submit}>{saving ? t('saving') : t('saveDraft')}</Button>}
          note={balanced ? undefined : t('notBalanced')}
        />
      }
    >
      <FormSection title={t('details')}>
        <FieldGrid columns={3}>
          {!editId && <NumberPreviewField id="manual-journal-number" label={t('number')} number={suggestedNumber} loading={loadingNumber} />}
          <div className="space-y-1.5">
            <Label htmlFor="entry-date">{t('entryDate')}</Label>
            <Input id="entry-date" type="date" dir="ltr" value={entryDate} onChange={(event) => setEntryDate(event.target.value)} />
          </div>
          <FieldSpan className="space-y-1.5 lg:col-span-2">
            <Label htmlFor="description">{t('description')}</Label>
            <Input id="description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t('descriptionPlaceholder')} />
          </FieldSpan>
        </FieldGrid>
      </FormSection>

      <FormSection
        title={t('lines')}
        action={<Button variant="outline" size="sm" onClick={addLine}><Plus className="h-4 w-4" strokeWidth={1.8} />{t('addLine')}</Button>}
        contentClassName="space-y-3"
      >
          <div className="hidden grid-cols-[minmax(13rem,2fr)_minmax(10rem,1.5fr)_7.5rem_7.5rem_minmax(10rem,1.25fr)_minmax(10rem,1.25fr)_2.5rem] gap-2 text-xs font-medium text-muted xl:grid">
            <span>{t('account')}</span><span>{t('lineDescription')}</span><span className="text-end">{t('debit')}</span><span className="text-end">{t('credit')}</span><span>{t('costCenter')}</span><span>{t('partner')}</span><span />
          </div>
          {lines.map((line, index) => (
            <div key={index} className="grid grid-cols-1 gap-2 rounded-md border border-border p-3 xl:grid-cols-[minmax(13rem,2fr)_minmax(10rem,1.5fr)_7.5rem_7.5rem_minmax(10rem,1.25fr)_minmax(10rem,1.25fr)_2.5rem] xl:border-0 xl:p-0">
              <div className="space-y-1 xl:space-y-0"><Label className="xl:sr-only">{t('account')}</Label><Select value={line.account_id} onChange={(event) => updateLine(index, 'account_id', event.target.value)}><option value="">{t('selectAccount')}</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}</Select></div>
              <div className="space-y-1 xl:space-y-0"><Label className="xl:sr-only">{t('lineDescription')}</Label><Input value={line.description} onChange={(event) => updateLine(index, 'description', event.target.value)} placeholder={t('lineDescription')} /></div>
              <div className="space-y-1 xl:space-y-0"><Label className="xl:sr-only">{t('debit')}</Label><Input inputMode="decimal" className="num text-end" value={line.debit} onChange={(event) => updateLine(index, 'debit', event.target.value)} placeholder="0.00" /></div>
              <div className="space-y-1 xl:space-y-0"><Label className="xl:sr-only">{t('credit')}</Label><Input inputMode="decimal" className="num text-end" value={line.credit} onChange={(event) => updateLine(index, 'credit', event.target.value)} placeholder="0.00" /></div>
              <div className="space-y-1 xl:space-y-0"><Label className="xl:sr-only">{t('costCenter')}</Label><Select value={line.cost_center_id} onChange={(event) => updateLine(index, 'cost_center_id', event.target.value)}><option value="">{t('noCostCenter')}</option>{centers.map((center) => <option key={center.id} value={center.id}>{center.code} — {center.name}</option>)}</Select></div>
              <div className="space-y-1 xl:space-y-0"><Label className="xl:sr-only">{t('partner')}</Label><Select value={line.partner_id} onChange={(event) => updateLine(index, 'partner_id', event.target.value)}><option value="">{t('noPartner')}</option>{partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.name}</option>)}</Select></div>
              <Button variant="ghost" size="icon" disabled={lines.length <= 2} onClick={() => removeLine(index)} aria-label={t('removeLine')}><Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} /></Button>
            </div>
          ))}
      </FormSection>

      {/* عمودان على الجوال لا عمود واحد: أربعة أرقام مكدّسة رأسياً تدفع مؤشّر
          التوازن — وهو أهمّها — خارج الشاشة تماماً. */}
      <Card>
        <CardContent className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4">
          <div><p className="text-sm text-muted">{t('totalDebit')}</p><p className="num mt-1 text-lg font-semibold text-text">{formatRiyal(totals.debit / 100)}</p></div>
          <div><p className="text-sm text-muted">{t('totalCredit')}</p><p className="num mt-1 text-lg font-semibold text-text">{formatRiyal(totals.credit / 100)}</p></div>
          <div><p className="text-sm text-muted">{t('difference')}</p><p className={`num mt-1 text-lg font-semibold ${balanced ? 'text-positive' : 'text-negative'}`}>{formatRiyal(Math.abs(difference) / 100)}</p></div>
          <div className="flex items-end"><span className={`rounded-md px-3 py-2 text-sm font-medium ${balanced ? 'bg-positive/10 text-positive' : 'bg-negative/10 text-negative'}`}>{balanced ? t('balanced') : t('notBalanced')}</span></div>
        </CardContent>
      </Card>

      {error && <FormAlert>{error}</FormAlert>}
    </FormPage>
  );
}
