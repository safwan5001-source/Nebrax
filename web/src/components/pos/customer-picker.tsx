'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search, UserPlus } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, ApiError } from '@/lib/api';

export interface PosCustomer { id: string; name: string }
interface Partner { id: string; name: string; type: string; phone?: string | null }

/**
 * منتقي عميل نقطة البيع: بحث في العملاء الحاليين وإضافة صريحة عند الحاجة.
 * يعيد دائماً مرجع عميل حقيقياً إلى الكاشير؛ فلا يخلق تحصيل POS عميلاً ضمنياً.
 */
export function CustomerPickerDialog({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (customer: PosCustomer) => void;
}) {
  const t = useTranslations('pos');
  const tc = useTranslations('common');
  const [partners, setPartners] = useState<Partner[]>([]);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQ(''); setAdding(false); setNewName(''); setNewPhone(''); setError(null);
    api<{ data: Partner[] }>('/partners')
      .then((r) => setPartners(r.data.filter((p) => ['customer', 'both'].includes(p.type))))
      .catch(() => {});
  }, [open]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return partners.slice(0, 50);
    return partners.filter((p) => p.name.toLowerCase().includes(s) || (p.phone ?? '').includes(s)).slice(0, 50);
  }, [partners, q]);

  async function quickAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true); setError(null);
    try {
      const r = await api<{ data: { id: string; name?: string } }>('/partners', {
        method: 'POST',
        body: { name: newName.trim(), type: 'customer', phone: newPhone.trim() || null },
      });
      onSelect({ id: r.data.id, name: r.data.name ?? newName.trim() });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('select_customer')} className="max-w-md">
      {adding ? (
        <form onSubmit={quickAdd} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cn">{t('customer_name')}</Label>
            <Input id="cn" value={newName} onChange={(e) => setNewName(e.target.value)} required autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cp">{t('customer_phone')}</Label>
            <Input id="cp" dir="ltr" className="num" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
          </div>
          {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setAdding(false)}>{t('back')}</Button>
            <Button type="submit" className="min-h-11" disabled={busy}>{t('add_and_select')}</Button>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          <div className="flex min-h-11 items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
            <Search className="h-4 w-4 text-muted" strokeWidth={1.8} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('customer_search')}
              autoFocus
              className="w-full bg-transparent text-sm text-text outline-none placeholder:text-muted"
            />
          </div>

          <div className="max-h-72 space-y-1 overflow-y-auto">
            {filtered.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => { onSelect({ id: p.id, name: p.name }); onClose(); }}
                className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-start text-sm touch-manipulation hover:border-primary hover:bg-primary-soft active:bg-primary-soft"
              >
                <span className="truncate">{p.name}</span>
                {p.phone && <span className="num shrink-0 text-[11px] text-muted">{p.phone}</span>}
              </button>
            ))}
            {filtered.length === 0 && <p className="py-6 text-center text-xs text-muted">{t('no_customers')}</p>}
          </div>

          <Button type="button" variant="outline" className="min-h-11 w-full" onClick={() => setAdding(true)}>
            <UserPlus className="h-4 w-4" strokeWidth={1.8} />
            {t('add_customer')}
          </Button>
        </div>
      )}
    </Dialog>
  );
}
