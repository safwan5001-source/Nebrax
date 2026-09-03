'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScopePicker } from '@/components/developer/scope-picker';
import { API_SCOPES, createApiClient, issueApiKey, type IssuedKey } from '@/lib/developer';
import { ApiError } from '@/lib/api';

type Mode = 'create' | 'issue';

/**
 * نموذج إنشاء عميل (بمفتاحه الأوّل) أو إصدار مفتاح إضافي. حالة محكومة + تحقّق قبل
 * الإرسال؛ والخادم يبقى المرجع (٤٢٢ تُعرَض للمستخدم). النطاقات من كتالوج العقد فقط،
 * ونصّها التقني محفوظ حرفياً. المدّة اختيارية (بلا انتهاء افتراضياً).
 */
export function KeyFormDialog({
  open,
  mode,
  clientId,
  clientName,
  onClose,
  onIssued,
}: {
  open: boolean;
  mode: Mode;
  clientId?: string;
  clientName?: string;
  onClose: () => void;
  onIssued: (result: IssuedKey) => void;
}) {
  const t = useTranslations('developer.keys');
  const tc = useTranslations('developer.common');
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>([]);
  const [withExpiry, setWithExpiry] = useState(false);
  const [days, setDays] = useState('90');
  const [errors, setErrors] = useState<{ name?: string; scopes?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  function reset() {
    setName('');
    setScopes([]);
    setWithExpiry(false);
    setDays('90');
    setErrors({});
    setBusy(false);
  }

  function close() {
    reset();
    onClose();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const next: typeof errors = {};
    if (mode === 'create' && name.trim() === '') next.name = t('nameHint');
    if (scopes.length === 0) next.scopes = t('scopesRequired');
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const expires_in_days = withExpiry ? Number(days) || null : null;
    setBusy(true);
    try {
      const result = mode === 'create'
        ? await createApiClient({ name: name.trim(), scopes, expires_in_days })
        : await issueApiKey(clientId!, { name: name.trim() || null, scopes, expires_in_days });
      reset();
      onIssued(result);
    } catch (error) {
      const message = error instanceof ApiError ? String(error.body && (error.body as { message?: string }).message || error.message) : t('createError');
      setErrors({ form: message });
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={close} title={mode === 'create' ? t('createTitle') : t('issueTitle')} className="max-w-xl">
      <form onSubmit={submit} className="space-y-4">
        {mode === 'issue' && clientName ? (
          <p className="text-xs text-muted">{t('issueFor', { name: clientName })}</p>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="dev-key-name">{mode === 'create' ? t('nameLabel') : t('keyNameLabel')}</Label>
          <Input
            id="dev-key-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={mode === 'create' ? t('namePlaceholder') : t('keyNamePlaceholder')}
            aria-invalid={Boolean(errors.name)}
            maxLength={255}
          />
          <p className="text-xs text-muted">{mode === 'create' ? t('nameHint') : ''}</p>
          {errors.name ? <p className="text-xs text-negative" role="alert">{errors.name}</p> : null}
        </div>

        <div className="space-y-1.5">
          <Label>{t('scopesLabel')}</Label>
          <p className="text-xs text-muted">{t('scopesHint')}</p>
          <ScopePicker scopes={API_SCOPES} value={scopes} onChange={setScopes} error={errors.scopes} disabled={busy} />
        </div>

        <div className="space-y-1.5">
          <Label>{t('expiryLabel')}</Label>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-text">
              <input type="radio" name="expiry" checked={!withExpiry} onChange={() => setWithExpiry(false)} className="h-4 w-4 accent-[color:var(--primary)]" />
              {t('expiryNever')}
            </label>
            <label className="flex items-center gap-2 text-sm text-text">
              <input type="radio" name="expiry" checked={withExpiry} onChange={() => setWithExpiry(true)} className="h-4 w-4 accent-[color:var(--primary)]" />
              {t('expiryDays')}
            </label>
            {withExpiry ? (
              <span className="flex items-center gap-2">
                <Input
                  type="number"
                  value={days}
                  min={1}
                  max={3650}
                  onChange={(event) => setDays(event.target.value)}
                  aria-label={t('expiryDaysLabel')}
                  className="w-24"
                />
                <span className="text-xs text-muted">{t('expiryDaysHint')}</span>
              </span>
            ) : null}
          </div>
        </div>

        {errors.form ? <p className="rounded border border-negative/40 bg-negative/10 px-3 py-2 text-sm text-negative" role="alert">{errors.form}</p> : null}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="outline" onClick={close} disabled={busy}>{tc('cancel')}</Button>
          <Button type="submit" disabled={busy}>{busy ? tc('creating') : (mode === 'create' ? tc('create') : t('issueAnother'))}</Button>
        </div>
      </form>
    </Dialog>
  );
}
