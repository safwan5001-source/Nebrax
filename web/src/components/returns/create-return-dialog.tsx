'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { formatRiyal, riyalToMinor } from '@/lib/money';

interface Partner { id: string; name: string; type: string; phone?: string | null; vat_number?: string | null }
interface Product {
  id: string; name: string; sku?: string | null; barcode?: string | null;
  sale_price: string; purchase_price: string; tax_rate: number; is_active: boolean;
  track_inventory?: boolean; quantity_on_hand?: number;
}
interface Line {
  productId: string | null; description: string; quantity: string; unit_price: string; tax_rate: string;
  /** سطر المستند المصدر — يملؤه السحب، ويبقى null في المرتجع الحرّ. */
  sourceLineId: string | null;
  /** المتبقي القابل للردّ من ذلك السطر — سقفٌ يُعرَض لا يُكتشَف عند الرفض. */
  remaining: number | null;
}
interface SourceDoc { id: string; number: string; status: string; partner_id: string; total: string }
interface ReturnableLine {
  source_line_id: string; product_id: string | null; description: string | null;
  quantity: number; returned: number; remaining: number; unit_price: string; tax_rate: number;
}

const emptyLine = (): Line => ({
  productId: null, description: '', quantity: '1', unit_price: '', tax_rate: '15',
  sourceLineId: null, remaining: null,
});

