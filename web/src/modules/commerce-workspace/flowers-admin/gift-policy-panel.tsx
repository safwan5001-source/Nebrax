'use client';

import { useEffect, useMemo, useState } from 'react';
import { Gift } from 'lucide-react';
import { EmptyState, ErrorState, FormActions, FormAlert, LoadingState } from '@/components/nebrax';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import type { AdminFailure } from './admin-http';
import { failureText } from './failure-text';
import {
  GIFT_MESSAGE_MAX_CEILING,
  giftPoliciesEqual,
  loadGiftPolicy,
  parseMessageLength,
  saveGiftPolicy,
  type GiftPolicy,
} from './gift-settings';
import { flowersAdminT } from './messages';
import { SettingRow, SettingsList } from './settings-list';
import { useUnsavedGuard } from './use-unsaved-guard';

type Draft = { enabled: boolean; length: string; allowHideSender: boolean; recipientPhoneRequired: boolean };
type Phase = { kind: 'loading' } | { kind: 'failed'; failure: AdminFailure } | { kind: 'ready'; saved: GiftPolicy };

const toDraft = (policy: GiftPolicy): Draft => ({
  enabled: policy.enabled,
  length: String(policy.messageMaxLength),
  allowHideSender: policy.allowHideSender,
  recipientPhoneRequired: policy.recipientPhoneRequired,
});

/**
 * FLOWERS-H2-1 — سياسة الإهداء لمتجرٍ واحد. الخادم هو الحقيقة: تُقرأ القيم المحفوظة، وتُرسل الحقول الأربعة
 * كاملةً عند الحفظ، ويُعاد عرض ما أعاده الخادم. الإيقاف لا يمسح شيئاً. المُركِّب يمرّر `key={storeId}` فلا
 * يعبر نموذج متجرٍ إلى آخر.
 */
