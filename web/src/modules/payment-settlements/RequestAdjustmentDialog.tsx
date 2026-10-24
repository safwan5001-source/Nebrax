'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { apiErrorCode, gatewayDisplayName, type GatewayConnection } from '@/modules/payments/gateways/contract';
import { ADJUSTMENT_KINDS, REASON_MAX, evidenceValid, knownError, parseMinor, reasonValid, type AdjustmentDetail } from './contract';

/**
 * طلب تعديل مزوّد (`payment_settlements.adjust`): النوع والمبلغ والسبب **والدليل** إلزامية. الطلب لا يحرّك مالاً ولا يُنشئ قيداً؛ يحتاج اعتماد مستخدم آخر ثم استهلاكاً بتسوية.
 */
export function RequestAdjustmentDialog({ gateways, defaultGatewayId, onClose, onDone }: {
  gateways: GatewayConnection[]; defaultGatewayId: string; onClose: () => void; onDone: (a: AdjustmentDetail) => void;
}) {
  const t = useTranslations('paymentAdjustments');
  const locale = useLocale();
  const toast = useToast();
  const [gatewayId, setGatewayId] = useState(defaultGatewayId);
  const [kind, setKind] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [eventRef, setEventRef] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const minor = parseMinor(amount);
  const valid = gatewayId !== '' && kind !== '' && minor !== null && reasonValid(reason) && evidenceValid(evidence);

  async function submit() {
    if (!valid || minor === null || saving) return;
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { payment_gateway_id: gatewayId, kind, amount_minor: minor, reason: reason.trim(), evidence_ref: evidence.trim() };
      if (eventRef.trim() !== '') body.provider_event_ref = eventRef.trim();
      const res = await api<{ data: AdjustmentDetail }>('/payment-gateway-adjustments', { method: 'POST', body });
      toast.success(t('request_done'));
      onDone(res.data);
    } catch (e) {
      setError(t(`error_${knownError(apiErrorCode(e))}` as 'error_unknown'));
      setSaving(false);
    }
  }

  return (
    <Dialog open title={t('request_title')} onClose={() => { if (!saving) onClose(); }} closeLabel={t('close')}>
      <div className="space-y-4">
        <p className="text-sm leading-6 text-muted">{t('request_intro')}</p>
        <div className="space-y-1.5">
          <Label htmlFor="ra-gateway">{t('field_gateway')}</Label>
          <Select id="ra-gateway" value={gatewayId} onChange={(e) => setGatewayId(e.target.value)}>
            <option value="">{t('choose')}</option>
            {gateways.map((g) => <option key={g.id} value={g.id}>{gatewayDisplayName(g, locale)}</option>)}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ra-kind">{t('col_kind')}</Label>
          <Select id="ra-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">{t('choose')}</option>
            {ADJUSTMENT_KINDS.map((k) => <option key={k} value={k}>{t(`kind_${k}` as 'kind_reserve_hold')}</option>)}
          </Select>
          {kind !== '' && <p className="text-xs leading-5 text-muted">{t(`kind_hint_${kind}` as 'kind_hint_reserve_hold')}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ra-amount">{t('col_amount')}</Label>
          <Input id="ra-amount" inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={amount.trim() !== '' && minor === null} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ra-evidence">{t('col_evidence')}</Label>
          <Input id="ra-evidence" dir="ltr" value={evidence} maxLength={191} onChange={(e) => setEvidence(e.target.value)} aria-describedby="ra-evidence-hint" />
          <p id="ra-evidence-hint" className="text-xs text-muted">{t('evidence_hint')}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ra-event">{t('field_event_ref')}</Label>
          <Input id="ra-event" dir="ltr" value={eventRef} maxLength={191} onChange={(e) => setEventRef(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ra-reason">{t('reason')}</Label>
          <Textarea id="ra-reason" value={reason} maxLength={REASON_MAX} onChange={(e) => setReason(e.target.value)} aria-describedby="ra-reason-hint" />
          <p id="ra-reason-hint" className="text-xs text-muted">{t('reason_hint')}</p>
        </div>
        {error && <p role="alert" className="text-sm text-negative">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>{t('cancel')}</Button>
          <Button onClick={() => void submit()} disabled={saving || !valid} aria-busy={saving}>{saving ? t('saving') : t('request_submit')}</Button>
        </div>
      </div>
    </Dialog>
  );
}
