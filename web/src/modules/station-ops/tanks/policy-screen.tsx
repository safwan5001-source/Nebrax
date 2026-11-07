'use client';

import { useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SwitchRow } from '../admin/ui';
import { PageMasthead, ScreenBody } from '../masthead';
import { ErrorState, LoadingBlock } from '../state-views';
import { StationGate } from '../station-gate';
import type { Station } from '../schemas';
import { ConfirmDialog, PrimaryButton, SecondaryButton, SectionCard } from '../write-ui';
import { FailureNotice, type AnyFailure } from '../receiving/parts';
import { saveBackdatingPolicy } from './actions-client';
import { useBackdatingPolicy, useTanksAccess, type EffectivePolicy } from './data';
import { asFailure } from './parts';
import { BACKDATING_POLICIES, type BackdatingPolicy } from './schemas';

export const MANAGE_BASE = '/fuel-stations/ops/manage';
const MAX_HOURS = 720;

/** أرقام لاتينية فقط: عربية/فارسية ⇒ 0–9، وفراغ/غير رقمي ⇒ `null` (لا قيمة مخمَّنة). */
export function parseHours(raw: string): number | null {
  const normalised = raw.replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0)).trim();
  if (!/^\d{1,3}$/.test(normalised)) return null;
  const value = Number(normalised);
  return value >= 1 && value <= MAX_HOURS ? value : null;
}

