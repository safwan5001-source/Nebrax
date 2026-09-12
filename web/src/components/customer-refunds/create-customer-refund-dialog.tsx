'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { formatRiyal, riyalToMinor } from '@/lib/money';

interface Partner { id: string; name: string; type: string }
interface PaymentMethod { id: string; name: string; settlement_type: string; is_active: boolean; is_default: boolean }
interface EligibleSource {
  source_type: 'sales_return' | 'credit_note';
  id: string;
  number: string;
  date: string;
  total: number;
  refunded: number;
  refundable: number;
}

/**
 * إنشاء استرداد عميل: المال يخرج فعلاً للعميل مقابل مرتجعات مبيعات أو
 * إشعارات دائنة مرحّلة أنشأت رصيد عميل. الاسترداد **مخصَّصٌ بالكامل** —
 * مجموع التخصيصات = المبلغ. الأرقام تأتي محسوبة من الخادم.
 */
export function CreateCustomerRefundDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useTranslations('customerRefunds');
  const tc = useTranslations('common');
  const { success } = useToast();

  const [partners, setPartners] = useState<Partner[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [eligible, setEligible] = useState<EligibleSource[]>([]);
  const [partnerId, setPartnerId] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [refundDate, setRefundDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [postNow, setPostNow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    Promise.all([
      api<{ data: Partner[] }>('/partners?type=customer'),
      api<{ data: PaymentMethod[] }>('/payment-methods'),
    ]).then(([partnerResponse, methodResponse]) => {
      setPartners(partnerResponse.data);
      const active = methodResponse.data.filter((method) => method.is_active);
      setPaymentMethods(active);
      setPaymentMethodId((current) => current || active.find((method) => method.is_default)?.id || active[0]?.id || '');
    });
  }, [open]);

  useEffect(() => {
    setEligible([]);
    setAllocations({});
    if (!open || !partnerId) return;
    api<{ data: EligibleSource[] }>(`/customer-refunds/eligible-sources/${partnerId}`)
      .then((response) => setEligible(response.data))
      .catch(() => setEligible([]));
  }, [open, partnerId]);

  const allocatedMinor = useMemo(
    () => Object.values(allocations).reduce((sum, value) => sum + (value ? riyalToMinor(value) : 0), 0),
    [allocations]
  );

  function allocationKey(row: EligibleSource) {
    return `${row.source_type}:${row.id}`;
  }

  function setAllocation(row: EligibleSource, value: string) {
    setAllocations((current) => ({ ...current, [allocationKey(row)]: value }));
  }

  function fill(row: EligibleSource) {
    setAllocation(row, String(row.refundable / 100));
  }

  async function submit() {
    setError(null);
    const rows = eligible
      .map((row) => {
        const value = allocations[allocationKey(row)];
        if (!value || riyalToMinor(value) <= 0) return null;
        return {
          source_type: row.source_type,
          source_id: row.id,
          amount: riyalToMinor(value),
        };
      })
      .filter((row): row is { source_type: EligibleSource['source_type']; source_id: string; amount: number } => row !== null);

    if (!partnerId || rows.length === 0) {
      setError(t('validation_allocation_required'));
      return;
    }

    setSaving(true);
    try {
      const created = await api<{ data: { id: string } }>('/customer-refunds', {
        method: 'POST',
        body: {
          partner_id: partnerId,
          amount: allocatedMinor,
          payment_method_id: paymentMethodId || null,
          refund_date: refundDate,
          reference: reference || null,
          notes: notes || null,
          allocations: rows,
        },
      });
      if (postNow) await api(`/customer-refunds/${created.data.id}/post`, { method: 'POST' });
      success(tc('created'));
      setAllocations({});
      setReference('');
      setNotes('');
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('save_failed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('new')}>
      <div className="space-y-4">
        <p className="rounded border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-muted">
          {t('dialog_hint')}
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="crf-partner">{t('customer')}</Label>
            <Select id="crf-partner" value={partnerId} onChange={(event) => setPartnerId(event.target.value)}>
              <option value="">{t('select_customer')}</option>
              {partners.map((partner) => (
                <option key={partner.id} value={partner.id}>{partner.name}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="crf-method">{t('destination')}</Label>
            <Select id="crf-method" value={paymentMethodId} onChange={(event) => setPaymentMethodId(event.target.value)}>
              {paymentMethods.map((method) => (
                <option key={method.id} value={method.id}>{method.name}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="crf-date">{t('refund_date')}</Label>
            <Input id="crf-date" type="date" value={refundDate} onChange={(event) => setRefundDate(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="crf-reference">{t('reference')}</Label>
            <Input id="crf-reference" value={reference} onChange={(event) => setReference(event.target.value)} />
          </div>
        </div>

        <div className="space-y-2">
          <Label>{t('allocations')}</Label>
          {!partnerId ? (
            <p className="rounded border border-dashed border-border px-3 py-6 text-center text-sm text-muted">
              {t('select_customer_first')}
            </p>
          ) : eligible.length === 0 ? (
            <p className="rounded border border-dashed border-border px-3 py-6 text-center text-sm text-muted">
              {t('no_eligible_sources')}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <thead className="border-b border-border text-start text-muted">
                  <tr>
                    <th className="px-2 py-2 font-medium">{t('col_source')}</th>
                    <th className="px-2 py-2 font-medium">{t('col_total')}</th>
                    <th className="px-2 py-2 font-medium">{t('col_refundable')}</th>
                    <th className="px-2 py-2 font-medium">{t('col_allocated')}</th>
                  </tr>
                </thead>
                <tbody>
                  {eligible.map((row) => (
                    <tr key={allocationKey(row)} className="border-b border-border/70 last:border-0">
                      <td className="px-2 py-2">
                        <span className="num text-text">{row.number}</span>
                        <span className="mx-2 text-xs text-muted">{t(`source_${row.source_type}`)}</span>
                        <span className="num text-xs text-muted">{row.date}</span>
                      </td>
                      <td className="num px-2 py-2 text-muted">{formatRiyal(String(row.total / 100))}</td>
                      <td className="num px-2 py-2 text-text">{formatRiyal(String(row.refundable / 100))}</td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1">
                          <Input
                            className="w-28"
                            inputMode="decimal"
                            value={allocations[allocationKey(row)] ?? ''}
                            onChange={(event) => setAllocation(row, event.target.value)}
                          />
                          <Button type="button" variant="ghost" size="sm" onClick={() => fill(row)}>
                            {t('fill')}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between rounded border border-border bg-surface px-3 py-2">
          <span className="text-sm text-muted">{t('total_amount')}</span>
          <span className="num text-sm font-medium text-text">{formatRiyal(String(allocatedMinor / 100))}</span>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="crf-notes">{t('notes')}</Label>
          <Textarea id="crf-notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
        </div>

        <label className="flex items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={postNow}
            onChange={(event) => setPostNow(event.target.checked)}
            className="h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          />
          {t('post_now')}
        </label>

        {error && <p className="rounded-md bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>{tc('cancel')}</Button>
          <Button disabled={saving || allocatedMinor <= 0} onClick={submit}>
            {tc('save')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
