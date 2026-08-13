'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, Plus, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { PartnerDialog } from '@/components/partners/partner-dialog';
import { ProductDialog } from '@/components/products/product-dialog';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { formatRiyal, riyalToMinor, extractInclusiveTax } from '@/lib/money';
import { getSystemTaxInclusive } from '@/lib/tax';

interface Partner { id: string; name: string; type: string; phone?: string | null; vat_number?: string | null }
interface Product {
  id: string; name: string; sku?: string | null; barcode?: string | null;
  sale_price: string; tax_rate: number; is_active: boolean;
  track_inventory?: boolean; quantity_on_hand?: number;
}
interface Line { key: string; productId: string | null; description: string; qty: string; price: string; tax: string }

let seq = 0;
const newLine = (): Line => ({ key: `l${++seq}`, productId: null, description: '', qty: '1', price: '', tax: '15' });

export default function NewQuotePage() {
  const t = useTranslations('quotes');
  const tf = useTranslations('invoiceForm');
  const tc = useTranslations('common');
  const router = useRouter();
  const { success } = useToast();

  const [partners, setPartners] = useState<Partner[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [partnerId, setPartnerId] = useState('');
  const [date, setDate] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [taxInclusive, setTaxInclusive] = useState(false);
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newPartner, setNewPartner] = useState(false);
  const [newProductFor, setNewProductFor] = useState<string | null>(null);

  // **الموردون لا يُعرَض عليهم سعر.** كانت القائمة تُحمَّل بلا تصفية، فيظهر
  // المورّدون بين عملاء عرض السعر — والأسوأ أن أوّلهم كان يُختار تلقائياً.
  const loadPartners = useCallback(
    () => api<{ data: Partner[] }>('/partners')
      .then((r) => setPartners(r.data.filter((p) => ['customer', 'both'].includes(p.type))))
      .catch(() => {}),
    []
  );
  const loadProducts = useCallback(
    () => api<{ data: Product[] }>('/products')
      .then((r) => setProducts(r.data.filter((p) => p.is_active)))
      .catch(() => {}),
    []
  );

  useEffect(() => {
    setDate(new Date().toISOString().slice(0, 10));
    loadPartners();
    loadProducts();
    // الوضع الافتراضي من إعدادات النظام (كالفاتورة).
    getSystemTaxInclusive().then(setTaxInclusive).catch(() => {});
  }, [loadPartners, loadProducts]);

  // الرقم الضريبي في `sub` والهاتف في `hint` — كلاهما يُبحث فيه.
  const partnerOptions = useMemo<ComboOption[]>(
    () => partners.map((p) => ({
      value: p.id, label: p.name,
      sub: p.vat_number ?? undefined,
      hint: p.phone ?? undefined,
    })),
    [partners]
  );
  // الرمز والباركود معاً في السطر الثاني — يُبحث فيهما، فيَمسح المستخدم
  // الباركود أو يكتب رقم الصنف حسب ما بين يديه.
  const productOptions = useMemo<ComboOption[]>(
    () => products.map((p) => ({
      value: p.id, label: p.name,
      sub: [p.sku, p.barcode].filter(Boolean).join('  ·  ') || undefined,
      hint: p.track_inventory ? `${tf('balance')} ${p.quantity_on_hand ?? 0}` : undefined,
    })),
    [products, tf]
  );

  // ضريبة السطر حسب الوضع: متضمَّن = تُستخرَج من السعر؛ غير متضمَّن = تُضاف فوقه.
  const lineTax = (grossMinor: number, rate: number) =>
    taxInclusive ? extractInclusiveTax(grossMinor, rate) : Math.round((grossMinor * rate) / 100);

  const setLine = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, newLine()]);
  const removeLine = (key: string) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));

  function pickProduct(key: string, productId: string) {
    const p = products.find((x) => x.id === productId);
    if (!p) return setLine(key, { productId: null });
    setLine(key, { productId: p.id, description: p.name, price: p.sale_price, tax: String(p.tax_rate) });
  }

  // الإجماليات حسب الوضع: متضمَّن = المجموع قبل الضريبة = الإجمالي − الضريبة المستخرَجة.
  const { subMinor, taxMinor } = lines.reduce(
    (acc, l) => {
      const gross = (Number(l.qty) || 0) * riyalToMinor(l.price);
      const tax = lineTax(gross, Number(l.tax) || 0);
      acc.subMinor += taxInclusive ? gross - tax : gross;
      acc.taxMinor += tax;
      return acc;
    },
    { subMinor: 0, taxMinor: 0 },
  );

  async function submit() {
    const items = lines
      .filter((l) => riyalToMinor(l.price) > 0)
      .map((l) => ({
        product_id: l.productId,
        description: l.description || null,
        quantity: Number(l.qty) || 1,
        unit_price: riyalToMinor(l.price),
        tax_rate: Number(l.tax) || 0,
      }));
    if (items.length === 0) {
      setError(tf('need_line'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await api<{ data: { id: string } }>('/quotes', {
        method: 'POST',
        body: { partner_id: partnerId, quote_date: date || null, valid_until: validUntil || null, tax_inclusive: taxInclusive, notes: notes || null, items },
      });
      success(tc('created'));
      router.push(`/quotes/${created.data.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push('/quotes')} aria-label={t('back')}>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <h1 className="text-xl font-semibold text-text">{t('new_title')}</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('details')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="partner">{t('partner')}</Label>
              <div className="flex items-center gap-2">
                <Combobox
                  id="partner"
                  className="min-w-0 flex-1"
                  value={partnerId}
                  onChange={setPartnerId}
                  options={partnerOptions}
                  placeholder={tf('choose_partner')}
                  searchPlaceholder={tf('search_partner')}
                  emptyText={tf('no_partner_found')}
                />
                <Button type="button" variant="outline" onClick={() => setNewPartner(true)}>
                  <Plus className="h-4 w-4" strokeWidth={1.7} />
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="date">{t('date')}</Label>
              <Input id="date" type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="valid">{t('valid_until')}</Label>
              <Input id="valid" type="date" dir="ltr" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="taxmode">{tf('tax_mode')}</Label>
              <Select id="taxmode" value={taxInclusive ? '1' : '0'} onChange={(e) => setTaxInclusive(e.target.value === '1')}>
                <option value="0">{tf('tax_exclusive')}</option>
                <option value="1">{tf('tax_inclusive')}</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes">{t('notes')}</Label>
              <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t('lines')}</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={addLine}>
            <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
            {tf('add_line')}
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="hidden grid-cols-12 gap-2 px-1 text-xs text-muted md:grid">
            <div className="col-span-3">{tf('product')}</div>
            <div className="col-span-3">{tf('description')}</div>
            <div className="col-span-1 text-end">{tf('qty')}</div>
            <div className="col-span-2 text-end">{tf('price')}</div>
            <div className="col-span-1 text-end">{tf('tax')}</div>
            <div className="col-span-1 text-end">{tf('total')}</div>
            <div className="col-span-1" />
          </div>

          {lines.map((l) => {
            const lt = (Number(l.qty) || 0) * riyalToMinor(l.price);
            // إجمالي السطر: متضمَّن = السعر نفسه (شامل)؛ غير متضمَّن = السعر + الضريبة.
            const lineDisplayTotal = taxInclusive ? lt : lt + lineTax(lt, Number(l.tax) || 0);
            return (
              <div key={l.key} className="grid grid-cols-2 items-center gap-2 rounded border border-border p-2 md:grid-cols-12 md:border-0 md:p-0">
                <Combobox
                  className="col-span-2 md:col-span-3"
                  value={l.productId ?? ''}
                  onChange={(v) => pickProduct(l.key, v)}
                  options={productOptions}
                  placeholder={tf('manual')}
                  searchPlaceholder={tf('search_product')}
                  emptyText={tf('no_product_found')}
                  clearLabel={tf('manual')}
                  footerLabel={tf('new_product')}
                  onFooterClick={() => setNewProductFor(l.key)}
                  aria-label={tf('product')}
                />
                <Input className="col-span-2 md:col-span-3" placeholder={tf('description')} value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value, productId: null })} />
                <Input className="num text-end md:col-span-1" type="number" min={1} value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} />
                <Input className="num text-end md:col-span-2" inputMode="decimal" placeholder={tf('price')} value={l.price} onChange={(e) => setLine(l.key, { price: e.target.value })} />
                <Input className="num text-end md:col-span-1" type="number" min={0} max={100} value={l.tax} onChange={(e) => setLine(l.key, { tax: e.target.value })} />
                <div className="num col-span-1 text-end text-sm md:col-span-1">{formatRiyal(lineDisplayTotal / 100)}</div>
                <Button type="button" variant="ghost" size="icon" className="col-span-1 ms-auto md:col-span-1" aria-label={tf('remove_line')} onClick={() => removeLine(l.key)}>
                  <Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} />
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <Card className="lg:w-72">
          <CardContent className="space-y-1.5 p-4 text-sm">
            <div className="flex justify-between text-muted"><span>{t('subtotal')}</span><span className="num">{formatRiyal(subMinor / 100)}</span></div>
            <div className="flex justify-between text-muted"><span>{t('tax_total')}</span><span className="num">{formatRiyal(taxMinor / 100)}</span></div>
            <div className="flex justify-between border-t border-border pt-1.5"><span className="font-semibold text-text">{t('total')}</span><span className="num text-lg font-bold text-text">{formatRiyal((subMinor + taxMinor) / 100)}</span></div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {error && <p className="self-center rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
          <Button disabled={saving || !partnerId} onClick={submit}>{t('save')}</Button>
        </div>
      </div>

      <PartnerDialog
        open={newPartner}
        onClose={() => setNewPartner(false)}
        onSaved={() => { setNewPartner(false); loadPartners(); }}
        defaultType="customer"
      />

      {/* المنتج المُنشأ يُختار في سطره فوراً — وإلا أعاد المستخدم البحث عمّا
          أنشأه للتوّ. الاختيار بعد إعادة الجلب لا قبلها. */}
      <ProductDialog
        open={newProductFor !== null}
        onClose={() => setNewProductFor(null)}
        onSaved={async () => {
          const key = newProductFor;
          setNewProductFor(null);
          const before = new Set(products.map((p) => p.id));
          const fresh = await api<{ data: Product[] }>('/products').catch(() => null);
          if (!fresh) { loadProducts(); return; }
          const active = fresh.data.filter((p) => p.is_active);
          setProducts(active);
          const created = active.find((p) => !before.has(p.id));
          if (key && created) {
            setLine(key, {
              productId: created.id, description: created.name,
              price: created.sale_price, tax: String(created.tax_rate),
            });
          }
        }}
      />
    </div>
  );
}
