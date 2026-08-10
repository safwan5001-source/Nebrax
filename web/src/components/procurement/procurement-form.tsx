'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, Plus, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { formatRiyal, riyalToMinor } from '@/lib/money';
import { PROCUREMENT_ROUTE, REQUIRES_SUPPLIER, type ProcurementType } from '@/lib/procurement';

interface Partner { id: string; name: string }
interface Product { id: string; name: string; cost_price: string; sale_price: string; tax_rate: number; is_active: boolean }
interface Line { key: string; productId: string | null; description: string; qty: string; price: string; tax: string }

let seq = 0;
const newLine = (): Line => ({ key: `pl${++seq}`, productId: null, description: '', qty: '1', price: '', tax: '15' });

/**
 * نموذج إنشاء مستند شراء — مشترك بين الأنواع الأربعة.
 *
 * الفارق الجوهري عن نماذج المبيعات: **السعر اختياري**. طلب الشراء وطلب
 * العروض يحدّدان المطلوب لا ثمنه، فسطرٌ بلا سعر مستندٌ صحيح لا سطر ناقص —
 * ولذلك تُرسَل السطور بكمياتها ولو كان السعر صفراً.
 */
export function ProcurementForm({ type }: { type: ProcurementType }) {
  const t = useTranslations('procurement');
  const tf = useTranslations('invoiceForm');
  const tc = useTranslations('common');
  const router = useRouter();
  const { success } = useToast();

  const needsSupplier = REQUIRES_SUPPLIER.includes(type);
  const isRfq = type === 'rfq';
  const route = PROCUREMENT_ROUTE[type];

  const [partners, setPartners] = useState<Partner[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [partnerId, setPartnerId] = useState('');
  const [supplierIds, setSupplierIds] = useState<string[]>([]);
  const [requestedBy, setRequestedBy] = useState('');
  const [date, setDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDate(new Date().toISOString().slice(0, 10));
    api<{ data: Partner[] }>('/partners?type=supplier').then((r) => setPartners(r.data)).catch(() => {});
    api<{ data: Product[] }>('/products').then((r) => setProducts(r.data.filter((p) => p.is_active))).catch(() => {});
  }, []);

  const setLine = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, newLine()]);
  const removeLine = (key: string) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));

  function pickProduct(key: string, productId: string) {
    const p = products.find((x) => x.id === productId);
    if (!p) return setLine(key, { productId: null });
    // تكلفة الشراء لا سعر البيع — هذا مستند شراء.
    setLine(key, { productId: p.id, description: p.name, price: p.cost_price, tax: String(p.tax_rate) });
  }

  const toggleSupplier = (id: string) =>
    setSupplierIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const subMinor = lines.reduce((s, l) => s + (Number(l.qty) || 0) * riyalToMinor(l.price), 0);
  const taxMinor = lines.reduce((s, l) => {
    const sub = (Number(l.qty) || 0) * riyalToMinor(l.price);
    return s + Math.round((sub * (Number(l.tax) || 0)) / 100);
  }, 0);

  async function submit() {
    // سطرٌ بلا سعر مقبول هنا — يكفي أن يحمل كمية ووصفاً أو منتجاً.
    const items = lines
      .filter((l) => (Number(l.qty) || 0) > 0 && (l.productId || l.description.trim() !== ''))
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
      const created = await api<{ data: { id: string } }>('/procurement', {
        method: 'POST',
        body: {
          type,
          partner_id: needsSupplier ? partnerId : null,
          doc_date: date || null,
          due_date: dueDate || null,
          requested_by: requestedBy || null,
          notes: notes || null,
          supplier_ids: isRfq && supplierIds.length > 0 ? supplierIds : undefined,
          items,
        },
      });
      success(tc('created'));
      router.push(`${route}/${created.data.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push(route)} aria-label={t('back')}>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <h1 className="text-xl font-semibold text-text">{t(`${type}.new_title`)}</h1>
      </div>

      <Card>
        <CardHeader><CardTitle>{t('details')}</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {needsSupplier && (
              <div className="space-y-1.5">
                <Label htmlFor="partner">{t('supplier')}</Label>
                <Select id="partner" value={partnerId} onChange={(e) => setPartnerId(e.target.value)} required>
                  <option value="" disabled>{tf('choose_partner')}</option>
                  {partners.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="requested-by">{t('requested_by')}</Label>
              <Input id="requested-by" value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="date">{t('date')}</Label>
              <Input id="date" type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="due">{t(`${type}.due_label`)}</Label>
              <Input id="due" type="date" dir="ltr" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
              <Label htmlFor="notes">{t('notes')}</Label>
              <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {isRfq && (
        <Card>
          <CardHeader><CardTitle>{t('invited')}</CardTitle></CardHeader>
          <CardContent>
            {partners.length === 0 ? (
              <p className="text-sm text-muted">{t('no_suppliers')}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {partners.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggleSupplier(p.id)}
                    aria-pressed={supplierIds.includes(p.id)}
                    className={`rounded-full border px-3 py-1 text-xs transition ${
                      supplierIds.includes(p.id)
                        ? 'border-primary bg-primary-soft text-primary'
                        : 'border-border text-muted hover:text-text'
                    }`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
            <div className="col-span-2 text-end">{t('unit_cost')}</div>
            <div className="col-span-1 text-end">{tf('tax')}</div>
            <div className="col-span-1 text-end">{tf('total')}</div>
            <div className="col-span-1" />
          </div>

          {lines.map((l) => {
            const lt = (Number(l.qty) || 0) * riyalToMinor(l.price);
            const lx = Math.round((lt * (Number(l.tax) || 0)) / 100);
            return (
              <div key={l.key} className="grid grid-cols-2 items-center gap-2 rounded border border-border p-2 md:grid-cols-12 md:border-0 md:p-0">
                <Select className="col-span-2 md:col-span-3" value={l.productId ?? ''} onChange={(e) => pickProduct(l.key, e.target.value)}>
                  <option value="">{tf('manual')}</option>
                  {products.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                </Select>
                <Input className="col-span-2 md:col-span-3" placeholder={tf('description')} value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value, productId: null })} />
                <Input className="num text-end md:col-span-1" type="number" min={1} value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} />
                <Input className="num text-end md:col-span-2" inputMode="decimal" placeholder={t('optional_price')} value={l.price} onChange={(e) => setLine(l.key, { price: e.target.value })} />
                <Input className="num text-end md:col-span-1" type="number" min={0} max={100} value={l.tax} onChange={(e) => setLine(l.key, { tax: e.target.value })} />
                <div className="num col-span-1 text-end text-sm md:col-span-1">{formatRiyal((lt + lx) / 100)}</div>
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
          <Button disabled={saving || (needsSupplier && !partnerId)} onClick={submit}>{t('save')}</Button>
        </div>
      </div>
    </div>
  );
}
