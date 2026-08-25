'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { FileInput, Paperclip, Plus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FieldGrid, FieldSpan, FormActions, FormAlert, FormPage, FormSection } from '@/components/nebrax';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NumberPreviewField } from '@/components/ui/number-preview-field';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { PartnerDialog } from '@/components/partners/partner-dialog';
import { api, ApiError } from '@/lib/api';
import { useNumberPreview } from '@/lib/use-number-preview';
import { SAUDI_RIYAL_SYMBOL, formatRiyal, riyalToMinor } from '@/lib/money';

interface Account { id: string; code: string; name: string; type: string; is_group: boolean }
interface Partner { id: string; name: string; type?: string }
interface CostCenter { id: string; code: string; name: string; is_active: boolean }
interface ExpenseCategory { id: string; name: string; description?: string | null; is_active: boolean }

export default function NewExpensePage() {
  const t = useTranslations('expenses');
  const tc = useTranslations('common');
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get('edit');
  const { success } = useToast();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [centers, setCenters] = useState<CostCenter[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [centerId, setCenterId] = useState('');
  const [amount, setAmount] = useState('');
  const [tax, setTax] = useState('15');
  const [method, setMethod] = useState('cash');
  const [date, setDate] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newSupplierOpen, setNewSupplierOpen] = useState(false);
  const [newCategoryOpen, setNewCategoryOpen] = useState(false);
  const [categoryName, setCategoryName] = useState('');
  const [categoryDescription, setCategoryDescription] = useState('');
  const [savingCategory, setSavingCategory] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const { number: suggestedNumber, loading: loadingNumber } = useNumberPreview('expense', { date, enabled: !editId });

  const loadPartners = useCallback(() => {
    api<{ data: Partner[] }>('/partners')
      .then((r) => setPartners(r.data.filter((p) => ['supplier', 'both'].includes(p.type ?? ''))))
      .catch(() => {});
  }, []);

  const loadCategories = useCallback(() => {
    api<{ data: ExpenseCategory[] }>('/expense-categories')
      .then((r) => setCategories(r.data.filter((c) => c.is_active)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setDate(new Date().toISOString().slice(0, 10));
    api<{ data: Account[] }>('/accounts').then((r) => {
      const expenseAccounts = r.data.filter((a) => a.type === 'expense' && !a.is_group);
      setAccounts(expenseAccounts);
      if (expenseAccounts[0]) setAccountId((current) => current || expenseAccounts[0].id);
    });
    loadPartners();
    loadCategories();
    api<{ data: CostCenter[] }>('/cost-centers')
      .then((r) => setCenters(r.data.filter((c) => c.is_active)))
      .catch(() => {});
  }, [loadCategories, loadPartners]);

  useEffect(() => {
    if (!editId) return;

    api<{ data: { status: string; account_id: string; category_id?: string | null; partner_id?: string | null; vendor_name?: string | null; cost_center_id?: string | null; amount: string; tax_rate: number; payment_method: string; expense_date: string; description?: string | null } }>(`/expenses/${editId}`)
      .then((response) => {
        const draft = response.data;
        if (draft.status !== 'draft') {
          setError(t('edit_draft_only'));
          return;
        }
        setAccountId(draft.account_id);
        setCategoryId(draft.category_id ?? '');
        setPartnerId(draft.partner_id ?? '');
        setVendorName(draft.vendor_name ?? '');
        setCenterId(draft.cost_center_id ?? '');
        setAmount(String(draft.amount));
        setTax(String(draft.tax_rate));
        setMethod(draft.payment_method);
        setDate(draft.expense_date);
        setDescription(draft.description ?? '');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : t('load_detail_failed')));
  }, [editId, t]);

  const amountMinor = riyalToMinor(amount);
  const taxMinor = useMemo(
    () => Math.round((amountMinor * (Number(tax) || 0)) / 100),
    [amountMinor, tax],
  );

  function addFiles(nextFiles: FileList | null) {
    if (!nextFiles) return;
    setFiles((current) => [...current, ...Array.from(nextFiles)].slice(0, 10));
  }

  async function createCategory() {
    if (!categoryName.trim()) {
      setCategoryError(t('category_name_required'));
      return;
    }

    setSavingCategory(true);
    setCategoryError(null);
    try {
      const response = await api<{ data: ExpenseCategory }>('/expense-categories', {
        method: 'POST',
        body: { name: categoryName.trim(), description: categoryDescription.trim() || null },
      });
      setCategoryId(response.data.id);
      setCategoryName('');
      setCategoryDescription('');
      setNewCategoryOpen(false);
      loadCategories();
    } catch (err) {
      setCategoryError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSavingCategory(false);
    }
  }

  async function submit() {
    if (amountMinor <= 0) {
      setError(t('need_amount'));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const body = new FormData();
      body.append('account_id', accountId);
      if (categoryId) body.append('category_id', categoryId);
      if (partnerId) body.append('partner_id', partnerId);
      if (vendorName.trim()) body.append('vendor_name', vendorName.trim());
      if (centerId) body.append('cost_center_id', centerId);
      body.append('amount', String(amountMinor));
      body.append('tax_rate', String(Number(tax) || 0));
      body.append('payment_method', method);
      if (date) body.append('expense_date', date);
      if (description.trim()) body.append('description', description.trim());
      files.forEach((file) => body.append('attachments[]', file));

      const target = editId ? `/expenses/${editId}` : '/expenses';
      // PHP لا يضمن تحليل multipart في PUT؛ التمويه يحافظ على Route::put ويتيح رفع المرفقات.
      if (editId) body.append('_method', 'PUT');
      await api(target, { method: 'POST', body });
      success(editId ? t('draft_updated') : t('draft_saved'));
      router.push(editId ? `/expenses/${editId}` : '/expenses');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
      setSaving(false);
    }
  }

  const summaryAside = (
    <Card>
      <CardHeader><CardTitle>{t('summary')}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex justify-between gap-4 text-sm text-muted"><span>{t('subtotal')}</span><span className="num">{formatRiyal(amountMinor / 100)}</span></div>
        <div className="flex justify-between gap-4 text-sm text-muted"><span>{t('tax_total')}</span><span className="num">{formatRiyal(taxMinor / 100)}</span></div>
        <div className="flex justify-between gap-4 border-t border-border pt-3"><span className="font-semibold text-text">{t('total')}</span><span className="num text-lg font-bold text-text">{formatRiyal((amountMinor + taxMinor) / 100)}</span></div>
        {!editId && <>
          <Button asChild className="w-full" variant="outline">
            <Link href="/documents?document_type=expense&status=ready_for_draft">
              <FileInput className="h-4 w-4" aria-hidden="true" />
              {t('import_from_document')}
            </Link>
          </Button>
          <p className="text-xs leading-5 text-muted">{t('import_from_document_hint')}</p>
        </>}
      </CardContent>
    </Card>
  );

  return (
    <FormPage
      backHref="/expenses"
      backLabel={t('back')}
      title={t(editId ? 'edit_title' : 'new_title')}
      description={t('number_generated')}
      // `draft_mode` نصُّه «حفظ كمسودة» حرفياً كنصّ زرّ الحفظ، فيقرأ بجانبه كزرّ
      // حفظٍ ثانٍ. الشارة تصف حالة المستند، فتسميتها الصحيحة حالته: «مسودة».
      status={<Badge tone="muted">{t('draft')}</Badge>}
      aside={summaryAside}
      actions={
        <FormActions
          secondary={<Button asChild type="button" variant="outline"><Link href='/expenses'>{t('cancel')}</Link></Button>}
          primary={<Button type="button" disabled={saving || !accountId} onClick={submit}>{saving ? t('saving') : t('save_draft')}</Button>}
        />
      }
    >
      <FormSection title={t('details')} contentClassName="space-y-5">
        <FieldGrid>
          {!editId && <NumberPreviewField id="expense-number" label={t('number')} number={suggestedNumber} loading={loadingNumber} />}
          <div className="space-y-1.5">
            <Label htmlFor="amount">{t('amount')}</Label>
            <div className="flex rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-primary/40">
              <Input id="amount" inputMode="decimal" dir="ltr" className="num border-0 text-end shadow-none focus-visible:ring-0" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
              {/* رمز الريال المعتمد من المنسّق المركزي — لا «SAR» ولا «ريال» في أي واجهة بشرية. */}
              <span className="flex items-center border-s border-input px-3 font-medium text-muted" dir="ltr" aria-hidden="true">{SAUDI_RIYAL_SYMBOL}</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="date">{t('date')}</Label>
            <Input id="date" type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <FieldSpan className="space-y-1.5">
            <Label htmlFor="description">{t('description')}</Label>
            <textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-text outline-none transition focus-visible:ring-2 focus-visible:ring-primary/40" />
          </FieldSpan>
        </FieldGrid>

        <div className="space-y-1.5">
          <Label htmlFor="attachments">{t('attachments')}</Label>
          <label htmlFor="attachments" className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/40 px-4 text-center transition hover:border-primary/50 focus-within:ring-2 focus-within:ring-primary/40">
            <Paperclip className="h-5 w-5 text-primary" strokeWidth={1.7} />
            <span className="text-sm font-medium text-text">{t('attachment_prompt')}</span>
            <span className="text-xs text-muted">{t('attachment_hint')}</span>
            <Input id="attachments" type="file" multiple className="sr-only size-px" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.gif,.zip" onChange={(e) => addFiles(e.target.files)} />
          </label>
          {files.length > 0 && (
            <div className="space-y-1.5">
              {files.map((file, index) => (
                <div key={`${file.name}-${index}`} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
                  <span className="truncate text-text">{file.name}</span>
                  <Button variant="ghost" size="icon" onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={t('remove_attachment')}>
                    <X className="h-4 w-4" strokeWidth={1.8} />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </FormSection>

      <FormSection title={t('classification')}>
        <FieldGrid>
          <div className="space-y-1.5">
            <Label htmlFor="account">{t('account')}</Label>
            <Select id="account" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
              <option value="" disabled>{t('choose_account')}</option>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="category">{t('category')}</Label>
              <Button variant="ghost" size="sm" onClick={() => setNewCategoryOpen(true)}><Plus className="h-3.5 w-3.5" />{t('new_category')}</Button>
            </div>
            <Select id="category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">{t('no_category')}</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vendor_name">{t('vendor_name')}</Label>
            <Input id="vendor_name" value={vendorName} onChange={(e) => setVendorName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="supplier">{t('supplier')}</Label>
              <Button variant="ghost" size="sm" onClick={() => setNewSupplierOpen(true)}><Plus className="h-3.5 w-3.5" />{t('new_supplier')}</Button>
            </div>
            <Select id="supplier" value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
              <option value="">{t('none')}</option>
              {partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.name}</option>)}
            </Select>
          </div>
          {centers.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="center">{t('cost_center')}</Label>
              <Select id="center" value={centerId} onChange={(e) => setCenterId(e.target.value)}>
                <option value="">{t('no_center')}</option>
                {centers.map((center) => <option key={center.id} value={center.id}>{center.code} — {center.name}</option>)}
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="method">{t('payment_method')}</Label>
            <Select id="method" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="cash">{t('method.cash')}</option>
              <option value="bank">{t('method.bank')}</option>
              <option value="credit">{t('method.credit')}</option>
            </Select>
            <p className="text-xs text-muted">{t('treasury_deferred')}</p>
          </div>
        </FieldGrid>
      </FormSection>

      <FormSection title={t('tax_and_controls')}>
        <FieldGrid>
          <div className="space-y-1.5">
            <Label htmlFor="tax">{t('tax')}</Label>
            <Input id="tax" type="number" min={0} max={100} className="num text-end" dir="ltr" value={tax} onChange={(e) => setTax(e.target.value)} />
          </div>
          <div className="flex items-end">
            <label className="flex w-full cursor-not-allowed items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted">
              <input type="checkbox" disabled />
              <span>{t('recurring_soon')}</span>
            </label>
          </div>
        </FieldGrid>
      </FormSection>

      {error && <FormAlert>{error}</FormAlert>}

      <PartnerDialog
        open={newSupplierOpen}
        onClose={() => setNewSupplierOpen(false)}
        onSaved={loadPartners}
        defaultType="supplier"
        addTitle={t('new_supplier')}
      />

      <Dialog open={newCategoryOpen} onClose={() => setNewCategoryOpen(false)} title={t('new_category')}>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="category-name">{t('category_name')}</Label>
            <Input id="category-name" value={categoryName} onChange={(e) => setCategoryName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="category-description">{t('category_description')}</Label>
            <textarea id="category-description" value={categoryDescription} onChange={(e) => setCategoryDescription(e.target.value)} className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-text outline-none transition focus-visible:ring-2 focus-visible:ring-primary/40" />
          </div>
          {categoryError && <p className="rounded-md bg-negative/10 px-3 py-2 text-xs text-negative">{categoryError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setNewCategoryOpen(false)}>{t('cancel')}</Button>
            <Button disabled={savingCategory} onClick={createCategory}>{savingCategory ? t('saving') : t('save_category')}</Button>
          </div>
        </div>
      </Dialog>
    </FormPage>
  );
}
