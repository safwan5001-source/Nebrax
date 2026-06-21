'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { api, ApiError } from '@/lib/api';
import { formatRiyal, riyalToMinor } from '@/lib/money';

interface Partner { id: string; name: string }
interface Line { description: string; quantity: string; unit_price: string; tax_rate: string }

const emptyLine = (): Line => ({ description: '', quantity: '1', unit_price: '', tax_rate: '15' });

export function CreateInvoiceDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useTranslations('invoiceForm');
  const [partners, setPartners] = useState<Partner[]>([]);
  const [partnerId, setPartnerId] = useState('');
  const [paymentType, setPaymentType] = useState('cash');
  const [postNow, setPostNow] = useState(true);
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    api<{ data: Partner[] }>('/partners').then((r) => {
      setPartners(r.data);
      if (r.data[0]) setPartnerId((p) => p || r.data[0].id);
    });
  }, [open]);

  const setLine = (i: number, k: keyof Line, v: string) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));
  const addLine = () => setLines((ls) => [...ls, emptyLine()]);
  const removeLine = (i: number) => setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls));

  // معاينة الإجمالي (هللات) — حساب صحيح بلا float
  const totalMinor = lines.reduce((sum, l) => {
    const sub = (Number(l.quantity) || 0) * riyalToMinor(l.unit_price);
    const tax = Math.round((sub * (Number(l.tax_rate) || 0)) / 100);
    return sum + sub + tax;
  }, 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const items = lines.map((l) => ({
      description: l.description || null,
      quantity: Number(l.quantity) || 1,
      unit_price: riyalToMinor(l.unit_price),
      tax_rate: Number(l.tax_rate) || 0,
    }));
    try {
      const created = await api<{ data: { id: string } }>('/invoices', {
        method: 'POST',
        body: { partner_id: partnerId, payment_type: paymentType, items },
      });
      if (postNow) {
        await api(`/invoices/${created.data.id}/post`, { method: 'POST' });
      }
      // إعادة الضبط
      setLines([emptyLine()]);
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّر إنشاء الفاتورة');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('title')} className="max-w-2xl">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="partner">{t('partner')}</Label>
            <Select id="partner" value={partnerId} onChange={(e) => setPartnerId(e.target.value)} required>
              <option value="" disabled>
                {t('choose_partner')}
              </option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
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

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>{t('lines')}</Label>
            <Button type="button" variant="outline" size="sm" onClick={addLine}>
              <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
              {t('add_line')}
            </Button>
          </div>

          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 items-center gap-2">
                <Input
                  className="col-span-5"
                  placeholder={t('description')}
                  value={l.description}
                  onChange={(e) => setLine(i, 'description', e.target.value)}
                />
                <Input
                  className="num col-span-2 text-end"
                  type="number"
                  min={1}
                  placeholder={t('qty')}
                  value={l.quantity}
                  onChange={(e) => setLine(i, 'quantity', e.target.value)}
                />
                <Input
                  className="num col-span-2 text-end"
                  inputMode="decimal"
                  placeholder={t('price')}
                  value={l.unit_price}
                  onChange={(e) => setLine(i, 'unit_price', e.target.value)}
                />
                <Input
                  className="num col-span-2 text-end"
                  type="number"
                  min={0}
                  max={100}
                  value={l.tax_rate}
                  onChange={(e) => setLine(i, 'tax_rate', e.target.value)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="col-span-1"
                  aria-label={t('remove_line')}
                  onClick={() => removeLine(i)}
                >
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
          <Button type="submit" disabled={saving || !partnerId}>
            {t('create')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