export function CreateReturnDialog({
  open,
  onClose,
  onCreated,
  fixedType,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  /** يثبّت نوع المرتجع ويُخفي منتقيه — لشاشتَي مرتجعات المبيعات/المشتريات. */
  fixedType?: 'sales' | 'purchase';
}) {
  const t = useTranslations('returnForm');
  const tc = useTranslations('common');
  const { success } = useToast();
  const [type, setType] = useState<'sales' | 'purchase'>(fixedType ?? 'sales');
  const [partners, setPartners] = useState<Partner[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [partnerId, setPartnerId] = useState('');
  const [paymentType, setPaymentType] = useState('credit');
  const [postNow, setPostNow] = useState(true);
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [sources, setSources] = useState<SourceDoc[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [requireSource, setRequireSource] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    api<{ data: Partner[] }>('/partners').then((r) => setPartners(r.data)).catch(() => {});
    api<{ data: Product[] }>('/products')
      .then((r) => setProducts(r.data.filter((p) => p.is_active)))
      .catch(() => {});
  }, [open]);

  // المستندات المرحَّلة القابلة للردّ عليها + سياسة إلزام المصدر — كلاهما
  // يتبع نوع المرتجع، فيُعاد جلبهما عند تبديله.
  useEffect(() => {
    if (!open) return;
    const path = type === 'sales' ? '/invoices' : '/purchases';
    api<{ data: SourceDoc[] }>(path)
      .then((r) => setSources(r.data.filter((d) => d.status === 'posted')))
      .catch(() => setSources([]));

    api<{ data: Record<string, unknown> }>(type === 'sales' ? '/sales-settings' : '/purchase-settings')
      .then((r) => setRequireSource(!!r.data.require_return_source))
      .catch(() => setRequireSource(false));
  }, [open, type]);

  const eligible = useMemo(
    () =>
      partners.filter((p) =>
        type === 'sales' ? ['customer', 'both'].includes(p.type) : ['supplier', 'both'].includes(p.type)
      ),
    [partners, type]
  );

  const partnerOptions = useMemo<ComboOption[]>(
    () => eligible.map((p) => ({
      value: p.id, label: p.name,
      sub: p.vat_number ?? undefined,
      hint: p.phone ?? undefined,
    })),
    [eligible]
  );
  const productOptions = useMemo<ComboOption[]>(
    () => products.map((p) => ({
      value: p.id, label: p.name,
      sub: [p.sku, p.barcode].filter(Boolean).join('  \u00b7  ') || undefined,
      hint: p.track_inventory ? `${t('balance')} ${p.quantity_on_hand ?? 0}` : undefined,
    })),
    [products, t]
  );

  // مستندات هذا الطرف وحده — قائمةٌ تعرض فواتير عميلٍ آخر تدعو لخطأ يرفضه
  // الخادم بعد ملء النموذج.
  const sourceOptions = useMemo<ComboOption[]>(
    () => sources
      .filter((d) => d.partner_id === partnerId)
      .map((d) => ({ value: d.id, label: d.number, hint: d.total })),
    [sources, partnerId]
  );

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  /**
   * سحب سطور المستند المصدر بكمياتها المتبقية وأسعارها.
   *
   * السطور المردودة بالكامل تُستبعَد — عرضُها بصفرٍ يدعو لكتابة كميةٍ تُرفض.
   * والسعر يُملأ سقفاً لا قيداً: للمستخدم أن ينقصه (استرداد جزئي) لا أن يزيده.
   */
  async function pickSource(id: string) {
    setSourceId(id);
    if (!id) { setLines([emptyLine()]); return; }

    setError(null);
    try {
      const r = await api<{ data: { lines: ReturnableLine[] } }>(`/returns/returnable/${type}/${id}`);
      const pulled = r.data.lines
        .filter((l) => l.remaining > 0)
        .map((l) => ({
          productId: l.product_id,
          description: l.description ?? '',
          quantity: String(l.remaining),
          unit_price: l.unit_price,
          tax_rate: String(l.tax_rate),
          sourceLineId: l.source_line_id,
          remaining: l.remaining,
        }));
      if (pulled.length === 0) { setError(t('fully_returned')); setSourceId(''); return; }
      setLines(pulled);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('loadFailed'));
      setSourceId('');
    }
  }

  /**
   * اختيار المنتج يملأ الوصف والسعر والضريبة. والسعر يتبع اتجاه المرتجع:
   * مرتجع المبيعات يُرَدّ بسعر البيع، ومرتجع المشتريات بسعر الشراء — فيساوي
   * عكسُ القيد أصلَه بدل أن يترك فرقاً في الذمم.
   */
  function pickProduct(i: number, productId: string) {
    const p = products.find((x) => x.id === productId);
    if (!p) return setLine(i, { productId: null });
    setLine(i, {
      productId: p.id,
      description: p.name,
      unit_price: type === 'sales' ? p.sale_price : p.purchase_price,
      tax_rate: String(p.tax_rate),
    });
  }
  const addLine = () => setLines((ls) => [...ls, emptyLine()]);
  const removeLine = (i: number) => setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls));

  // **المنتج إلزامي على كل سطر** (يفرضه `StoreReturnRequest` أيضاً، لا الشاشة
  // وحدها): بلا منتج يمرّ المرتجع بأثرٍ مالي فقط — لا بضاعة تعود للمخزون ولا
  // تكلفةَ بضاعةٍ مباعة تُعكَس. المنعُ هنا يسبق رفضَ الخادم برسالةٍ أوضح.
  const canSave = !saving && !!partnerId && lines.every((l) => !!l.productId)
    // السقف يُمنَع هنا قبل أن يرفضه الخادم — والرقم معروضٌ في تلميح الخانة.
    && lines.every((l) => l.remaining === null || (Number(l.quantity) || 0) <= l.remaining)
    && (!requireSource || !!sourceId);

  const totalMinor = lines.reduce((sum, l) => {
    const sub = (Number(l.quantity) || 0) * riyalToMinor(l.unit_price);
    return sum + sub + Math.round((sub * (Number(l.tax_rate) || 0)) / 100);
  }, 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    // شكل السطر هو نفسه الذي ستنتجه لاحقاً ميزة «مرتجع من مستند مصدر»
    // (سحب السطور من الفاتورة)، فلا مسار ثانٍ يُبنى لها.
    const items = lines.map((l) => ({
      product_id: l.productId,
      source_line_id: l.sourceLineId,
      description: l.description || null,
      quantity: Number(l.quantity) || 1,
      unit_price: riyalToMinor(l.unit_price),
      tax_rate: Number(l.tax_rate) || 0,
    }));
    try {
      const created = await api<{ data: { id: string } }>('/returns', {
        method: 'POST',
        body: { type, partner_id: partnerId, payment_type: paymentType, original_id: sourceId || null, items },
      });
      if (postNow) await api(`/returns/${created.data.id}/post`, { method: 'POST' });
      success(tc('created'));
      setLines([emptyLine()]);
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('title')} className="max-w-2xl">
      <form onSubmit={submit} className="space-y-4">
        <div className={fixedType ? 'grid grid-cols-2 gap-3' : 'grid grid-cols-3 gap-3'}>
          {/* منتقي النوع يظهر فقط في الشاشة العامة؛ الشاشتان المتخصّصتان تثبّتانه. */}
          {!fixedType && (
            <div className="space-y-1.5">
              <Label htmlFor="type">{t('type')}</Label>
              <Select
                id="type"
                value={type}
                onChange={(e) => {
                  setType(e.target.value as 'sales' | 'purchase');
                  setPartnerId('');
                  setSourceId('');
                  setLines([emptyLine()]);
                }}
              >
                <option value="sales">{t('sales')}</option>
                <option value="purchase">{t('purchase')}</option>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="partner">{t('partner')}</Label>
            <Combobox
              id="partner"
              value={partnerId}
              onChange={(v) => { setPartnerId(v); setSourceId(''); setLines([emptyLine()]); }}
              options={partnerOptions}
              placeholder={t('choose_partner')}
              searchPlaceholder={t('search_partner')}
              emptyText={t('no_partner_found')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="source">
              {t('source_document')}{requireSource && <span className="text-negative"> *</span>}
            </Label>
            <Combobox
              id="source"
              value={sourceId}
              onChange={pickSource}
              options={sourceOptions}
              disabled={!partnerId}
              placeholder={requireSource ? t('choose_source') : t('no_source')}
              searchPlaceholder={t('search_source')}
              emptyText={t('no_source_found')}
              clearLabel={requireSource ? undefined : t('no_source')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pt">{t('payment_type')}</Label>
            <Select id="pt" value={paymentType} onChange={(e) => setPaymentType(e.target.value)}>
              <option value="credit">{t('credit')}</option>
              <option value="cash">{t('cash')}</option>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>{t('lines')}</Label>
            {/* لا سطرَ يدويّ في مرتجعٍ مرتبط: كل سطر يحتاج سطرَ مصدره. */}
            {!sourceId && (
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
                {t('add_line')}
              </Button>
            )}
          </div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 items-center gap-2">
                {/* السطر المسحوب من الفاتورة لا يُبدَّل منتجُه: تبديلُه يفصله
                    عن سطر مصدره فيسقط السقفان — الكمية والسعر. */}
                {l.sourceLineId ? (
                  <div className="col-span-5 truncate rounded-md border border-border bg-background px-3 py-2 text-sm text-text">
                    {l.description || '—'}
                  </div>
                ) : (
                  <Combobox
                    className="col-span-5"
                    value={l.productId ?? ''}
                    onChange={(v) => pickProduct(i, v)}
                    options={productOptions}
                    placeholder={t('pick_product')}
                    searchPlaceholder={t('search_product')}
                    emptyText={t('no_product_found')}
                    aria-label={t('product')}
                  />
                )}
                <Input
                  className="num col-span-2 text-end" type="number" min={1}
                  max={l.remaining ?? undefined}
                  title={l.remaining !== null ? `${t('remaining_hint')} ${l.remaining}` : undefined}
                  placeholder={t('qty')} value={l.quantity}
                  onChange={(e) => setLine(i, { quantity: e.target.value })}
                />
                <Input className="num col-span-2 text-end" inputMode="decimal" placeholder={t('price')} value={l.unit_price} onChange={(e) => setLine(i, { unit_price: e.target.value })} />
                <Input className="num col-span-2 text-end" type="number" min={0} max={100} value={l.tax_rate} onChange={(e) => setLine(i, { tax_rate: e.target.value })} />
                <Button type="button" variant="ghost" size="icon" className="col-span-1" aria-label={t('remove_line')} onClick={() => removeLine(i)}>
                  <Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border pt-3">
          <label className="flex items-center gap-2 text-sm text-text">
            <input type="checkbox" checked={postNow} onChange={(e) => setPostNow(e.target.checked)} />
            {t('post_now')}
          </label>
          <div className="text-sm">
            <span className="text-muted">{t('total')}: </span>
            <span className="num font-semibold text-text">{formatRiyal(totalMinor / 100)}</span>
          </div>
        </div>

        {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={!canSave}>
            {t('create')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