export function GiftPolicyPanel({ storeId, locale }: { storeId: string; locale: string | undefined }) {
  const t = useMemo(() => flowersAdminT(locale), [locale]);
  const { success: toastSuccess } = useToast();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [lengthTouched, setLengthTouched] = useState(false);

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setPhase({ kind: 'loading' });
    void loadGiftPolicy(storeId).then((result) => {
      if (!current) return;
      if (!result.ok) {
        setPhase({ kind: 'failed', failure: result });
        return;
      }
      setPhase({ kind: 'ready', saved: result.data });
      setDraft(toDraft(result.data));
    });
    return () => {
      current = false;
    };
  }, [storeId, attempt]);

  const parsedLength = draft ? parseMessageLength(draft.length) : null;
  const candidate: GiftPolicy | null =
    draft && parsedLength !== null
      ? {
          enabled: draft.enabled,
          messageMaxLength: parsedLength,
          allowHideSender: draft.allowHideSender,
          recipientPhoneRequired: draft.recipientPhoneRequired,
        }
      : null;
  const savedPolicy = phase.kind === 'ready' ? phase.saved : null;
  // حقل الطول غير الصالح يعدّ تعديلاً غير محفوظ أيضاً (الإدخال يختلف عن المحفوظ).
  const dirty = Boolean(
    draft && savedPolicy && (candidate === null || !giftPoliciesEqual(candidate, savedPolicy)),
  );
  useUnsavedGuard(dirty);

  if (phase.kind === 'loading') return <LoadingState variant="table" rows={4} label={t('loading')} />;
  if (phase.kind === 'failed') {
    return phase.failure.kind === 'forbidden' || phase.failure.kind === 'not_found' ? (
      <EmptyState icon={Gift} title={failureText(phase.failure, t, 'load')} />
    ) : (
      <ErrorState
        message={failureText(phase.failure, t, 'load')}
        retryLabel={t('retry')}
        onRetry={() => setAttempt((n) => n + 1)}
      />
    );
  }
  if (!draft || !savedPolicy) return null;

  const lengthInvalid = lengthTouched && parsedLength === null;
  const lengthError = lengthInvalid ? t('giftLengthInvalid', { max: GIFT_MESSAGE_MAX_CEILING }) : null;
  const patch = (next: Partial<Draft>) => {
    setServerError(null);
    setDraft((current) => (current ? { ...current, ...next } : current));
  };

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving || !draft || !dirty) return;
    if (candidate === null) {
      setLengthTouched(true);
      return;
    }
    setSaving(true);
    setServerError(null);
    const result = await saveGiftPolicy(storeId, candidate);
    setSaving(false);
    if (!result.ok) {
      setServerError(failureText(result, t));
      return;
    }
    setPhase({ kind: 'ready', saved: result.data });
    setDraft(toDraft(result.data));
    setLengthTouched(false);
    toastSuccess(t('giftSaved'));
  }

  const summary: string[] = draft.enabled
    ? [
        t('giftSummaryOn'),
        ...(parsedLength !== null ? [t('giftSummaryLength', { n: parsedLength })] : []),
        draft.allowHideSender ? t('giftSummaryHideOn') : t('giftSummaryHideOff'),
        draft.recipientPhoneRequired ? t('giftSummaryPhoneOn') : t('giftSummaryPhoneOff'),
      ]
    : [t('giftSummaryOff')];

  return (
    <form onSubmit={onSubmit} noValidate className="max-w-3xl space-y-4" aria-label={t('giftSectionTitle')} data-gift-policy>
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-text">{t('giftSectionTitle')}</h2>
        <p className="text-xs leading-5 text-muted">{t('giftSectionHint')}</p>
      </div>

      <SettingsList>
        <SettingRow
          labelId="gift-enabled-label"
          label={t('giftEnabledLabel')}
          hint={t('giftEnabledHint')}
          control={
            <Switch
              id="gift-enabled"
              aria-labelledby="gift-enabled-label"
              checked={draft.enabled}
              disabled={saving}
              onCheckedChange={(enabled) => patch({ enabled })}
            />
          }
        />
        <SettingRow
          labelId="gift-length-label"
          label={t('giftLengthLabel')}
          hint={t('giftLengthHint', { max: GIFT_MESSAGE_MAX_CEILING })}
          hintId="gift-length-hint"
          error={lengthError}
          errorId="gift-length-error"
          control={
            <div className="flex items-center gap-2">
              <Input
                id="gift-length"
                type="text"
                inputMode="numeric"
                dir="ltr"
                className="w-24 text-center"
                aria-labelledby="gift-length-label"
                aria-describedby={lengthInvalid ? 'gift-length-hint gift-length-error' : 'gift-length-hint'}
                aria-invalid={lengthInvalid}
                value={draft.length}
                disabled={saving}
                onChange={(event) => patch({ length: event.target.value })}
                onBlur={() => setLengthTouched(true)}
              />
              <span className="text-xs text-muted">{t('giftLengthUnit')}</span>
            </div>
          }
        />
        <SettingRow
          labelId="gift-hide-label"
          label={t('giftHideSenderLabel')}
          hint={t('giftHideSenderHint')}
          control={
            <Switch
              id="gift-hide"
              aria-labelledby="gift-hide-label"
              checked={draft.allowHideSender}
              disabled={saving}
              onCheckedChange={(allowHideSender) => patch({ allowHideSender })}
            />
          }
        />
        <SettingRow
          labelId="gift-phone-label"
          label={t('giftPhoneLabel')}
          hint={t('giftPhoneHint')}
          control={
            <Switch
              id="gift-phone"
              aria-labelledby="gift-phone-label"
              checked={draft.recipientPhoneRequired}
              disabled={saving}
              onCheckedChange={(recipientPhoneRequired) => patch({ recipientPhoneRequired })}
            />
          }
        />
      </SettingsList>

      {!draft.enabled ? <FormAlert tone="info">{t('giftOffNote')}</FormAlert> : null}

      <section aria-labelledby="gift-summary-title" className="rounded border border-border bg-background px-4 py-3" data-gift-summary>
        <h3 id="gift-summary-title" className="text-xs font-semibold text-text">
          {t('giftSummaryTitle')}
        </h3>
        <ul className="mt-1.5 list-disc space-y-0.5 ps-5 text-xs leading-5 text-muted">
          {summary.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      {serverError ? <FormAlert tone="error">{serverError}</FormAlert> : null}

      <FormActions
        sticky={false}
        note={<span role="status">{dirty ? t('unsaved') : t('allSaved')}</span>}
        secondary={
          <Button
            type="button"
            variant="outline"
            disabled={!dirty || saving}
            onClick={() => {
              setDraft(toDraft(savedPolicy));
              setServerError(null);
              setLengthTouched(false);
            }}
          >
            {t('discard')}
          </Button>
        }
        primary={
          <Button type="submit" disabled={!dirty || saving}>
            {saving ? t('saving') : t('save')}
          </Button>
        }
      />
    </form>
  );
}
