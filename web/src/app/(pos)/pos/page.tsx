'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Search, Barcode, SlidersHorizontal, Star, Package, ImageIcon, Plus, Minus, Trash2,
  User, UserPlus, StickyNote, Clock, TrendingUp, Tag, LayoutGrid, Wrench, ShoppingCart,
  Users, MoreHorizontal,
} from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { formatRiyal, riyalToMinor } from '@/lib/money';
import { ReceiptDialog, type Receipt } from '@/components/pos/receipt-dialog';
import { PosTopbar } from '@/components/pos/pos-topbar';
import { PosShortcuts } from '@/components/pos/pos-shortcuts';
import { PosPayment, type PaymentSummaryItem } from '@/components/pos/pos-payment';

const WALKIN = 'عميل نقدي (POS)';

interface Product {
  id: string;
  sku: string | null;
  name: string;
  sale_price: string;
  tax_rate: number;
  type: string;
  track_inventory: boolean;
  quantity_on_hand: number;
  is_active: boolean;
}
interface CartLine { key: string; productId: string | null; description: string; sku: string | null; price: string; qty: number; tax: number }

const FAV_KEY = 'nibras_pos_favs';

function stockTone(qty: number) {
  if (qty <= 20) return { w: Math.max(8, (qty / 20) * 40), c: 'var(--negative)' };
  if (qty <= 50) return { w: 40 + ((qty - 20) / 30) * 25, c: 'var(--warning)' };
  return { w: Math.min(100, 65 + ((qty - 50) / 200) * 35), c: 'var(--positive)' };
}

