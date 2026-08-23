'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, Plus, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NumberPreviewField } from '@/components/ui/number-preview-field';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { useNumberPreview } from '@/lib/use-number-preview';
import { formatRiyal, riyalToMinor } from '@/lib/money';

interface Warehouse { id: string; name: string }
interface Product { id: string; name: string; track_inventory: boolean; quantity_on_hand: number; avg_cost: string }
interface Line { key: string; productId: string; qty: string; cost: string }

type PermitType = 'receipt' | 'issue' | 'transfer';

let seq = 0;
const newLine = (): Line => ({ key: `sp${++seq}`, productId: '', qty: '1', cost: '' });

/**
 * إنشاء إذن مخزني.
 *
 * التكلفة تُدخَل في **الإضافة وحدها**؛ الصرف والتحويل يأخذان متوسط التكلفة
 * عند الترحيل — فلا يُسعّر المستخدم ما يُخرِجه من المخزن. الحقل يُعرض
 * للاطّلاع لا للتعديل في هذين النوعين.
 */
export default function NewStockPermitPage() {
  const t = useTranslations('stockPermits');
  const tf = useTranslations('invoiceForm');
  const tc = useTranslations('common');
  const router = useRouter();
  const { success } = useToast();

  const [type, setType] = useState<PermitType>('issue');
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { number: suggestedNumber, loading: loadingNumber } = useNumberPreview('stock_permit', { seriesKey: type, date });

  const isReceipt = type === 'receipt';
  const isTransfer = type === 'transfer';

  useEffect(() => {
    setDate(new Date().toISOString().slice(0, 10));
    api<{ data: Warehouse[] }>('/warehouses').then((r) => {
      setWarehouses(r.data);
      if (r.data[0]) setWarehouseId((w) => w || r.data[0].id);
    }).catch(() => {});
    api<{ data: Product[] }>('/products')
      .then((r) => setProducts(r.data.filter((p) => p.track_inventory)))
      .catch(() => {});
  }, []);

  const setLine = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, newLine()]);
  const removeLine = (key: string) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));

  /** تكلفة السطر المعروضة: المُدخَلة في الإضافة، ومتوسط المنتج في غيرها. */
  const costOf = (l: Line): number => {
    if (isReceipt) return riyalToMinor(l.cost);
    const p = products.find((x) => x.id === l.productId);
    return p ? riyalToMinor(p.avg_cost) : 0;
  };

  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * costOf(l), 0);

  async function submit() {
    const items = lines
      .filter((l) => l.productId && (Number(l.qty) || 0) > 0)
      .map((l) => ({
        product_id: l.productId,
        quantity: Number(l.qty) || 1,
        unit_cost: isReceipt ? riyalToMinor(l.cost) : undefined,
      }));
    if (items.length === 0) {
      setError(tf('need_line'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await api<{ data: { id: string } }>('/stock-permits', {
        method: 'POST',
        body: {
          type,
          warehouse_id: warehouseId,
          target_warehouse_id: isTransfer ? targetId : null,
          permit_date: date || null,
          reason: reason || null,
          items,
        },
      });
      success(tc('created'));
      router.push(`/stock-permits/${created.data.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push('/stock-permits')} aria-label={t('back')}>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <h1 className="text-xl font-semibold text-text">{t('new_title')}</h1>
      </div>

      <Card>
        <CardHeader><CardTitle>{t('details')}</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <NumberPreviewField id="stock-permit-number" label={t('number')} number={suggestedNumber} loading={loadingNumber} />
            <div className="space-y-1.5">
              <Label htmlFor="type">{t('type')}</Label>
              <Select id="type" value={type} onChange={(e) => setType(e.target.value as PermitType)}>
                <option value="issue">{t('type_issue')}</option>
                <option value="receipt">{t('type_receipt')}</option>
                <option value="transfer">{t('type_transfer')}</option>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="wh">{isTransfer ? t('from_warehouse') : t('warehouse')}</Label>
              <Select id="wh" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required>
                <option value="" disabled>{t('choose_warehouse')}</option>
                {warehouses.map((w) => (<option key={w.id} value={w.id}>{w.name}</option>))}
              </Select>
            </div>

            {isTransfer && (
              <div className="space-y-1.5">
                <Label htmlFor="target">{t('to_warehouse')}</Label>
                <Select id="target" value={targetId} onChange={(e) => setTargetId(e.target.value)} required>
                  <option value="" disabled>{t('choose_warehouse')}</option>
                  {warehouses.filter((w) => w.id !== warehouseId).map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="date">{t('date')}</Label>
              <Input id="date" type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reason">{t('reason')}</Label>
              <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('reason_hint')} />
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
            <div className="col-span-5">{tf('product')}</div>
            <div className="col-span-2 text-end">{t('available')}</div>
            <div className="col-span-1 text-end">{tf('qty')}</div>
            <div className="col-span-2 text-end">{t('unit_cost')}</div>
            <div className="col-span-1 text-end">{tf('total')}</div>
            <div className="col-span-1" />
          </div>

          {lines.map((l) => {
            const product = products.find((x) => x.id === l.productId);
            const lineTotal = (Number(l.qty) || 0) * costOf(l);
            return (
              <div key={l.key} className="grid grid-cols-2 items-center gap-2 rounded border border-border p-2 md:grid-cols-12 md:border-0 md:p-0">
                <Select className="col-span-2 md:col-span-5" value={l.productId} onChange={(e) => setLine(l.key, { productId: e.target.value })}>
                  <option value="">{t('choose_product')}</option>
                  {products.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                </Select>
                <div className="num col-span-1 text-end text-sm text-muted md:col-span-2">
                  {product ? product.quantity_on_hand : '—'}
                </div>
                <Input className="num text-end md:col-span-1" type="number" min={1} value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} />
                {/* الصرف والتحويل: التكلفة من المتوسط، معروضة لا مُدخَلة. */}
                <Input
                  className="num text-end md:col-span-2"
                  inputMode="decimal"
                  disabled={!isReceipt}
                  value={isReceipt ? l.cost : (product ? product.avg_cost : '')}
                  onChange={(e) => setLine(l.key, { cost: e.target.value })}
                  placeholder={isReceipt ? t('unit_cost') : t('from_average')}
                />
                <div className="num col-span-1 text-end text-sm md:col-span-1">{formatRiyal(lineTotal / 100)}</div>
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
          <CardContent className="flex justify-between p-4 text-sm">
            <span className="font-semibold text-text">{t('total_cost')}</span>
            <span className="num text-lg font-bold text-text">{formatRiyal(total / 100)}</span>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {error && <p className="self-center rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
          <Button disabled={saving || !warehouseId || (isTransfer && !targetId)} onClick={submit}>{t('save')}</Button>
        </div>
      </div>
    </div>
  );
}