function Editor({ station, effective, reload }: { station: Station; effective: EffectivePolicy; reload: () => void }) {
  const t = useTranslations('stationOps');
  const access = useTanksAccess();
  const [policy, setPolicy] = useState<BackdatingPolicy>(effective.policy);
  const [hoursRaw, setHoursRaw] = useState(String(effective.maxHours));
  const [reasonRequired, setReasonRequired] = useState(effective.reasonRequired);
  const [changeReason, setChangeReason] = useState('');
  const [dialog, setDialog] = useState<'save' | 'clear' | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<AnyFailure | null>(null);
  const [saved, setSaved] = useState<'save' | 'clear' | null>(null);
  const sending = useRef(false);
  const editable = access.editPolicy;

  const hours = parseHours(hoursRaw);
  const dirty = policy !== effective.policy || hours !== effective.maxHours || reasonRequired !== effective.reasonRequired;
  const valid = hours !== null && dirty;
  const hoursError = hoursRaw.trim() !== '' && hours === null ? t('tanks.policy.hoursInvalid', { max: String(MAX_HOURS) }) : null;
  const summary = useMemo(() => (policy === 'deny' ? t('tanks.policy.summaryDeny') : t('tanks.policy.summaryAllow', { hours: String(hours ?? '—'), reason: reasonRequired ? t('tanks.policy.reasonYes') : t('tanks.policy.reasonNo') })), [policy, hours, reasonRequired, t]);

  const submit = async () => {
    if (sending.current || dialog === null) return;
    const mode = dialog;
    if (mode === 'save' && hours === null) return;
    sending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const result = await saveBackdatingPolicy(
        station.id,
        mode === 'clear'
          ? { tank_reading_backdating_policy: null, tank_reading_backdating_max_hours: null, tank_reading_backdating_reason_required: null, reason: changeReason }
          : { tank_reading_backdating_policy: policy, tank_reading_backdating_max_hours: hours, tank_reading_backdating_reason_required: reasonRequired, reason: changeReason },
        station.branch_id,
      );
      if (result.kind === 'ok') { setDialog(null); setChangeReason(''); setSaved(mode); reload(); return; }
      setDialog(null);
      setFailure(asFailure(result));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  return (
    <>
      <p className="text-sm leading-6 text-muted">{t('tanks.policy.intro', { station: station.name })}</p>

      <SectionCard title={t('tanks.policy.title')} id="policy-title">
        <div className="space-y-4" data-policy-editor="">
          <fieldset disabled={!editable || busy} className="space-y-2">
            <legend className="text-sm font-medium text-text">{t('tanks.policy.policyLabel')}</legend>
            {BACKDATING_POLICIES.map((value) => (
              <label key={value} className={cn('flex min-h-14 cursor-pointer items-start gap-3 rounded-[11px] border p-3', policy === value ? 'border-primary bg-primary-soft' : 'border-[color:var(--fo-control)] bg-surface')}>
                <input type="radio" name="backdating-policy" value={value} checked={policy === value} onChange={() => { setPolicy(value); setSaved(null); setFailure(null); }} className="mt-1 h-4 w-4 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold text-text">{t(`tanks.policy.option.${value}`)}</span>
                  <span className="block text-sm leading-5 text-muted">{t(`tanks.policy.optionHint.${value}`)}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <label className="block text-sm font-medium text-text">
            {t('tanks.policy.hoursLabel')}
            <div className="mt-1.5 flex items-center gap-2">
              <input
                type="text"
                inputMode="numeric"
                dir="ltr"
                autoComplete="off"
                value={hoursRaw}
                onChange={(event) => { setHoursRaw(event.target.value); setSaved(null); setFailure(null); }}
                disabled={!editable || busy}
                aria-invalid={hoursError ? true : undefined}
                data-policy-hours=""
                className="num h-14 min-w-0 flex-1 rounded-[11px] border border-[color:var(--fo-control)] bg-surface px-3 text-start text-xl font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
              />
              <span className="shrink-0 text-sm text-muted">{t('tanks.policy.hoursUnit')}</span>
            </div>
            <span className="mt-1 block text-xs leading-5 text-muted">{policy === 'deny' ? t('tanks.policy.hoursIgnored') : t('tanks.policy.hoursHint')}</span>
            {hoursError ? <span role="alert" className="mt-1 block text-sm text-negative">{hoursError}</span> : null}
          </label>

          <SwitchRow id="policy-reason" label={t('tanks.policy.reasonLabel')} checked={reasonRequired} onChange={() => { setReasonRequired((value) => !value); setSaved(null); setFailure(null); }} disabled={!editable || busy} note={t('tanks.policy.reasonHint')} />

          <p className="rounded-[11px] bg-primary-soft px-3 py-2.5 text-sm leading-6 text-text" data-policy-summary="">{summary}</p>

          {editable ? (
            <label className="block text-sm font-medium text-text">
              {t('tanks.policy.changeReason')}
              <textarea value={changeReason} onChange={(event) => setChangeReason(event.target.value.slice(0, 500))} rows={2} maxLength={500} disabled={busy} className="mt-1.5 w-full rounded-[11px] border border-[color:var(--fo-control)] bg-surface px-3 py-2.5 text-base text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" />
            </label>
          ) : (
            <p className="text-sm leading-6 text-muted" data-policy-readonly="">{t('tanks.policy.readonly')}</p>
          )}

          {saved ? (
            <p role="status" data-policy-saved="" className="flex items-center gap-2 rounded-[11px] bg-[color:var(--fo-positive-tint)] px-3 py-2.5 text-sm font-semibold text-positive">
              <CheckCircle2 aria-hidden="true" className="h-5 w-5 shrink-0" strokeWidth={1.9} />{saved === 'clear' ? t('tanks.policy.clearedOk') : t('tanks.policy.savedOk')}
            </p>
          ) : null}
          {failure ? <FailureNotice failure={failure} onCheck={reload} /> : null}

          {editable ? (
            <div className="space-y-2">
              <PrimaryButton onClick={() => { setFailure(null); setDialog('save'); }} disabled={!valid || busy} data-policy-save="">{t('tanks.policy.save')}</PrimaryButton>
              <SecondaryButton onClick={() => { setFailure(null); setDialog('clear'); }} disabled={busy} data-policy-clear="">{t('tanks.policy.clear')}</SecondaryButton>
            </div>
          ) : null}
        </div>
      </SectionCard>

      <p className="text-xs leading-5 text-muted">{t('tanks.policy.safetyNote')}</p>

      <ConfirmDialog open={dialog !== null} title={dialog === 'clear' ? t('tanks.policy.confirmClearTitle') : t('tanks.policy.confirmSaveTitle')} onClose={() => setDialog(null)} busy={busy}>
        <div className="space-y-4" data-policy-dialog={dialog ?? ''}>
          <p className="text-sm leading-6 text-text">{dialog === 'clear' ? t('tanks.policy.confirmClearBody', { station: station.name }) : `${t('tanks.policy.confirmSaveBody', { station: station.name })} ${summary}`}</p>
          <PrimaryButton onClick={submit} disabled={busy} data-policy-confirm="">{busy ? t('tanks.detail.saving') : t('tanks.policy.confirm')}</PrimaryButton>
          <SecondaryButton onClick={() => setDialog(null)} disabled={busy}>{t('tanks.detail.confirmBack')}</SecondaryButton>
        </div>
      </ConfirmDialog>
    </>
  );
}

function Body({ station }: { station: Station }) {
  const policy = useBackdatingPolicy(station);
  const { state } = policy;
  // أثناء إعادة الجلب بعد حفظ نُبقي المحرر (وإشعار «حُفظت السياسة») بآخر قيم معروفة؛ التحميل الأول فقط يُظهر الهيكل.
  const last = useRef<EffectivePolicy | null>(null);
  if (state.status === 'success') last.current = state.data;
  const effective = state.status === 'success' ? state.data : state.status === 'loading' ? last.current : null;
  if (state.status === 'loading' && !effective) return <LoadingBlock rows={3} />;
  if (state.status === 'error') return <ErrorState error={state.error} onRetry={policy.reload} />;
  if (!effective) return <LoadingBlock rows={3} />;
  return <Editor station={station} effective={effective} reload={policy.reload} />;
}

export function PolicyScreen() {
  const t = useTranslations('stationOps');
  return (
    <>
      <PageMasthead title={t('tanks.policy.screenTitle')} subtitle={t('tanks.policy.screenSubtitle')} backHref={MANAGE_BASE} backLabel={t('manage.title')} />
      <ScreenBody>
        <StationGate>{(station) => <Body station={station} />}</StationGate>
      </ScreenBody>
    </>
  );
}
