'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { apiErrorCode, apiErrorMessage, errorMessageKey, secretsPayload, type GatewayConnection } from './contract';

/** تدوير الأسرار: يُرسل ما أُدخل فقط (الفارغ لا يمسح سراً قائماً)؛ السر السابق للـwebhook يبقى صالحاً طوال نافذة السماح. */
export function RotateCredentialsDialog({
  connection,
  onClose,
  onRotated,
}: {
  connection: GatewayConnection | null;
  onClose: () => void;
  onRotated: (connection: GatewayConnection) => void;
}) {
  const t = useTranslations('paymentGateways');
  const [secret, setSecret] = useState('');
  const [webhook, setWebhook] = useState('');
  const [grace, setGrace] = useState('60');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setSecret('');
    setWebhook('');
    setError(null);
    onClose();
  }

  async function submit() {
    if (!connection) return;
    const secrets = secretsPayload({ secret_key: secret, webhook_secret: webhook });
    if (Object.keys(secrets).length === 0) {
      setError(t('rotate.nothing'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await api<{ data: GatewayConnection }>(`/payment-gateways/${connection.id}/rotate-credentials`, {
        method: 'POST',
        body: { ...secrets, grace_minutes: Number.parseInt(grace, 10) || 0 },
      });
      setSecret('');
      setWebhook('');
      onRotated(response.data);
    } catch (err) {
      const code = apiErrorCode(err);
      setError(code && t.has(errorMessageKey(code)) ? t(errorMessageKey(code)) : (apiErrorMessage(err) ?? t('rotate.failed')));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={connection !== null} onClose={close} title={t('rotate.title')} className="max-w-md">
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-muted">{t('rotate.intro')}</p>
        <div className="space-y-1.5">
          <Label htmlFor="rot-secret">{t('form.secretKey')}</Label>
          <Input id="rot-secret" dir="ltr" type="password" autoComplete="new-password" value={secret} onChange={(e) => setSecret(e.target.value)} autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rot-webhook">{t('form.webhookSecret')}</Label>
          <Input id="rot-webhook" dir="ltr" type="password" autoComplete="new-password" value={webhook} onChange={(e) => setWebhook(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rot-grace">{t('rotate.grace')}</Label>
          <Input id="rot-grace" type="number" inputMode="numeric" min={0} max={10080} className="num" value={grace} onChange={(e) => setGrace(e.target.value)} />
          <p className="text-xs leading-relaxed text-muted">{t('rotate.graceHint')}</p>
        </div>
        {error && <p role="alert" className="rounded-md bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={close}>{t('actions.cancel')}</Button>
          <Button disabled={saving} onClick={submit}>{saving ? t('rotate.saving') : t('rotate.submit')}</Button>
        </div>
      </div>
    </Dialog>
  );
}
