'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { apiErrorCode } from '@/modules/payments/gateways/contract';
import { REASON_MAX, knownError, reasonValid } from './contract';

/**
 * حسم علم «استرداد خارجي» على دفعة (`payment_refunds.resolve_unknown`): يزامن التراكمي المحلي مع المزوّد ويُلغي ذرّياً كل طلب استرداد معلَّق (طلبٌ/معتمَد) على الدفعة
 * فيُعاد الطلب والاعتماد المستقل على السعة الجديدة. القرار بسبب مسجَّل ≥ ٥ أحرف.
 */
export function ResolveExternalDialog({ attemptId, onClose, onDone }: { attemptId: string; onClose: () => void; onDone: () => void }) {
  const t = useTranslations('paymentRefunds');
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await api(`/payment-attempts/${attemptId}/resolve-external-refund`, { method: 'POST', body: { reason: reason.trim() } });
      toast.success(t('done_resolve_external'));
      onDone();
    } catch (e) {
      setError(t(`error_${knownError(apiErrorCode(e))}` as 'error_unknown'));
      setSaving(false);
    }
  }

  return (
    <Dialog open title={t('dialog_resolve_external_title')} onClose={onClose} closeLabel={t('close')}>
      <div className="space-y-4">
        <p className="text-sm leading-6 text-muted">{t('dialog_resolve_external_intro')}</p>
        <div className="space-y-1.5">
          <Label htmlFor="rf-ext-reason">{t('reason')}</Label>
          <Textarea id="rf-ext-reason" value={reason} maxLength={REASON_MAX} onChange={(e) => setReason(e.target.value)} aria-describedby="rf-ext-hint" />
          <p id="rf-ext-hint" className="text-xs text-muted">{t('reason_hint')}</p>
        </div>
        {error && <p role="alert" className="text-sm text-negative">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>{t('cancel')}</Button>
          <Button onClick={() => void submit()} disabled={saving || !reasonValid(reason)} aria-busy={saving}>{saving ? t('saving') : t('dialog_resolve_external_submit')}</Button>
        </div>
      </div>
    </Dialog>
  );
}
