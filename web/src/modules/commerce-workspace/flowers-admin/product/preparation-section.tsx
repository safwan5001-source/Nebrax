'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { FormActions, FormAlert } from '@/components/nebrax';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import type { AdminFailure } from '../admin-http';
import type { LeadUnit } from '../delivery-schedule';
import { failureText } from '../failure-text';
import { flowersAdminT } from '../messages';
import { SettingRow, SettingsList } from '../settings-list';
import { useUnsavedGuard } from '../use-unsaved-guard';
import { loadPreparation, preparationToMinutes, savePreparation, splitPreparation } from './preparation';
import { SectionState } from './section-state';

type Phase = { kind: 'loading' } | { kind: 'failed'; failure: AdminFailure } | { kind: 'ready'; saved: number };

/**
 * FLOWERS-H2-6 / ADR-20 — مهلة تجهيز المنتج. تُعرض الحالة الفعلية («بلا مهلة خاصة» أو المدة) وأثرها: المهلة
 * الفعلية هي الأكبر بين مهلة القناة ومهلة المنتج. لا يُحسب هنا موعد تسليم ولا وعد؛ الخادم وحده.
 */
export function PreparationSection({ productId, locale, canManage }: { productId: string; locale: string | undefined; canManage: boolean }) {
  const t = useMemo(() => flowersAdminT(locale), [locale]);
  const { success: toastSuccess } = useToast();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState<LeadUnit>('hours');
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setPhase({ kind: 'loading' });
    void loadPreparation(productId).then((result) => {
      if (!current) return;
      if (!result.ok) {
        setPhase({ kind: 'failed', failure: result });
        return;
      }
      const split = splitPreparation(result.data.minutes);
      setValue(split.value);
      setUnit(split.unit);
      setPhase({ kind: 'ready', saved: result.data.minutes });
    });
    return () => {
      current = false;
    };
  }, [productId, attempt]);

  const minutes = preparationToMinutes(value, unit);
  const saved = phase.kind === 'ready' ? phase.saved : 0;
  const dirty = phase.kind === 'ready' && (minutes === null || minutes !== saved);
  useUnsavedGuard(dirty);

  if (phase.kind !== 'ready') {
    return <SectionState phase={phase} t={t} icon="clock" onRetry={() => setAttempt((n) => n + 1)} />;
  }

  const error = touched && minutes === null ? t('prepInvalid') : null;
  const summary = saved === 0 ? t('prepNone') : t('prepSet', { duration: describeDuration(saved, locale) });

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving || !dirty || !canManage) return;
    if (minutes === null) {
      setTouched(true);
      return;
    }
    setSaving(true);
    setServerError(null);
    const result = await savePreparation(productId, minutes);
    setSaving(false);
    if (!result.ok) {
      setServerError(failureText(result, t));
      return;
    }
    const split = splitPreparation(result.data.minutes);
    setValue(split.value);
    setUnit(split.unit);
    setTouched(false);
    setPhase({ kind: 'ready', saved: result.data.minutes });
    toastSuccess(t('prepSaved'));
  }

  return (
    <section aria-labelledby="prep-title" className="max-w-3xl space-y-4" data-prep-section>
      <div className="space-y-1">
        <h2 id="prep-title" className="text-sm font-semibold text-text">{t('prepTitle')}</h2>
        <p className="text-xs leading-5 text-muted">{t('prepIntro')}</p>
      </div>

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <SettingsList>
          <SettingRow
            labelId="prep-label"
            label={t('prepLabel')}
            hint={
              <>
                <span data-prep-summary className="block text-text">{summary}</span>
                <span id="prep-hint" className="mt-1 block">{t('prepHint')}</span>
              </>
            }
            error={error}
            errorId="prep-error"
            control={
              <div className="flex items-center gap-2">
                <Input
                  id="prep-value"
                  type="text"
                  inputMode="numeric"
                  dir="ltr"
                  className="w-20 text-center"
                  placeholder="—"
                  aria-labelledby="prep-label"
                  aria-describedby={error ? 'prep-hint prep-error' : 'prep-hint'}
                  aria-invalid={error !== null}
                  value={value}
                  disabled={saving || !canManage}
                  onChange={(e) => { setValue(e.target.value); setServerError(null); }}
                  onBlur={() => setTouched(true)}
                />
                <Select aria-label={t('schedLeadUnit')} className="w-28" value={unit} disabled={saving || !canManage} onChange={(e) => setUnit(e.target.value as LeadUnit)}>
                  <option value="minutes">{t('schedUnitMinutes')}</option>
                  <option value="hours">{t('schedUnitHours')}</option>
                  <option value="days">{t('schedUnitDays')}</option>
                </Select>
              </div>
            }
          />
        </SettingsList>

        <p className="text-xs leading-5 text-muted">
          {t('prepChannelNote')}{' '}
          <Link href="/commerce/delivery" className="text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            {t('prepChannelLink')}
          </Link>
        </p>

        {!canManage ? <FormAlert tone="info">{t('readOnly')}</FormAlert> : null}
        {serverError ? <FormAlert tone="error">{serverError}</FormAlert> : null}

        {canManage ? (
          <FormActions
            sticky={false}
            note={<span role="status">{dirty ? t('unsaved') : t('allSaved')}</span>}
            secondary={
              <Button
                type="button"
                variant="outline"
                disabled={!dirty || saving}
                onClick={() => {
                  const split = splitPreparation(saved);
                  setValue(split.value);
                  setUnit(split.unit);
                  setTouched(false);
                  setServerError(null);
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
        ) : null}
      </form>
    </section>
  );
}

/** «3 hours» / «ساعتان»: تصريف الوحدة بحسب اللغة والعدد عبر Intl (أرقام لاتينية). */
function describeDuration(minutes: number, locale: string | undefined): string {
  const split = splitPreparation(minutes);
  const unit = split.unit === 'days' ? 'day' : split.unit === 'hours' ? 'hour' : 'minute';
  const tag = locale?.startsWith('en') ? 'en' : 'ar-u-nu-latn';

  try {
    return new Intl.NumberFormat(tag, { style: 'unit', unit, unitDisplay: 'long' }).format(Number(split.value));
  } catch {
    return `${split.value} ${unit}`;
  }
}
