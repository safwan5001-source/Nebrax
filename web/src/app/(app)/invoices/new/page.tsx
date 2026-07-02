'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, Plus, Trash2, FileText, Users, ShoppingCart, StickyNote } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { formatRiyal, riyalToMinor } from '@/lib/money';

interface Partner { id: string; name: string }
interface Product { id: string; name: string; sale_price: string; tax_rate: number; is_active: boolean }
interface Line { key: string; productId: string | null; description: string; qty: string; price: string; tax: string }

let lineSeq = 0;
const newLine = (): Line => ({ key: `l${++lineSeq}`, productId: null, description: '', qty: '1', price: '', tax: '15' });

/** يضيف عدداً من الأيام إلى تاريخ YYYY-MM-DD ويعيد YYYY-MM-DD (بلا مناطق زمنية). */
function addDays(date: string, days: number): string {
  if (!date) return '';
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export default function NewInvoicePage() {
  const t = useTranslations('invoiceForm');
  const tc = useTranslations('common');
  const router = useRouter();
  const { success } = useToast();

  const [partners, setPartners] = useState<Partner[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [partnerId, setPartnerId] = useState('');
  const [paymentType, setPaymentType] = useState('cash');
  const [date, setDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [terms, setTerms] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDate(new Date().toISOString().slice(0, 10));
    api<{ data: Partner[] }>('/partners').then((r) => {
      setPartners(r.data);
      if (r.data[0]) setPartnerId((p) => p || r.data[0].id);
    });
    api<{ data: Product[] }>('/products').then((r) => setProducts(r.data.filter((p) => p.is_active))).catch(() => {});
  }, []);

  // شروط الدفع (أيام) تشتقّ تاريخ الاستحقاق من تاريخ الفاتورة.
  function applyTerms(days: string, baseDate = date) {
    setTerms(days);
    const n = Number(days);
    if (baseDate && days !== '' && !Number.isNaN(n)) setDueDate(addDays(baseDate, n));
  }
  function changeDate(v: string) {
    setDate(v);
    if (terms !== '') setDueDate(addDays(v, Number(terms) || 0));
  }

  const setLine = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, newLine()]);
  const removeLine = (key: string) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));

  function pickProduct(key: string, productId: string) {
    const p = products.find((x) => x.id === productId);
    if (!p) { setLine(key, { productId: null }); return; }
    setLine(key, { productId: p.id, description: p.name, price: p.sale_price, tax: String(p.tax_rate) });
  }

  // معاينة الإجماليات (هللات) — بلا float.
  const subMinor = lines.reduce((s, l) => s + (Number(l.qty) || 0) * riyalToMinor(l.price), 0);
  const taxMinor = lines.reduce((s, l) => {
    const sub = (Number(l.qty) || 0) * riyalToMinor(l.price);
    return s + Math.round((sub * (Number(l.tax) || 0)) / 100);
  }, 0);
  const totalMinor = subMinor + taxMinor;

  const canSave = useMemo(() => !!partnerId && !saving, [partnerId, saving]);

  async function submit(post: boolean) {
    const items = lines
      .filter((l) => riyalToMinor(l.price) > 0)
      .map((l) => ({
        product_id: l.productId,
        description: l.description || null,
        quantity: Number(l.qty) || 1,
        unit_price: riyalToMinor(l.price),
        tax_rate: Number(l.tax) || 0,
      }));
    if (items.length === 0) { setError(t('need_line')); return; }
    setSaving(true);
    setError(null);
    try {
      const created = await api<{ data: { id: string } }>('/invoices', {
        method: 'POST',
        body: { partner_id: partnerId, payment_type: paymentType, invoice_date: date || null, due_date: dueDate || null, notes: notes || null, items },
      });
      if (post) await api(`/invoices/${created.data.id}/post`, { method: 'POST' });
      success(tc('created'));
      router.push(`/invoices/${created.data.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* شريط الإجراءات */}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push('/invoices')} aria-label={t('back')}>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <h1 className="text-xl font-semibold text-text">{t('new_title')}</h1>
        <div className="ms-auto flex items-center gap-2">
          <Button variant="ghost" onClick={() => router.push('/invoices')}>{t('cancel')}</Button>
          <Button variant="outline" disabled={!canSave} onClick={() => submit(false)}>{t('save_draft')}</Button>
          <Button disabled={!canSave} onClick={() => submit(true)}>{t('save_post')}</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_300px]">
        {/* العمود الرئيسي */}
        <div className="min-w-0 space-y-5">
          {/* العميل والدفع */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Users className="h-4 w-4 text-primary" strokeWidth={1.8} />{t('customer_section')}</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="partner">{t('partner')} <span className="text-negative">*</span></Label>
                  <Select id="partner" value={partnerId} onChange={(e) => setPartnerId(e.target.value)} required>
                    <option value="" disabled>{t('choose_partner')}</option>
                    {partners.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pt">{t('payment_type')}</Label>
                  <Select id="pt" value={paymentType} onChange={(e) => setPaymentType(e.target.value)}>
                    <option value="cash">{t('cash')}</option>
                    <option value="credit">{t('credit')}</option>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* بيانات الفاتورة */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-4 w-4 text-primary" strokeWidth={1.8} />{t('meta_section')}</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>{t('invoice_number')}</Label>
                  <div className="flex h-10 items-center rounded-md border border-border bg-background px-3 text-sm text-muted">{t('auto_number')}</div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="date">{t('invoice_date')}</Label>
                  <Input id="date" type="date" dir="ltr" value={date} onChange={(e) => changeDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="terms">{t('payment_terms')}</Label>
                  <div className="relative">
                    <Input id="terms" type="number" min={0} dir="ltr" className="num pe-14" value={terms} onChange={(e) => applyTerms(e.target.value)} />
                    <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs text-muted">{t('days')}</span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="due">{t('due_date')}</Label>
                  <Input id="due" type="date" dir="ltr" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* البنود */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2"><ShoppingCart className="h-4 w-4 text-primary" strokeWidth={1.8} />{t('lines')}</CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />{t('add_line')}
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="hidden grid-cols-12 gap-2 px-1 text-[11px] font-medium text-muted md:grid">
                <div className="col-span-3">{t('item')}</div>
                <div className="col-span-3">{t('description')}</div>
                <div className="col-span-2 text-end">{t('price')}</div>
                <div className="col-span-1 text-end">{t('qty')}</div>
                <div className="col-span-1 text-end">{t('tax')}</div>
                <div className="col-span-1 text-end">{t('total_with_vat')}</div>
                <div className="col-span-1" />
              </div>

              {lines.map((l) => {
                const lineTotal = (Number(l.qty) || 0) * riyalToMinor(l.price);
                const lineTax = Math.round((lineTotal * (Number(l.tax) || 0)) / 100);
                return (
                  <div key={l.key} className="grid grid-cols-2 items-center gap-2 rounded-lg border border-border p-2 md:grid-cols-12 md:border-0 md:p-0">
                    <Select className="col-span-2 md:col-span-3" value={l.productId ?? ''} onChange={(e) => pickProduct(l.key, e.target.value)}>
                      <option value="">{t('manual')}</option>
                      {products.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                    </Select>
                    <Input className="col-span-2 md:col-span-3" placeholder={t('description')} value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value, productId: null })} />
                    <Input className="num text-end md:col-span-2" inputMode="decimal" placeholder={t('price')} value={l.price} onChange={(e) => setLine(l.key, { price: e.target.value })} />
                    <Input className="num text-end md:col-span-1" type="number" min={1} value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} />
                    <Input className="num text-end md:col-span-1" type="number" min={0} max={100} value={l.tax} onChange={(e) => setLine(l.key, { tax: e.target.value })} />
                    <div className="num col-span-1 text-end text-sm text-text md:col-span-1">{formatRiyal((lineTotal + lineTax) / 100)}</div>
                    <Button type="button" variant="ghost" size="icon" className="col-span-1 ms-auto md:col-span-1" aria-label={t('remove_line')} onClick={() => removeLine(l.key)}>
                      <Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} />
                    </Button>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* الملاحظات */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><StickyNote className="h-4 w-4 text-primary" strokeWidth={1.8} />{t('notes')}</CardTitle></CardHeader>
            <CardContent>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="min-h-20 w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none placeholder:text-muted focus:border-primary"
                placeholder={t('notes')}
              />
            </CardContent>
          </Card>
        </div>

        {/* الملخّص الجانبي اللاصق */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <Card>
            <CardHeader><CardTitle>{t('summary_title')}</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between text-muted"><span>{t('subtotal')}</span><span className="num">{formatRiyal(subMinor / 100)}</span></div>
              <div className="flex justify-between text-muted"><span>{t('tax_total')}</span><span className="num">{formatRiyal(taxMinor / 100)}</span></div>
              <div className="flex items-baseline justify-between border-t border-border pt-2">
                <span className="font-semibold text-text">{t('total')}</span>
                <span className="num text-2xl font-bold text-primary-hover">{formatRiyal(totalMinor / 100)}</span>
              </div>
              {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
              <Button className="mt-2 w-full" disabled={!canSave} onClick={() => submit(true)}>{t('save_post')}</Button>
              <Button variant="outline" className="w-full" disabled={!canSave} onClick={() => submit(false)}>{t('save_draft')}</Button>
              <p className="pt-1 text-[11px] leading-relaxed text-muted">{t('summary_hint')}</p>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
