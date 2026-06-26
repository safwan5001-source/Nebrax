'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Minus, Trash2, Search } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { formatRiyal, riyalToMinor } from '@/lib/money';
import { ReceiptDialog, type Receipt } from '@/components/pos/receipt-dialog';

const WALKIN = 'عميل نقدي (POS)';

interface Product { id: string; name: string; sale_price: string; tax_rate: number }
interface CartLine { key: string; productId: string | null; description: string; price: string; qty: number; tax: number }

export default function PosPage() {
  const t = useTranslations('pos');
  const tc = useTranslations('common');
  const { success } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    api<{ data: Product[] }>('/products').then((r) => setProducts(r.data)).catch(() => {});
  }, []);

  const filtered = useMemo(
    () => products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase())),
    [products, search]
  );

  function addProduct(p: Product) {
    setCart((c) => {
      const ex = c.find((l) => l.productId === p.id);
      if (ex) return c.map((l) => (l.productId === p.id ? { ...l, qty: l.qty + 1 } : l));
      return [...c, { key: p.id, productId: p.id, description: p.name, price: p.sale_price, qty: 1, tax: p.tax_rate }];
    });
  }
  function addCustom() {
    setCart((c) => [...c, { key: `c${Date.now()}`, productId: null, description: t('custom_item'), price: '0', qty: 1, tax: 15 }]);
  }
  const setQty = (k: string, d: number) =>
    setCart((c) => c.map((l) => (l.key === k ? { ...l, qty: Math.max(1, l.qty + d) } : l)));
  const setLine = (k: string, field: 'description' | 'price', v: string) =>
    setCart((c) => c.map((l) => (l.key === k ? { ...l, [field]: v } : l)));
  const remove = (k: string) => setCart((c) => c.filter((l) => l.key !== k));

  const totalMinor = cart.reduce((s, l) => {
    const sub = l.qty * riyalToMinor(l.price);
    return s + sub + Math.round((sub * l.tax) / 100);
  }, 0);

  async function ensureWalkin(): Promise<string> {
    const r = await api<{ data: { id: string; name: string }[] }>('/partners');
    const found = r.data.find((p) => p.name === WALKIN);
    if (found) return found.id;
    const created = await api<{ data: { id: string } }>('/partners', {
      method: 'POST',
      body: { name: WALKIN, type: 'customer' },
    });
    return created.data.id;
  }

  async function pay() {
    if (cart.length === 0) return;
    setPaying(true);
    setError(null);
    try {
      const partnerId = await ensureWalkin();
      const items = cart.map((l) => ({
        product_id: l.productId,
        description: l.description,
        quantity: l.qty,
        unit_price: riyalToMinor(l.price),
        tax_rate: l.tax,
      }));
      const created = await api<{ data: { id: string; number: string; total: string } }>('/invoices', {
        method: 'POST',
        body: { partner_id: partnerId, payment_type: 'cash', items },
      });
      await api(`/invoices/${created.data.id}/post`, { method: 'POST' });
      const z = await api<{ qr: string | null }>(`/invoices/${created.data.id}/zatca`);
      success(tc('updated'));
      setReceipt({ number: created.data.number, total: created.data.total, qr: z.qr });
      setCart([]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tc('saveFailed'));
    } finally {
      setPaying(false);
    }
  }

  return (
    <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-5">
      {/* المنتجات */}
      <div className="space-y-3 lg:col-span-3">
        <div className="flex items-center gap-2 rounded border border-border bg-surface px-3 py-2">
          <Search className="h-4 w-4 text-muted" strokeWidth={1.6} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('search_products')}
            className="w-full bg-transparent text-sm text-text placeholder:text-muted focus:outline-none"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {filtered.map((p) => (
            <button
              key={p.id}
              onClick={() => addProduct(p)}
              className="flex flex-col items-start rounded border border-border bg-surface p-3 text-start hover:border-primary hover:bg-primary-soft"
            >
              <span className="line-clamp-2 text-sm text-text">{p.name}</span>
              <span className="num mt-1 text-xs text-muted">{formatRiyal(p.sale_price)}</span>
            </button>
          ))}
          {filtered.length === 0 && <p className="col-span-full py-8 text-center text-sm text-muted">{t('no_products')}</p>}
        </div>
      </div>

      {/* السلة */}
      <Card className="flex flex-col lg:col-span-2">
        <CardContent className="flex flex-1 flex-col gap-2 p-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text">{t('cart')}</h2>
            <Button variant="outline" size="sm" onClick={addCustom}>
              <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
              {t('custom_line')}
            </Button>
          </div>

          <div className="flex-1 space-y-2 overflow-auto">
            {cart.length === 0 && <p className="py-8 text-center text-sm text-muted">{t('empty_cart')}</p>}
            {cart.map((l) => (
              <div key={l.key} className="rounded border border-border p-2">
                <div className="flex items-center gap-2">
                  <Input value={l.description} onChange={(e) => setLine(l.key, 'description', e.target.value)} className="h-8 flex-1" />
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(l.key)} aria-label={t('remove')}>
                    <Trash2 className="h-3.5 w-3.5 text-negative" strokeWidth={1.7} />
                  </Button>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setQty(l.key, -1)}><Minus className="h-3 w-3" /></Button>
                    <span className="num w-6 text-center text-sm">{l.qty}</span>
                    <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setQty(l.key, 1)}><Plus className="h-3 w-3" /></Button>
                  </div>
                  <Input
                    value={l.price}
                    onChange={(e) => setLine(l.key, 'price', e.target.value)}
                    inputMode="decimal"
                    className="num h-8 w-24 text-end"
                  />
                  <span className="num ms-auto text-sm text-text">
                    {formatRiyal((l.qty * riyalToMinor(l.price)) / 100)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-border pt-2">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm text-muted">{t('total')}</span>
              <span className="num text-xl font-bold text-text">{formatRiyal(totalMinor / 100)}</span>
            </div>
            {error && <p className="mb-2 rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
            <Button className="w-full" disabled={cart.length === 0 || paying} onClick={pay}>
              {t('pay_cash')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <ReceiptDialog receipt={receipt} onClose={() => setReceipt(null)} />
    </div>
  );
}
