'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/api';
import {
  GATEWAY_ENVIRONMENTS,
  GATEWAY_PROVIDERS,
  apiErrorCode,
  apiErrorMessage,
  errorMessageKey,
  isRealProvider,
  secretsPayload,
  type GatewayConnection,
  type GatewayEnvironment,
  type GatewayProvider,
} from './contract';

type Step = 1 | 2 | 3;

const EMPTY = {
  provider: 'custom' as GatewayProvider,
  environment: 'sandbox' as GatewayEnvironment,
  name: '',
  name_en: '',
  merchant_reference: '',
  publishable_key: '',
  secret_key: '',
  webhook_secret: '',
};

/**
 * معالج إضافة اتصال (3 خطوات: المزوّد والبيئة ← الاعتماد ← مراجعة وحفظ كمسودة) وتعديل بيانات الاتصال غير السرّية.
 * الأسرار تُدخل عند الإضافة فقط (التدوير حوار مستقل) وتُصفَّر من الذاكرة فور الحفظ؛ لا يعرضها الخادم ولا نعرضها.
 * الحفظ يُنتج دائماً مسودة: التفعيل فعل منفصل بتأكيد.
 */
export function ConnectionFormDialog({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: GatewayConnection | null;
  onClose: () => void;
  onSaved: (connection: GatewayConnection) => void;
}) {
  const t = useTranslations('paymentGateways');
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState(() => initialForm(editing));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = editing !== null;
  // البيئة تُقفل بعد مغادرة المسودة (الخادم يرفض تغييرها: gateway.environment_locked).
  const environmentLocked = isEdit && editing.status !== 'draft';
  const set = <K extends keyof typeof EMPTY>(key: K, value: (typeof EMPTY)[K]) => setForm((current) => ({ ...current, [key]: value }));

  function close() {
    setForm(EMPTY); // لا تبقى أسرار في الحالة بعد الإغلاق
    onClose();
  }

  function next() {
    if (step === 1 && !form.name.trim()) {
      setError(t('form.nameRequired'));
      return;
    }
    setError(null);
    setStep((current) => (current === 3 ? 3 : ((current + 1) as Step)));
  }

  async function save() {
    setSaving(true);
    setError(null);
    const body: Record<string, unknown> = {
      name: form.name.trim(),
      name_en: form.name_en.trim() || null,
      ...(environmentLocked ? {} : { environment: form.environment }),
      merchant_reference: form.merchant_reference.trim() || null,
      publishable_key: form.publishable_key.trim() || null,
    };
    if (!isEdit) {
      body.provider = form.provider;
      Object.assign(body, secretsPayload(form));
    }
    try {
      const response = isEdit
        ? await api<{ data: GatewayConnection }>(`/payment-gateways/${editing.id}`, { method: 'PUT', body })
        : await api<{ data: GatewayConnection }>('/payment-gateways', { method: 'POST', body });
      setForm(EMPTY);
      onSaved(response.data);
    } catch (err) {
      const code = apiErrorCode(err);
      setError(code && t.has(errorMessageKey(code)) ? t(errorMessageKey(code)) : (apiErrorMessage(err) ?? t('form.saveFailed')));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={close} title={isEdit ? t('form.editTitle') : t('form.addTitle')} className="max-w-lg">
      <div className="space-y-4">
        {!isEdit && (
          <ol className="flex items-center gap-2 text-xs text-muted" aria-label={t('form.steps')}>
            {([1, 2, 3] as const).map((n) => (
              <li key={n} aria-current={n === step ? 'step' : undefined} className={n === step ? 'font-medium text-text' : ''}>
                {t(`form.step${n}`)}
                {n < 3 && <span aria-hidden="true" className="mx-2 text-border">/</span>}
              </li>
            ))}
          </ol>
        )}

        {(isEdit || step === 1) && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pg-provider">{t('form.provider')}</Label>
              <Select id="pg-provider" value={form.provider} disabled={isEdit} onChange={(e) => set('provider', e.target.value as GatewayProvider)}>
                {GATEWAY_PROVIDERS.map((provider) => <option key={provider} value={provider}>{t(`providers.${provider}`)}</option>)}
              </Select>
              <p className="text-xs leading-relaxed text-muted">{t(isRealProvider(form.provider) ? 'form.realProviderHint' : 'form.customProviderHint')}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pg-env">{t('form.environment')}</Label>
              <Select id="pg-env" value={form.environment} disabled={environmentLocked} onChange={(e) => set('environment', e.target.value as GatewayEnvironment)}>
                {GATEWAY_ENVIRONMENTS.map((env) => <option key={env} value={env}>{t(`environments.${env}`)}</option>)}
              </Select>
              {environmentLocked && <p className="text-xs leading-relaxed text-muted">{t('form.environmentLocked')}</p>}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pg-name">{t('form.name')}</Label>
                <Input id="pg-name" value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pg-name-en">{t('form.nameEn')}</Label>
                <Input id="pg-name-en" dir="ltr" value={form.name_en} onChange={(e) => set('name_en', e.target.value)} />
              </div>
            </div>
          </div>
        )}

        {(isEdit || step === 2) && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pg-merchant">{t('form.merchantReference')}</Label>
              <Input id="pg-merchant" dir="ltr" value={form.merchant_reference} onChange={(e) => set('merchant_reference', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pg-pk">{t('form.publishableKey')}</Label>
              <Input id="pg-pk" dir="ltr" autoComplete="off" value={form.publishable_key} onChange={(e) => set('publishable_key', e.target.value)} />
            </div>
            {!isEdit && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="pg-secret">{t('form.secretKey')}</Label>
                  <Input id="pg-secret" dir="ltr" type="password" autoComplete="new-password" value={form.secret_key} onChange={(e) => set('secret_key', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pg-webhook-secret">{t('form.webhookSecret')}</Label>
                  <Input id="pg-webhook-secret" dir="ltr" type="password" autoComplete="new-password" value={form.webhook_secret} onChange={(e) => set('webhook_secret', e.target.value)} />
                </div>
                <p className="text-xs leading-relaxed text-muted">{t('form.secretsNote')}</p>
              </>
            )}
          </div>
        )}

        {!isEdit && step === 3 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-md border border-border p-3 text-sm" data-testid="pg-review">
            <dt className="text-muted">{t('form.provider')}</dt><dd className="text-text">{t(`providers.${form.provider}`)}</dd>
            <dt className="text-muted">{t('form.environment')}</dt><dd className="text-text">{t(`environments.${form.environment}`)}</dd>
            <dt className="text-muted">{t('form.name')}</dt><dd className="text-text">{form.name}</dd>
            <dt className="text-muted">{t('form.secretKey')}</dt><dd className="text-text">{form.secret_key.trim() ? t('form.provided') : t('form.notProvided')}</dd>
            <dt className="text-muted">{t('form.webhookSecret')}</dt><dd className="text-text">{form.webhook_secret.trim() ? t('form.provided') : t('form.notProvided')}</dd>
            <dd className="col-span-2 text-xs leading-relaxed text-muted">{t('form.draftNote')}</dd>
          </dl>
        )}

        {error && <p role="alert" className="rounded-md bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}

        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="outline" onClick={close}>{t('actions.cancel')}</Button>
          <div className="flex gap-2">
            {!isEdit && step > 1 && <Button variant="outline" onClick={() => setStep((current) => ((current - 1) as Step))}>{t('form.back')}</Button>}
            {!isEdit && step < 3 ? (
              <Button onClick={next}>{t('form.next')}</Button>
            ) : (
              <Button disabled={saving || !form.name.trim()} onClick={save}>{saving ? t('form.saving') : isEdit ? t('form.saveEdit') : t('form.saveDraft')}</Button>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function initialForm(editing: GatewayConnection | null) {
  if (!editing) return EMPTY;
  return {
    ...EMPTY,
    provider: editing.provider,
    environment: editing.environment,
    name: editing.name,
    name_en: editing.name_en ?? '',
    merchant_reference: editing.merchant_reference ?? '',
    publishable_key: editing.publishable_key ?? '',
  };
}
