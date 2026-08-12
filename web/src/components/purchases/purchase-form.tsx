'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, Plus, Trash2, Truck, Users, Package, FileText, Paperclip, Percent, Wallet, type LucideIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { useToast } from '@/components/ui/toast';
import { PartnerDialog } from '@/components/partners/partner-dialog';
import { ProductDialog } from '@/components/products/product-dialog';
import { api, ApiError } from '@/lib/api';
import { formatRiyal, riyalToMinor } from '@/lib/money';
import { getSystemTaxInclusive } from '@/lib/tax';

interface Partner { id: string; name: string; type: string; phone?: string | null; vat_number?: string | null }
interface ProductUnit { name: string; factor: number }
interface Product {
  id: string; name: string; sku: string | null; purchase_price: string;
  tax_rate: number; is_active: boolean; track_inventory: boolean;
  quantity_on_hand: number; units?: ProductUnit[];
}
interface CostCenter { id: string; code: string; name: string; is_active: boolean }

interface Line {
  key: string;
  productId: string | null;
  description: string;
  unit: string;
  qty: string;
  price: string;
  tax: string;
}

let lineSeq = 0;
const newLine = (): Line => ({
  key: `p${++lineSeq}`, productId: null, description: '', unit: '', qty: '1', price: '', tax: '15',
});

/**
 * ═══════════════════════════════════════════════════════════════
 *  نموذج فاتورة شراء
 * ═══════════════════════════════════════════════════════════════
 *  **لماذا صفحة كاملة بدل النافذة السابقة:** النافذة لم تكن تختار منتجاً
 *  أصلاً، فكل سطورها وصفية وتُرحَّل إلى «5150 مصروفات عامة» — أي أن البضاعة
 *  تُصرَف مصروف الفترة بدل أن تُرسمَل مخزوناً، ولا تدخل كمية ولا يتحرّك
 *  متوسط تكلفة. اختيار المنتج هنا هو الإصلاح، لا زينة.
 *
 *  **والسطر الوصفي يبقى متاحاً عمداً:** الشحن والتخليص على فاتورة المورّد
 *  مصروفٌ حقيقي **يجب** أن يذهب إلى 5150 لا إلى المخزون.
 */
