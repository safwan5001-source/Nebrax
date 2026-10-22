'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { apiErrorCode, apiErrorMessage, errorMessageKey, type GatewayConnection } from './contract';

const MIN_REASON = 3;

/** إلغاء الاعتماد نهائي ويمحو الأسرار، والخادم يشترط سبباً (`gateway.reason_required`): نجمعه هنا قبل الإرسال. */
export function RevokeDialog({
  connection,
  name,
  onClose,
  onRevoked,
}: {
  connection: GatewayConnection | null;
  name: string;
  onClose: () => void;
  onRevoked: (connection: GatewayConnection) => void;
}) {
  const t = useTranslations('paymentGateways');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setReason('');
    setError(null);
    onClose();
  }

  async function submit() {
    if (!connection) return;
    const trimmed = reason.trim();
    if (trimmed.length < MIN_REASON) {
      setError(t('revoke.reasonRequired'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await api<{ data: GatewayConnection }>(`/payment-gateways/${connection.id}/revoke`, {
        method: 'POST',
        body: { reason: trimmed },
      });
      setReason('');
      onRevoked(response.data);
    } catch (err) {
      const code = apiErrorCode(err);
      setError(code && t.has(errorMessageKey(code)) ? t(errorMessageKey(code)) : (apiErrorMessage(err) ?? t('revoke.failed')));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={connection !== null} onClose={close} title={t('revoke.title')} className="max-w-md">
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-text">{t('confirm.revoke', { name })}</p>
        <div className="space-y-1.5">
          <Label htmlFor="revoke-reason">{t('revoke.reason')}</Label>
          <Textarea id="revoke-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} autoFocus />
        </div>
        {error && <p role="alert" className="rounded-md bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={close}>{t('actions.cancel')}</Button>
          <Button variant="danger" disabled={saving} onClick={submit}>{saving ? t('revoke.saving') : t('revoke.submit')}</Button>
        </div>
      </div>
    </Dialog>
  );
}