export default function PosPage() {
  const t = useTranslations('pos');
  const tc = useTranslations('common');
  const router = useRouter();
  const { success } = useToast();

  const [products, setProducts] = useState<Product[]>([]);
  const [cashier, setCashier] = useState('—');
  const [branch, setBranch] = useState('—');
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState<'all' | 'good' | 'service'>('all');
  const [tab, setTab] = useState('all');
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [cart, setCart] = useState<CartLine[]>([]);
  const [step, setStep] = useState<'sale' | 'payment'>('sale');
  const [mobileTab, setMobileTab] = useState<'products' | 'cart'>('products');
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    api<{ data: Product[] }>('/products').then((r) => setProducts(r.data.filter((p) => p.is_active))).catch(() => {});
    api<{ user?: { name?: string }; company?: { name?: string } }>('/me')
      .then((r) => { setCashier(r.user?.name ?? t('cashier')); setBranch(r.company?.name ?? t('main_branch')); })
      .catch(() => {});
    try {
      const raw = localStorage.getItem(FAV_KEY);
      if (raw) setFavs(new Set(JSON.parse(raw)));
    } catch { /* ignore */ }
  }, [t]);

  const toggleFav = useCallback((id: string) => {
    setFavs((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      try { localStorage.setItem(FAV_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (cat !== 'all' && p.type !== cat) return false;
      if (tab === 'favorites' && !favs.has(p.id)) return false;
      if (q && !p.name.toLowerCase().includes(q) && !(p.sku ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [products, search, cat, tab, favs]);

  function addProduct(p: Product) {
    setCart((c) => {
      const ex = c.find((l) => l.productId === p.id);
      if (ex) return c.map((l) => (l.productId === p.id ? { ...l, qty: l.qty + 1 } : l));
      return [...c, { key: p.id, productId: p.id, description: p.name, sku: p.sku, price: p.sale_price, qty: 1, tax: p.tax_rate }];
    });
  }
  const setQty = (k: string, d: number) => setCart((c) => c.map((l) => (l.key === k ? { ...l, qty: Math.max(1, l.qty + d) } : l)));
  const remove = (k: string) => setCart((c) => c.filter((l) => l.key !== k));

  const subMinor = cart.reduce((s, l) => s + l.qty * riyalToMinor(l.price), 0);
  const taxMinor = cart.reduce((s, l) => s + Math.round((l.qty * riyalToMinor(l.price) * l.tax) / 100), 0);
  const totalMinor = subMinor + taxMinor;
  const count = cart.reduce((s, l) => s + l.qty, 0);

  async function ensureWalkin(): Promise<string> {
    const r = await api<{ data: { id: string; name: string }[] }>('/partners');
    const found = r.data.find((p) => p.name === WALKIN);
    if (found) return found.id;
    const created = await api<{ data: { id: string } }>('/partners', { method: 'POST', body: { name: WALKIN, type: 'customer' } });
    return created.data.id;
  }

  const confirmPayment = useCallback(
    async (tenders: Record<'cash' | 'card' | 'transfer' | 'credit', number>) => {
      if (cart.length === 0) return;
      setPaying(true);
      setError(null);
      // نوع الدفع للفاتورة: آجل فقط إن كان كامل المبلغ على الذمة، وإلا نقدي (POS).
      const nonCredit = tenders.cash + tenders.card + tenders.transfer;
      const paymentType = nonCredit === 0 && tenders.credit > 0 ? 'credit' : 'cash';
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
          body: { partner_id: partnerId, payment_type: paymentType, items },
        });
        await api(`/invoices/${created.data.id}/post`, { method: 'POST' });
        const z = await api<{ qr: string | null }>(`/invoices/${created.data.id}/zatca`);
        success(t('sale_done'));
        setReceipt({ number: created.data.number, total: created.data.total, qr: z.qr });
        setCart([]);
        setStep('sale');
        setMobileTab('products');
      } catch (e) {
        setError(e instanceof ApiError ? e.message : tc('saveFailed'));
      } finally {
        setPaying(false);
      }
    },
    [cart, success, t, tc],
  );

  const summaryItems: PaymentSummaryItem[] = cart.map((l) => ({
    name: l.description, qty: l.qty, unitPrice: formatRiyal(l.price), lineTotal: l.qty * riyalToMinor(l.price),
  }));

  const CATS = [
    { key: 'all' as const, label: t('cat_all'), icon: LayoutGrid },
    { key: 'good' as const, label: t('cat_goods'), icon: Package },
    { key: 'service' as const, label: t('cat_services'), icon: Wrench },
  ];
  const TABS = [
    { key: 'all', label: t('tab_all'), icon: null },
    { key: 'recent', label: t('tab_recent'), icon: Clock },
    { key: 'top', label: t('tab_top'), icon: TrendingUp },
    { key: 'offers', label: t('tab_offers'), icon: Tag },
    { key: 'favorites', label: t('tab_favorites'), icon: Star },
  ];

  // ── لوحات فرعية ──────────────────────────────────────────────
  const productsPanel = (
    <section className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4 lg:p-5">
      <div className="flex gap-2.5">
        <button className="flex items-center gap-2 rounded-xl border border-border bg-surface px-4 text-[13px] font-semibold shadow-sm">
          <Barcode className="h-4 w-4" strokeWidth={1.8} />
          <span className="hidden sm:inline">{t('barcode_search')}</span>
        </button>
        <div className="flex flex-1 items-center gap-2.5 rounded-xl border border-border bg-surface px-3.5 py-2.5 shadow-sm">
          <Search className="h-4 w-4 text-muted" strokeWidth={1.8} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('search_products')} className="w-full bg-transparent text-[13px] text-text outline-none placeholder:text-muted" />
          <kbd className="num hidden rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted sm:block">F4</kbd>
        </div>
        <button className="hidden items-center gap-2 rounded-xl border border-border bg-surface px-4 text-[13px] font-semibold shadow-sm sm:flex">
          <SlidersHorizontal className="h-4 w-4" strokeWidth={1.8} />
          {t('filter')}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((qt) => {
          const Icon = qt.icon;
          const on = tab === qt.key;
          return (
            <button
              key={qt.key}
              onClick={() => setTab(qt.key)}
              className={'flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-[12.5px] font-semibold ' + (on ? 'border-transparent bg-primary text-white' : 'border-border bg-surface text-muted')}
            >
              {Icon && <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />}
              {qt.label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {filtered.map((p) => {
          const tracked = p.track_inventory;
          const st = stockTone(p.quantity_on_hand);
          const fav = favs.has(p.id);
          return (
            <button
              key={p.id}
              onClick={() => addProduct(p)}
              className="relative flex flex-col rounded-2xl border-[1.5px] border-border bg-surface p-3 text-start shadow-sm hover:-translate-y-px hover:border-primary"
            >
              <span
                role="button"
                tabIndex={-1}
                onClick={(e) => { e.stopPropagation(); toggleFav(p.id); }}
                className={'absolute end-2.5 top-2.5 grid h-6 w-6 place-items-center ' + (fav ? 'text-warning' : 'text-border')}
              >
                <Star className="h-4 w-4" strokeWidth={1.8} fill={fav ? 'currentColor' : 'none'} />
              </span>
              <div className="mb-3 grid aspect-square w-full place-items-center rounded-xl bg-background">
                <ImageIcon className="h-8 w-8 text-border" strokeWidth={1.3} />
              </div>
              <span className="line-clamp-2 min-h-[36px] text-[13px] font-semibold leading-snug text-text">{p.name}</span>
              {p.sku && <span className="num mb-1.5 mt-0.5 text-[10.5px] text-muted">{p.sku}</span>}
              <span className="num text-[15px] font-bold text-primary-hover">{formatRiyal(p.sale_price)}</span>
              {tracked && (
                <div className="mt-2">
                  <div className="mb-1 h-1 overflow-hidden rounded bg-border">
                    <i className="block h-full" style={{ width: `${st.w}%`, background: st.c }} />
                  </div>
                  <span className="num text-[10.5px] text-muted">{t('available')}: {p.quantity_on_hand}</span>
                </div>
              )}
            </button>
          );
        })}
        {filtered.length === 0 && <p className="col-span-full py-10 text-center text-sm text-muted">{t('no_products')}</p>}
      </div>
    </section>
  );

  const cartPanel = (
    <aside className="flex min-h-0 flex-col overflow-hidden border-border bg-surface lg:border-e">
      <div className="border-b border-border p-3.5">
        <div className="mb-2.5 flex items-center gap-2">
          <button className="flex flex-1 items-center justify-between rounded-[10px] border border-border bg-background px-3 py-2.5 text-[12.5px] font-semibold">
            <span>{t('walkin_customer')}</span>
            <User className="h-[15px] w-[15px] text-muted" strokeWidth={1.7} />
          </button>
          <button className="grid h-9 w-9 place-items-center rounded-[10px] border border-border bg-surface" aria-label={t('add_customer')}>
            <UserPlus className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </div>
        <div className="flex items-center gap-2 text-[13px] font-bold">
          {t('cart')}
          <span className="num grid h-5 min-w-5 place-items-center rounded-md bg-primary px-1.5 text-[11px] font-bold text-white">{count}</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3.5">
        {cart.length === 0 && <p className="py-10 text-center text-sm text-muted">{t('empty_cart')}</p>}
        {cart.map((l) => (
          <div key={l.key} className="flex items-center gap-2.5 border-b border-border py-3 last:border-0">
            <button onClick={() => remove(l.key)} className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-negative/10 text-negative" aria-label={t('remove')}>
              <Trash2 className="h-3 w-3" strokeWidth={2} />
            </button>
            <div className="flex shrink-0 items-center gap-1.5">
              <button onClick={() => setQty(l.key, -1)} className="grid h-[22px] w-[22px] place-items-center rounded-md border border-border bg-background"><Minus className="h-3 w-3" /></button>
              <span className="num w-4 text-center text-[12.5px] font-bold">{l.qty}</span>
              <button onClick={() => setQty(l.key, 1)} className="grid h-[22px] w-[22px] place-items-center rounded-md border border-border bg-background"><Plus className="h-3 w-3" /></button>
            </div>
            <div className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-lg bg-background"><Package className="h-4 w-4 text-border" strokeWidth={1.6} /></div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold">{l.description}</div>
              {l.sku && <div className="num text-[10px] text-muted">{l.sku}</div>}
            </div>
            <div className="num shrink-0 text-[12.5px] font-bold">{formatRiyal((l.qty * riyalToMinor(l.price)) / 100)}</div>
          </div>
        ))}
      </div>

      <div className="p-3">
        <button className="flex w-full items-center gap-2 rounded-[9px] border border-dashed border-border bg-background px-3 py-2 text-[11.5px] text-muted">
          <StickyNote className="h-3.5 w-3.5" strokeWidth={1.7} />
          {t('invoice_note')}
        </button>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-border bg-background p-3.5">
        <div className="flex justify-between text-[12.5px]"><span className="text-muted">{t('subtotal')}</span><span className="num font-semibold">{formatRiyal(subMinor / 100)}</span></div>
        <div className="flex justify-between text-[12.5px]"><span className="text-muted">{t('discount')}</span><span className="num font-semibold text-positive">{formatRiyal(0)}</span></div>
        <div className="flex justify-between text-[12.5px]"><span className="text-muted">{t('tax')}</span><span className="num font-semibold">{formatRiyal(taxMinor / 100)}</span></div>
        <div className="flex items-baseline justify-between border-t border-border pt-2">
          <span className="text-sm font-bold">{t('total')}</span>
          <span className="num text-[22px] font-extrabold text-primary-hover">{formatRiyal(totalMinor / 100)}</span>
        </div>
      </div>

      <div className="p-3.5 pt-0">
        <button
          onClick={() => setStep('payment')}
          disabled={cart.length === 0}
          className="flex w-full items-center justify-between rounded-xl bg-primary px-4 py-3.5 text-base font-bold text-white disabled:opacity-50"
        >
          {t('pay')}
          <kbd className="num rounded-md bg-white/20 px-2 py-0.5 text-xs">F9</kbd>
        </button>
      </div>
    </aside>
  );

  const catsPanel = (
    <aside className="hidden flex-col gap-2 overflow-y-auto border-s border-border bg-surface p-4 lg:flex">
      <h4 className="mb-1 px-1 text-xs font-bold text-muted">{t('categories')}</h4>
      {CATS.map(({ key, label, icon: Icon }) => {
        const on = cat === key;
        return (
          <button
            key={key}
            onClick={() => setCat(key)}
            className={'flex items-center gap-3 rounded-[11px] border px-3 py-3 text-[13px] font-semibold ' + (on ? 'border-transparent bg-primary-soft text-primary-hover' : 'border-transparent text-text hover:bg-background')}
          >
            <span className="grid h-[26px] w-[26px] place-items-center rounded-md bg-primary-soft text-primary-hover"><Icon className="h-3.5 w-3.5" strokeWidth={1.8} /></span>
            {label}
          </button>
        );
      })}
    </aside>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <PosTopbar cashier={cashier} branch={branch} onEndSession={() => router.push('/dashboard')} />

      {step === 'payment' ? (
        <PosPayment
          totalMinor={totalMinor}
          items={summaryItems}
          customerName={t('walkin_customer')}
          paying={paying}
          error={error}
          onBack={() => setStep('sale')}
          onConfirm={confirmPayment}
        />
      ) : (
        <>
          {/* ديسكتوب: 3 أعمدة (سلة · منتجات · أقسام) — جوال: تبويب واحد */}
          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[300px_1fr_230px]">
            <div className={mobileTab === 'cart' ? 'flex min-h-0' : 'hidden lg:flex lg:min-h-0'}>{cartPanel}</div>
            <div className={mobileTab === 'products' ? 'relative flex min-h-0 flex-col' : 'hidden lg:flex lg:min-h-0 lg:flex-col'}>
              {productsPanel}
              {/* شريط سلة عائم (جوال فقط) */}
              {count > 0 && (
                <button
                  onClick={() => setMobileTab('cart')}
                  className="absolute inset-x-4 bottom-3 flex items-center gap-3 rounded-2xl bg-primary px-4 py-3 text-white shadow-lg lg:hidden"
                >
                  <span className="num grid h-6 w-6 place-items-center rounded-lg bg-white/25 text-[13px] font-bold">{count}</span>
                  <span className="flex-1 text-start text-[13px] font-semibold">{t('view_cart')}</span>
                  <span className="num text-base font-extrabold">{formatRiyal(totalMinor / 100)}</span>
                </button>
              )}
            </div>
            {catsPanel}
          </div>

          <PosShortcuts />

          {/* تنقّل سفلي (جوال) */}
          <nav className="grid h-16 shrink-0 grid-cols-4 border-t border-border bg-surface lg:hidden">
            <div className="flex flex-col items-center justify-center gap-1 text-[10.5px] font-semibold text-muted"><MoreHorizontal className="h-5 w-5" strokeWidth={1.8} />{t('nav_more')}</div>
            <div className="flex flex-col items-center justify-center gap-1 text-[10.5px] font-semibold text-muted"><Users className="h-5 w-5" strokeWidth={1.8} />{t('nav_customers')}</div>
            <button onClick={() => setMobileTab('products')} className={'flex flex-col items-center justify-center gap-1 text-[10.5px] font-semibold ' + (mobileTab === 'products' ? 'text-primary' : 'text-muted')}>
              <LayoutGrid className="h-5 w-5" strokeWidth={1.8} />{t('nav_products')}
            </button>
            <button onClick={() => setMobileTab('cart')} className={'relative flex flex-col items-center justify-center gap-1 text-[10.5px] font-semibold ' + (mobileTab === 'cart' ? 'text-primary' : 'text-muted')}>
              <ShoppingCart className="h-5 w-5" strokeWidth={1.8} />{t('cart')}
              {count > 0 && <span className="num absolute end-[calc(50%-18px)] top-2 grid h-4 min-w-4 place-items-center rounded-lg bg-negative px-1 text-[9px] font-bold text-white">{count}</span>}
            </button>
          </nav>
        </>
      )}

      <ReceiptDialog receipt={receipt} onClose={() => setReceipt(null)} />
    </div>
  );
}
