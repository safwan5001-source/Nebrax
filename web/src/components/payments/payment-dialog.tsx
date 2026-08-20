'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { formatRiyal, riyalToMinor } from '@/lib/money';

interface Partner { id: string; name: string; type: string }
interface Doc { id: string; number: string; remaining: string; payment_status: string; status: string; partner_id: string }
interface PaymentMethod { id: string; name: string; settlement_type: 'cash' | 'bank'; is_active: boolean; is_default: boolean }

export function PaymentDialog({
  open,
  onClose,
  onSaved,
  fixedDirection,
  initialInvoice,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** يثبّت اتجاه الدفعة ويُخفي منتقيه — لشاشتَي مدفوعات العملاء/الموردين. */
  fixedDirection?: 'received' | 'paid';
  /** فاتورة مصدر اختيارية؛ تهيّئ سند قبض ولا تتجاوز تحقق الخادم أو الترحيل. */
  initialInvoice?: { id: string; partnerId: string; remaining: string };
}) {
  const t = useTranslations('paymentForm');
  const tc = useTranslations('common');
  const { success } = useToast();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);

  const [direction, setDirection] = useState<'received' | 'paid'>(fixedDirection ?? 'received');
  const [partnerId, setPartnerId] = useState('');
  const [method, setMethod] = useState('cash');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [docId, setDocId] = useState(''); // المستند المخصَّص (اختياري)
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    Promise.all([
      api<{ data: Partner[] }>('/partners'),
      api<{ data: PaymentMethod[] }>('/payment-methods'),
    ]).then(([partnerResponse, paymentMethodResponse]) => {
      setPartners(partnerResponse.data);
      const active = paymentMethodResponse.data.filter((paymentMethod) => paymentMethod.is_active);
      setPaymentMethods(active);
      setPaymentMethodId((current) => current || active.find((paymentMethod) => paymentMethod.is_default)?.id || active[0]?.id || '');
    });
  }, [open]);

  // الدخول من فاتورة لا ينشئ دفعة بنفسه؛ يهيئ فقط العميل والمستند والمبلغ المتبقي.
  useEffect(() => {
    if (!open || !initialInvoice) return;
    setDirection('received');
    setPartnerId(initialInvoice.partnerId);
    setDocId(initialInvoice.id);
    setAmount(initialInvoice.remaining);
  }, [open, initialInvoice?.id, initialInvoice?.partnerId, initialInvoice?.remaining]);

  // أطراف مناسبة للاتجاه
  const eligiblePartners = useMemo(
    () =>
      partners.filter((p) =>
        direction === 'received' ? ['customer', 'both'].includes(p.type) : ['supplier', 'both'].includes(p.type)
      ),
    [partners, direction]
  );

  // جلب المستندات المفتوحة للطرف عند اختياره. التهيئة من الفاتورة تُطابق
  // المستند مع القائمة المعادة من الخادم، فلا تُقبل فاتورة غير مؤهلة بالواجهة فقط.
  useEffect(() => {
    setDocs([]);
    if (!open || !partnerId) return;
    const path = direction === 'received' ? '/invoices' : '/purchases';
    api<{ data: Doc[] }>(path).then((r) => {
      const openDocs = r.data.filter(
        (d) => d.partner_id === partnerId && d.status === 'posted' && d.payment_status !== 'paid'
      );
      setDocs(openDocs);
      const prefilled = direction === 'received' && initialInvoice
        ? openDocs.find((d) => d.id === initialInvoice.id)
        : undefined;
      if (prefilled) {
        setDocId(prefilled.id);
        setAmount(String(prefilled.remaining));
      } else {
        setDocId('');
      }
    });
  }, [open, partnerId, direction, initialInvoice?.id]);

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
      ...(paymentMethodId ? { payment_method_id: paymentMethodId } : { method }),
      amount: riyalToMinor(amount),
    };
    if (docId) {
      body[direction === 'received' ? 'invoice_id' : 'purchase_id'] = docId;
    }
    try {
      const created = await api<{ data: { id: string } }>('/payments', { method: 'POST', body });
      await api(`/payments/${created.data.id}/post`, { method: 'POST' });
      success(tc('created'));
      setPartnerId('');
      setAmount('');
      setPaymentMethodId(paymentMethods.find((paymentMethod) => paymentMethod.is_default)?.id ?? paymentMethods[0]?.id ?? '');
      setDocId('');
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('title')}>
      <form onSubmit={submit} className="space-y-3">
        <div className={fixedDirection ? 'grid grid-cols-1 gap-3' : 'grid grid-cols-2 gap-3'}>
          {/* الاتجاه يظهر في الشاشة العامة وحدها؛ الشاشتان المتخصّصتان تثبّتانه. */}
          {!fixedDirection && (
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
          )}
          <div className="space-y-1.5">
            <Label htmlFor="method">{t('method')}</Label>
            {paymentMethods.length > 0 ? (
              <Select id="method" value={paymentMethodId} onChange={(e) => setPaymentMethodId(e.target.value)}>
                {paymentMethods.map((paymentMethod) => (
                  <option key={paymentMethod.id} value={paymentMethod.id}>{paymentMethod.name}</option>
                ))}
              </Select>
            ) : (
              <Select id="method" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="cash">{t('cash')}</option>
                <option value="bank">{t('bank')}</option>
              </Select>
            )}
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
