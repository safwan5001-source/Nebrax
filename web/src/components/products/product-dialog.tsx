'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { riyalToMinor, formatRiyal, extractInclusiveTax } from '@/lib/money';
import { getSystemTaxInclusive } from '@/lib/tax';

export interface Product {
  id: string;
  sku: string | null;
  barcode: string | null;
  name: string;
  name_en: string | null;
  type: string;
  unit: string;
  description: string | null;
  category: string | null;
  brand: string | null;
  reorder_level: number | null;
  min_sale_price: string | null;
  discount: number | null;
  discount_type: string | null;
  profit_margin: number | null;
  tags: string | null;
  internal_notes: string | null;
  sales_account_id: string | null;
  cogs_account_id: string | null;
  sale_price: string;
  purchase_price: string;
  tax_rate: number;
  track_inventory: boolean;
  quantity_on_hand: number;
  avg_cost: string;
  is_active: boolean;
}

interface FormState {
  name: string;
  sku: string;
  barcode: string;
  name_en: string;
  type: string;
  unit: string;
  description: string;
  category: string;
  brand: string;
  reorder_level: string;
  min_sale_price: string;
  discount: string;
  discount_type: string;
  profit_margin: string;
  tags: string;
  internal_notes: string;
  sales_account_id: string;
  cogs_account_id: string;
  sale_price: string;
  purchase_price: string;
  tax_rate: string;
  track_inventory: boolean;
  is_active: boolean;
}

interface Acct { id: string; code: string; name: string; type: string; is_group: boolean }

const emptyForm = (): FormState => ({
  name: '', sku: '', barcode: '', name_en: '', type: 'good', unit: 'piece',
  description: '', category: '', brand: '', reorder_level: '',
  min_sale_price: '', discount: '', discount_type: 'percent', profit_margin: '', tags: '', internal_notes: '',
  sales_account_id: '', cogs_account_id: '',
  sale_price: '', purchase_price: '', tax_rate: '15', track_inventory: false, is_active: true,
});

function fromProduct(p: Product): FormState {
  return {
    name: p.name, sku: p.sku ?? '', barcode: p.barcode ?? '', name_en: p.name_en ?? '', type: p.type, unit: p.unit,
    description: p.description ?? '', category: p.category ?? '', brand: p.brand ?? '', reorder_level: p.reorder_level != null ? String(p.reorder_level) : '',
    min_sale_price: p.min_sale_price ?? '', discount: p.discount != null ? String(p.discount) : '', discount_type: p.discount_type ?? 'percent',
    profit_margin: p.profit_margin != null ? String(p.profit_margin) : '', tags: p.tags ?? '', internal_notes: p.internal_notes ?? '',
    sales_account_id: p.sales_account_id ?? '', cogs_account_id: p.cogs_account_id ?? '',
    sale_price: p.sale_price, purchase_price: p.purchase_price, tax_rate: String(p.tax_rate),
    track_inventory: p.track_inventory, is_active: p.is_active,
  };
}

