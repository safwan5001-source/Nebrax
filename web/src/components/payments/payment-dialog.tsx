'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { api, ApiError } from '@/lib/api';
import { formatRiyal, riyalToMinor } from '@/lib/money';

interface Partner { id: string; name: string; type: string }
interface Doc { id: string; number: string; remaining: string; payment_status: string; status: string; partner_id: string }

export function PaymentDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('paymentForm');
  const [partners, setPartners] = useState<Partner[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);

  const [direction, setDirection] = useState<'received' | 'paid'>('received');
  const [partnerId, setPartnerId] = useState('');
  const [method, setMethod] = useState('cash');
  const [docId, setDocId] = useState(''); // المستند المخصَّص (اختياري)
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    api<{ data: Partner[] }>('/partners').then((r) => setPartners(r.data));
  }, [open]);

  // أطراف مناسبة للاتجاه
  const eligiblePartners = useMemo(
    () =>
      partners.filter((p) =>
        direction === 'received' ? ['customer', 'both'].includes(p.type) : ['supplier', 'both'].includes(p.type)
      ),
    [partners, direction]
  );

  // جلب المستندات المفتوحة للطرف عند اختياره
  useEffect(() => {
    setDocId('');
    setDocs([]);
    if (!open || !partnerId) return;
    const path = direction === 'received' ? '/invoices' : '/purchases';
    api<{ data: Doc[] }>(path).then((r) => {
      setDocs(
        r.data.filter(
          (d) => d.partner_id === partnerId && d.status === 'posted' && d.payment_status !== 'paid'
        )
      );
    });
  }, [open, partnerId, direction]);

  function selectDoc(id: string) {
    setDocId(id);
    const d = docs.find((x) => x.id === id);
    if (d) setAmount(String(d.remaining)); // المتبقي افتراضاً
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body: Record<string, unknown> = {
      partner_id: partnerId,
      direction,
      method,
      amount: riyalToMinor(amount),
    };
    if (docId) {
      body[direction === 'received' ? 'invoice_id' : 'purchase_id'] = docId;
    }
    try {
      const created = await api<{ data: { id: string } }>('/payments', { method: 'POST', body });
      await api(`/payments/${created.data.id}/post`, { method: 'POST' });
      setPartnerId('');
      setAmount('');
      setDocId('');
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّر تسجيل الدفعة');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('title')}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="dir">{t('direction')}</Label>
            <Select
              id="dir"
              value={direction}
              onChange={(e) => {
                setDirection(e.target.value as 'received' | 'paid');
                setPartnerId('');
              }}
            >
              <option value="received">{t('received')}</option>
              <option value="paid">{t('paid')}</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="method">{t('method')}</Label>
            <Select id="method" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="cash">{t('cash')}</option>
              <option value="bank">{t('bank')}</option>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="partner">{t('partner')}</Label>
          <Select id="partner" value={partnerId} onChange={(e) => setPartnerId(e.target.value)} required>
            <option value="" disabled>
              {t('choose_partner')}
            </option>
            {eligiblePartners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>

        {partnerId && (
          <div className="space-y-1.5">
            <Label htmlFor="doc">{t('allocate')}</Label>
            <Select id="doc" value={docId} onChange={(e) => selectDoc(e.target.value)}>
              <option value="">{t('on_account')}</option>
              {docs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.number} — {t('remaining')}: {formatRiyal(d.remaining)}
                </option>
              ))}
            </Select>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="amount">{t('amount')}</Label>
          <Input
            id="amount"
            inputMode="decimal"
            className="num text-end"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </div>

        {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={saving || !partnerId}>
            {t('save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