export function PurchaseForm() {
  const t = useTranslations('purchaseForm');
  const tf = useTranslations('invoiceForm');
  const tc = useTranslations('common');
  const router = useRouter();
  const { success } = useToast();

  const [partners, setPartners] = useState<Partner[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [centers, setCenters] = useState<CostCenter[]>([]);

  const [partnerId, setPartnerId] = useState('');
  const [centerId, setCenterId] = useState('');
  const [paymentType, setPaymentType] = useState('credit');
  const [date, setDate] = useState('');
  const [termDays, setTermDays] = useState('');
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('');
  const [taxInclusive, setTaxInclusive] = useState(false);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [newSupplier, setNewSupplier] = useState(false);
  // السطر الذي فُتحت من منتقيه نافذة «منتج جديد» — ليُختار فيه تلقائياً بعد الحفظ.
  const [newProductFor, setNewProductFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadPartners = useCallback(
    () => api<{ data: Partner[] }>('/partners')
      .then((r) => setPartners(r.data.filter((p) => ['supplier', 'both'].includes(p.type))))
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
    api<{ data: CostCenter[] }>('/cost-centers').then((r) => setCenters(r.data.filter((c) => c.is_active))).catch(() => {});
    getSystemTaxInclusive().then(setTaxInclusive).catch(() => {});
  }, [loadPartners, loadProducts]);

  // الرقم الضريبي في `sub` ليبحث فيه المنتقي فعلاً — نصّ البحث يَعِد به.
  const supplierOptions = useMemo<ComboOption[]>(
    () => partners.map((p) => ({
      value: p.id, label: p.name,
      sub: p.vat_number ?? undefined,
      hint: p.phone ?? undefined,
    })),
    [partners]
  );
  const productOptions = useMemo<ComboOption[]>(
    () => products.map((p) => ({
      value: p.id,
      label: p.name,
      sub: p.sku ?? undefined,
      // الرصيد للمتابَع مخزونياً وحده — «الرصيد ٠» على خدمةٍ رقمٌ بلا معنى.
      hint: p.track_inventory ? `${t('balance')} ${p.quantity_on_hand}` : undefined,
    })),
    [products, t]
  );

  const setLine = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, newLine()]);
  const removeLine = (key: string) =>
    setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : [newLine()]));

  /** اختيار المنتج يملأ التكلفة والضريبة، ويُصفّر الوحدة (قالب المنتج تغيّر). */
  function pickProduct(key: string, productId: string) {
    const p = products.find((x) => x.id === productId);
    if (!p) { setLine(key, { productId: null, unit: '' }); return; }
    setLine(key, {
      productId: p.id, description: p.name, price: p.purchase_price,
      tax: String(p.tax_rate), unit: '',
    });
  }

  // معاينة الإجماليات بالهللات — بلا float، مطابقة للـ backend.
  const lineGross = (l: Line) => (Number(l.qty) || 0) * riyalToMinor(l.price);
  const totals = useMemo(() => {
    let net = 0, tax = 0;
    for (const l of lines) {
      const gross = lineGross(l);
      const rate = Number(l.tax) || 0;
      if (taxInclusive) {
        const t = rate <= 0 || gross <= 0 ? 0 : Math.round((gross * rate) / (100 + rate));
        net += gross - t; tax += t;
      } else {
        net += gross; tax += Math.round((gross * rate) / 100);
      }
    }
    return { net, tax, total: net + tax };
  }, [lines, taxInclusive]);

  const canSave = !!partnerId && !saving && lines.some((l) => lineGross(l) > 0);

  /** شروط الدفع بالأيام ⇒ تاريخ استحقاق. الفراغ يعني بلا استحقاق. */
  const dueDate = useMemo(() => {
    const days = Number(termDays);
    if (!date || !Number.isFinite(days) || days <= 0) return null;
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }, [date, termDays]);

  async function submit(post: boolean) {
    setSaving(true);
    setError(null);
    const items = lines
      .filter((l) => (Number(l.qty) || 0) > 0 && riyalToMinor(l.price) >= 0 && (l.productId || l.description))
      .map((l) => ({
        product_id: l.productId,
        description: l.description || null,
        quantity: Math.floor(Number(l.qty)) || 1,
        unit: l.unit || null,
        unit_price: riyalToMinor(l.price),
        tax_rate: Number(l.tax) || 0,
      }));

    if (items.length === 0) { setError(t('need_line')); setSaving(false); return; }

    try {
      const created = await api<{ data: { id: string } }>('/purchases', {
        method: 'POST',
        body: {
          partner_id: partnerId,
          cost_center_id: centerId || null,
          payment_type: paymentType,
          purchase_date: date || null,
          due_date: dueDate,
          supplier_invoice_no: supplierInvoiceNo || null,
          tax_inclusive: taxInclusive,
          notes: notes || null,
          items,
        },
      });
      if (post) await api(`/purchases/${created.data.id}/post`, { method: 'POST' });
      success(tc('created'));
      router.push('/purchases');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push('/purchases')} aria-label={tf('back')}>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <h1 className="text-xl font-semibold text-text">{t('new_title')}</h1>
        <div className="ms-auto flex items-center gap-2">
          <Button variant="ghost" onClick={() => router.push('/purchases')}>{tf('cancel')}</Button>
          <Button variant="outline" disabled={!canSave} onClick={() => submit(false)}>{t('save_draft')}</Button>
          <Button disabled={!canSave} onClick={() => submit(true)}>{t('save_post')}</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-5">
          {/* ═══ المورد ═══ */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" strokeWidth={1.8} />{t('supplier_section')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="supplier">{t('supplier')} *</Label>
                  <div className="flex items-center gap-2">
                    <Combobox
                      id="supplier"
                      className="min-w-0 flex-1"
                      value={partnerId}
                      onChange={setPartnerId}
                      options={supplierOptions}
                      placeholder={t('pick_supplier')}
                      searchPlaceholder={t('search_supplier')}
                      emptyText={t('no_supplier_found')}
                      clearLabel={t('pick_supplier')}
                    />
                    <Button type="button" variant="outline" onClick={() => setNewSupplier(true)}>
                      <Plus className="h-4 w-4" strokeWidth={1.7} />
                      {t('new_supplier')}
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="pt">{t('payment_type')}</Label>
                  <Select id="pt" value={paymentType} onChange={(e) => setPaymentType(e.target.value)}>
                    <option value="credit">{t('credit')}</option>
                    <option value="cash">{t('cash')}</option>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="date">{t('date')}</Label>
                  <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="terms">{t('payment_terms')}</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="terms" className="num text-end" type="number" min={0} inputMode="numeric"
                      value={termDays} onChange={(e) => setTermDays(e.target.value)}
                    />
                    <span className="shrink-0 text-sm text-muted">{t('day')}</span>
                  </div>
                  {dueDate && <p className="num text-xs text-muted">{t('due_on')} {dueDate}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="supplier-no">{t('supplier_invoice_no')}</Label>
                  <Input id="supplier-no" value={supplierInvoiceNo} onChange={(e) => setSupplierInvoiceNo(e.target.value)} />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="center">{t('cost_center')}</Label>
                  <Select id="center" value={centerId} onChange={(e) => setCenterId(e.target.value)}>
                    <option value="">{t('no_cost_center')}</option>
                    {centers.map((c) => (<option key={c.id} value={c.id}>{c.code} — {c.name}</option>))}
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ═══ البنود ═══ */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Package className="h-4 w-4 text-primary" strokeWidth={1.8} />{t('items_section')}
              </CardTitle>
              <Button type="button" variant="ghost" size="sm" onClick={addLine}>
                <Plus className="h-4 w-4" strokeWidth={1.7} />{t('add_line')}
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="hidden grid-cols-12 gap-2 px-1 text-[11px] font-medium text-muted md:grid">
                <div className="col-span-3">{t('item')}</div>
                <div className="col-span-2">{t('description')}</div>
                <div className="col-span-2 text-end">{t('unit_price')}</div>
                <div className="col-span-2 text-end">{t('qty')}</div>
                <div className="col-span-1 text-end">{t('tax')}</div>
                <div className="col-span-1 text-end">{t('line_total')}</div>
                <div className="col-span-1" />
              </div>

              {lines.map((l) => {
                const units = products.find((p) => p.id === l.productId)?.units ?? [];
                const gross = lineGross(l);
                const rate = Number(l.tax) || 0;
                const withTax = taxInclusive ? gross : gross + Math.round((gross * rate) / 100);
                return (
                  <div key={l.key} className="grid grid-cols-2 items-center gap-2 rounded-lg border border-border p-2 md:grid-cols-12 md:border-0 md:p-0">
                    <Combobox
                      className="col-span-2 md:col-span-3"
                      value={l.productId ?? ''}
                      onChange={(v) => pickProduct(l.key, v)}
                      options={productOptions}
                      placeholder={t('manual_line')}
                      searchPlaceholder={t('search_product')}
                      emptyText={t('no_product_found')}
                      clearLabel={t('manual_line')}
                      footerLabel={t('new_product')}
                      onFooterClick={() => setNewProductFor(l.key)}
                      aria-label={t('item')}
                    />
                    <Input
                      className="col-span-2 md:col-span-2" placeholder={t('description')}
                      value={l.description}
                      onChange={(e) => setLine(l.key, { description: e.target.value })}
                    />
                    <Input
                      className="num text-end md:col-span-2" inputMode="decimal" placeholder={t('unit_price')}
                      value={l.price} onChange={(e) => setLine(l.key, { price: e.target.value })}
                    />
                    {/* الكمية ووحدتها خلية واحدة — الوحدة تظهر فقط لمنتج بقالب. */}
                    <div className="col-span-2 flex items-center gap-1 md:col-span-2">
                      <Input
                        className="num flex-1 text-end" type="number" min={1}
                        value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })}
                      />
                      {units.length >= 2 && (
                        <Select
                          className="w-24 shrink-0" value={l.unit} aria-label={t('unit')}
                          onChange={(e) => setLine(l.key, { unit: e.target.value })}
                        >
                          {units.map((u) => (
                            <option key={u.name} value={u.factor === 1 ? '' : u.name}>{u.name}</option>
                          ))}
                        </Select>
                      )}
                    </div>
                    <Input
                      className="num text-end md:col-span-1" type="number" min={0} max={100}
                      value={l.tax} onChange={(e) => setLine(l.key, { tax: e.target.value })}
                    />
                    <div className="num col-span-1 text-end text-sm text-text md:col-span-1">
                      {formatRiyal(withTax / 100)}
                    </div>
                    <Button
                      type="button" variant="ghost" size="icon" className="col-span-1 ms-auto md:col-span-1"
                      aria-label={t('remove_line')} onClick={() => removeLine(l.key)}
                    >
                      <Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} />
                    </Button>
                  </div>
                );
              })}

              <p className="pt-1 text-xs leading-relaxed text-muted">{t('items_hint')}</p>
            </CardContent>
          </Card>

          {/* ═══ أقسام مؤجَّلة — تظهر لتُعرَف لا لتُستعمَل ═══ */}
          <SoonSection icon={Percent} title={t('s_discount')} hint={t('s_discount_hint')} soon={t('soon')} />
          <SoonSection icon={Truck} title={t('s_shipping')} hint={t('s_shipping_hint')} soon={t('soon')} />
          <SoonSection icon={Wallet} title={t('s_deposit')} hint={t('s_deposit_hint')} soon={t('soon')} />
          <SoonSection icon={Paperclip} title={t('s_attachments')} hint={t('s_attachments_hint')} soon={t('soon')} />

          {/* ═══ الملاحظات ═══ */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" strokeWidth={1.8} />{t('notes_section')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <textarea
                rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
                className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-primary"
              />
            </CardContent>
          </Card>
        </div>

        {/* ═══ الإجماليات ═══ */}
        <div className="space-y-5">
          <Card className="lg:sticky lg:top-4">
            <CardHeader><CardTitle>{t('totals')}</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted">{t('tax_mode')}</span>
                <Select
                  className="w-40" value={taxInclusive ? '1' : '0'}
                  onChange={(e) => setTaxInclusive(e.target.value === '1')}
                  aria-label={t('tax_mode')}
                >
                  <option value="0">{t('tax_exclusive')}</option>
                  <option value="1">{t('tax_inclusive')}</option>
                </Select>
              </div>
              <Row label={t('subtotal')} value={formatRiyal(totals.net / 100)} />
              <Row label={t('tax_amount')} value={formatRiyal(totals.tax / 100)} />
              <div className="flex items-center justify-between border-t border-border pt-2 font-semibold text-text">
                <span>{t('total')}</span>
                <span className="num">{formatRiyal(totals.total / 100)}</span>
              </div>

              {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
            </CardContent>
          </Card>
        </div>
      </div>

      <PartnerDialog
        open={newSupplier}
        onClose={() => setNewSupplier(false)}
        onSaved={() => { setNewSupplier(false); loadPartners(); }}
        defaultType="supplier"
      />

      {/* المنتج المُنشأ يُختار في سطره فوراً — وإلا أعاد المستخدم البحث عمّا
          أنشأه للتوّ. الاختيار يتمّ بعد إعادة الجلب لا قبلها. */}
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
              price: created.purchase_price, tax: String(created.tax_rate), unit: '',
            });
          }
        }}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className="num text-text">{value}</span>
    </div>
  );
}

/** قسم معروف الموضع ولم يُبنَ بعد — يُعرَض ولا يَعِد. */
function SoonSection({
  icon: Icon, title, hint, soon,
}: { icon: LucideIcon; title: string; hint: string; soon: string }) {
  return (
    <Card className="opacity-70">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted" strokeWidth={1.8} />
          <span className="text-muted">{title}</span>
          <span className="rounded bg-border px-1.5 py-0.5 text-[10px] font-normal text-muted">{soon}</span>
        </CardTitle>
      </CardHeader>
      <CardContent><p className="text-xs leading-relaxed text-muted">{hint}</p></CardContent>
    </Card>
  );
}