export function ProductDialog({
  open,
  onClose,
  onSaved,
  product,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  product?: Product | null;
}) {
  const t = useTranslations('products');
  const tc = useTranslations('common');
  const { success } = useToast();
  const [form, setForm] = useState<FormState>(product ? fromProduct(product) : emptyForm());
  const [revenueAccounts, setRevenueAccounts] = useState<Acct[]>([]);
  const [expenseAccounts, setExpenseAccounts] = useState<Acct[]>([]);
  const [taxInclusive, setTaxInclusive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    getSystemTaxInclusive().then(setTaxInclusive).catch(() => {});
    api<{ data: Acct[] }>('/accounts')
      .then((r) => {
        const leaf = r.data.filter((a) => !a.is_group);
        setRevenueAccounts(leaf.filter((a) => a.type === 'revenue'));
        setExpenseAccounts(leaf.filter((a) => a.type === 'expense'));
      })
      .catch(() => {});
  }, [open]);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      name: form.name,
      name_en: form.name_en || null,
      sku: form.sku || null,
      barcode: form.barcode || null,
      type: form.type,
      unit: form.unit || null,
      description: form.description || null,
      category: form.category || null,
      brand: form.brand || null,
      reorder_level: form.track_inventory && form.reorder_level !== '' ? Number(form.reorder_level) || 0 : null,
      min_sale_price: form.min_sale_price !== '' ? riyalToMinor(form.min_sale_price) : null,
      discount: form.discount !== '' ? Number(form.discount) || 0 : null,
      discount_type: form.discount !== '' ? form.discount_type : null,
      profit_margin: form.profit_margin !== '' ? Number(form.profit_margin) || 0 : null,
      tags: form.tags || null,
      internal_notes: form.internal_notes || null,
      sales_account_id: form.sales_account_id || null,
      cogs_account_id: form.cogs_account_id || null,
      sale_price: riyalToMinor(form.sale_price),
      purchase_price: riyalToMinor(form.purchase_price),
      tax_rate: Number(form.tax_rate) || 0,
      track_inventory: form.track_inventory,
      is_active: form.is_active,
    };
    try {
      if (product?.id) {
        await api(`/products/${product.id}`, { method: 'PUT', body });
        success(tc('updated'));
      } else {
        await api('/products', { method: 'POST', body });
        success(tc('created'));
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={product?.id ? t('edit') : t('add')} className="max-w-xl">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="name">{t('name')}</Label>
            <Input id="name" value={form.name} onChange={(e) => set('name', e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sku">{t('sku')}</Label>
            <Input id="sku" dir="ltr" value={form.sku} onChange={(e) => set('sku', e.target.value)} />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="barcode">{t('barcode')}</Label>
            <Input id="barcode" dir="ltr" className="num" value={form.barcode} onChange={(e) => set('barcode', e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="type">{t('type')}</Label>
            <Select id="type" value={form.type} onChange={(e) => set('type', e.target.value)}>
              <option value="good">{t('good')}</option>
              <option value="service">{t('service')}</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="unit">{t('unit')}</Label>
            <Input id="unit" value={form.unit} onChange={(e) => set('unit', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="category">{t('category')}</Label>
            <Input id="category" value={form.category} onChange={(e) => set('category', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="brand">{t('brand')}</Label>
            <Input id="brand" value={form.brand} onChange={(e) => set('brand', e.target.value)} />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="description">{t('description')}</Label>
            <textarea id="description" rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-primary" />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="sale_price">{t('sale_price')}</Label>
            <Input id="sale_price" className="num text-end" inputMode="decimal" value={form.sale_price} onChange={(e) => set('sale_price', e.target.value)} required />
            {(() => {
              // تلميح وضع الضريبة (من إعدادات النظام): يوضّح دلالة السعر ويعرض المكمّل.
              const pm = riyalToMinor(form.sale_price);
              const rate = Number(form.tax_rate) || 0;
              if (!Number.isFinite(pm) || pm <= 0 || rate <= 0) return null;
              const other = taxInclusive ? pm - extractInclusiveTax(pm, rate) : pm + Math.round((pm * rate) / 100);
              return (
                <p className="text-[11px] text-muted">
                  {t(taxInclusive ? 'price_hint_incl' : 'price_hint_excl', { amount: formatRiyal(other / 100) })}
                </p>
              );
            })()}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="purchase_price">{t('purchase_price')}</Label>
            <Input id="purchase_price" className="num text-end" inputMode="decimal" value={form.purchase_price} onChange={(e) => set('purchase_price', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tax_rate">{t('tax_rate')}</Label>
            <Input id="tax_rate" className="num text-end" type="number" min={0} max={100} value={form.tax_rate} onChange={(e) => set('tax_rate', e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="min_sale">{t('min_sale_price')}</Label>
            <Input id="min_sale" className="num text-end" inputMode="decimal" value={form.min_sale_price} onChange={(e) => set('min_sale_price', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="margin">{t('profit_margin')}</Label>
            <Input id="margin" className="num text-end" type="number" min={0} value={form.profit_margin} onChange={(e) => set('profit_margin', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="disc">{t('discount')}</Label>
            <div className="flex gap-1.5">
              <Input id="disc" className="num text-end" type="number" min={0} value={form.discount} onChange={(e) => set('discount', e.target.value)} />
              <Select className="w-16" value={form.discount_type} onChange={(e) => set('discount_type', e.target.value)}>
                <option value="percent">%</option>
                <option value="amount">﷼</option>
              </Select>
            </div>
          </div>
        </div>

        {(revenueAccounts.length > 0 || expenseAccounts.length > 0) && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sales_acc">{t('sales_account')}</Label>
              <Select id="sales_acc" value={form.sales_account_id} onChange={(e) => set('sales_account_id', e.target.value)}>
                <option value="">{t('default_account')}</option>
                {revenueAccounts.map((a) => (<option key={a.id} value={a.id}>{a.code} — {a.name}</option>))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cogs_acc">{t('cogs_account')}</Label>
              <Select id="cogs_acc" value={form.cogs_account_id} onChange={(e) => set('cogs_account_id', e.target.value)}>
                <option value="">{t('default_account')}</option>
                {expenseAccounts.map((a) => (<option key={a.id} value={a.id}>{a.code} — {a.name}</option>))}
              </Select>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="tags">{t('tags')}</Label>
            <Input id="tags" placeholder={t('tags_hint')} value={form.tags} onChange={(e) => set('tags', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="internal_notes">{t('internal_notes')}</Label>
            <Input id="internal_notes" value={form.internal_notes} onChange={(e) => set('internal_notes', e.target.value)} />
          </div>
        </div>

        <div className="flex items-center gap-6 pt-1">
          <label className="flex items-center gap-2 text-sm text-text">
            <input type="checkbox" checked={form.track_inventory} onChange={(e) => set('track_inventory', e.target.checked)} />
            {t('track_inventory')}
          </label>
          <label className="flex items-center gap-2 text-sm text-text">
            <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
            {t('active')}
          </label>
        </div>

        {form.track_inventory && (
          <div className="space-y-1.5">
            <Label htmlFor="reorder">{t('reorder_level')}</Label>
            <Input id="reorder" className="num text-end w-40" type="number" min={0} value={form.reorder_level} onChange={(e) => set('reorder_level', e.target.value)} />
          </div>
        )}

        {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={saving}>
            {t('save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
