'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { riyalToMinor } from '@/lib/money';

export interface Product {
  id: string;
  sku: string | null;
  name: string;
  name_en: string | null;
  type: string;
  unit: string;
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
  name_en: string;
  type: string;
  unit: string;
  sale_price: string;
  purchase_price: string;
  tax_rate: string;
  track_inventory: boolean;
  is_active: boolean;
}

const emptyForm = (): FormState => ({
  name: '', sku: '', name_en: '', type: 'good', unit: 'piece',
  sale_price: '', purchase_price: '', tax_rate: '15', track_inventory: false, is_active: true,
});

function fromProduct(p: Product): FormState {
  return {
    name: p.name, sku: p.sku ?? '', name_en: p.name_en ?? '', type: p.type, unit: p.unit,
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
  const [error, setError] = useState<string | null>(null);
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
      type: form.type,
      unit: form.unit || null,
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
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="sale_price">{t('sale_price')}</Label>
            <Input id="sale_price" className="num text-end" inputMode="decimal" value={form.sale_price} onChange={(e) => set('sale_price', e.target.value)} required />
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
