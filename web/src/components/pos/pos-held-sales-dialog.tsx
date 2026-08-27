'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Archive, LoaderCircle, Play, ShoppingBag, Trash2 } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError } from '@/lib/api';

export interface PosHeldSaleItem {
  product_id: string | null;
  description: string | null;
  sku: string | null;
  quantity: number;
  unit: string | null;
  unit_price: string;
  tax_rate: number;
  discount: string;
}

export interface PosHeldSale {
  id: string;
  cart_id?: string | null;
  status: 'held' | 'resumed' | 'discarded';
  tax_inclusive: boolean;
  items: PosHeldSaleItem[];
  customer: { id: string; name: string } | null;
  created_at: string | null;
}

interface Props {
  open: boolean;
  sessionId: string | null;
  onClose: () => void;
  onResumed: (held: PosHeldSale) => void;
  onChanged: () => void;
}

/** قائمة سلال الخادم ضمن سياق الجلسة؛ لا تنشئ ولا ترحّل مستنداً مالياً. */
export function PosHeldSalesDialog({ open, sessionId, onClose, onResumed, onChanged }: Props) {
  const t = useTranslations('pos');
  const tc = useTranslations('common');
  const [sales, setSales] = useState<PosHeldSale[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true); setError(null);
    try {
      const result = await api<{ data: PosHeldSale[] }>(`/pos/held-sales?pos_session_id=${encodeURIComponent(sessionId)}`);
      setSales(result.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [sessionId, tc]);

  useEffect(() => { if (open) void load(); }, [open, load]);

  async function resume(id: string) {
    if (!sessionId) return;
    setBusyId(id); setError(null);
    try {
      const result = await api<{ data: PosHeldSale }>(`/pos/held-sales/${id}/resume`, { method: 'POST', body: { pos_session_id: sessionId } });
      onResumed(result.data);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setBusyId(null);
    }
  }

  async function discard(id: string) {
    if (!sessionId || !window.confirm(t('held_discard_confirm'))) return;
    setBusyId(id); setError(null);
    try {
      await api(`/pos/held-sales/${id}`, { method: 'DELETE', body: { pos_session_id: sessionId } });
      setSales((current) => current.filter((sale) => sale.id !== id));
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('held_title')}>
      <div className="space-y-3">
        <p className="rounded bg-primary-soft px-3 py-2 text-xs text-text">{t('held_hint')}</p>
        {error && <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
        {loading ? <div className="space-y-2"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div> : sales.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted"><Archive className="h-7 w-7" aria-hidden="true" />{t('held_empty')}</div>
        ) : <div className="divide-y divide-border rounded border border-border">
          {sales.map((sale) => {
            const busy = busyId === sale.id;
            const count = sale.items.reduce((sum, item) => sum + item.quantity, 0);
            return <div key={sale.id} className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1"><b className="block truncate text-sm text-text">{sale.customer?.name ?? t('held_walkin_customer')}</b><span className="mt-0.5 flex items-center gap-1 text-xs text-muted"><ShoppingBag className="h-3.5 w-3.5" aria-hidden="true" />{t('held_summary', { count, items: sale.items.length })}</span><span className="num block pt-1 text-[11px] text-muted">{sale.created_at?.slice(0, 16).replace('T', ' ') ?? '—'}</span></div>
              <div className="flex shrink-0 justify-end gap-2"><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => discard(sale.id)} aria-label={t('held_discard')}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" />{t('held_discard')}</Button><Button type="button" size="sm" disabled={busy} onClick={() => resume(sale.id)}>{busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Play className="h-3.5 w-3.5" aria-hidden="true" />}{t('held_resume')}</Button></div>
            </div>;
          })}
        </div>}
      </div>
    </Dialog>
  );
}
