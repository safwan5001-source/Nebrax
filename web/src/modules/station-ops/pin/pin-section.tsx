'use client';

import { useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Copy, KeyRound } from 'lucide-react';
import { isStationSession } from '@/lib/auth';
import { formatDateTime } from '@/lib/formatting';
import { sanitizePin } from '../login/login-logic';
import { Badge } from '../admin/ui';
import type { StaffView } from '../admin/schemas';
import { ConfirmDialog, PrimaryButton, SecondaryButton } from '../write-ui';
import { clearStationPin, setStationPin, type PinResult } from './pin-client';

type Mode = 'generate' | 'manual';
type View = { kind: 'form' } | { kind: 'result'; generatedPin: string | null };

function failureKey(result: PinResult): string | null {
  switch (result.kind) {
    case 'ok': return null;
    case 'rejected': return `pin.error.${result.code}`;
    case 'unknown': return 'pin.error.unknown';
    case 'not_sent': return result.reason === 'offline' ? 'pin.error.offline' : 'pin.error.demo';
  }
}

/**
 * قسم «رمز الدخول إلى تطبيق المحطات» في محرر الموظف: الحالة + تعيين/تغيير (توليد عشوائي أو يدوي) + إزالة.
 * الرمز المولَّد يُعرض مرة واحدة في هذا الحوار فقط ويُمسح من الذاكرة عند الإغلاق؛ لا تخزين ولا سجل.
 * الخادم السلطة: لا نفسه ولا المالك ولا موظف غير نشط/غير مرتبط، ولا من جلسة PIN (لذلك يُخفى القسم عنها).
 */
export function StationPinSection({ staff, isSelf }: { staff: StaffView; isSelf: boolean }) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  const [pinState, setPinState] = useState(staff.station_pin ?? null);
  const [dialog, setDialog] = useState<'set' | 'clear' | null>(null);
  const [mode, setMode] = useState<Mode>('generate');
  const [manual, setManual] = useState('');
  const [reason, setReason] = useState('');
  const [view, setView] = useState<View>({ kind: 'form' });
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const inFlight = useRef(false);

  if (staff.station_pin === undefined || isStationSession()) return null; // خادم أقدم، أو جلسة PIN (الخادم يرفض أصلاً)
  const locked = isSelf || !staff.user.is_active || !staff.user.employee_no;

  function close() {
    setDialog(null);
    setView({ kind: 'form' });
    setManual('');
    setReason('');
    setMode('generate');
    setErrorKey(null);
    setCopied(false);
  }

  async function run(action: () => Promise<PinResult>, after: (result: Extract<PinResult, { kind: 'ok' }>) => void) {
    if (inFlight.current) return; // قفل إرسال مكرر
    inFlight.current = true;
    setBusy(true);
    setErrorKey(null);
    try {
      const result = await action();
      if (result.kind === 'ok') {
        setPinState(result.staff.station_pin ?? null);
        after(result);
      } else {
        setErrorKey(failureKey(result));
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const manualValid = mode === 'generate' || manual.length === 6;
  const confirmSet = () => run(
    () => setStationPin(staff.user.id, { pin: mode === 'manual' ? manual : undefined, reason }),
    (result) => { setManual(''); setView({ kind: 'result', generatedPin: result.generatedPin }); },
  );
  const confirmClear = () => run(() => clearStationPin(staff.user.id, { reason }), () => close());

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false); // الحافظة غير متاحة: الرمز ظاهر ويُنسخ يدوياً
    }
  }

  const has = pinState?.has_pin === true;
  const field = 'mt-1.5 w-full rounded-[11px] border border-[color:var(--fo-control)] bg-surface px-3 text-base text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

  return (
    <section aria-labelledby="mg-pin-h" data-testid="station-pin-section" className="rounded-[14px] border border-border bg-surface p-4">
      <h2 id="mg-pin-h" className="flex items-center gap-2 text-base font-semibold text-text"><KeyRound aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} />{t('pin.title')}</h2>
      <p className="mt-1 text-sm leading-6 text-muted">{t('pin.hint')}</p>

      <dl className="mt-3 space-y-2 text-sm">
        <div className="flex items-center justify-between gap-3"><dt className="text-muted">{t('pin.employeeNo')}</dt><dd dir="ltr" className="num text-text">{staff.user.employee_no ?? t('pin.noEmployeeNo')}</dd></div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted">{t('manage.audit.key.station_pin')}</dt>
          <dd><Badge tone={has ? 'positive' : 'neutral'}>{has ? t('pin.status.set') : t('pin.status.unset')}</Badge></dd>
        </div>
      </dl>
      {has && pinState?.set_at ? <p className="mt-2 text-xs text-muted">{t('pin.lastSet', { date: formatDateTime(pinState.set_at, locale) })}</p> : null}

      {locked ? <p role="status" className="mt-3 text-xs leading-5 text-warning">{isSelf ? t('manage.editor.selfLocked') : t('pin.notEligible')}</p> : null}

      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <PrimaryButton disabled={locked} onClick={() => { setErrorKey(null); setDialog('set'); }}>{has ? t('pin.changeAction') : t('pin.setAction')}</PrimaryButton>
        <SecondaryButton disabled={locked || !has} onClick={() => { setErrorKey(null); setDialog('clear'); }}>{t('pin.clearAction')}</SecondaryButton>
      </div>

      <ConfirmDialog open={dialog === 'set'} title={view.kind === 'result' ? t('pin.resultTitle') : t('pin.dialogTitle')} onClose={close} busy={busy}>
        {view.kind === 'result' ? (
          <div className="space-y-4">
            {view.generatedPin ? (
              <>
                <p className="text-sm leading-6 text-muted">{t('pin.resultOnce')}</p>
                <p dir="ltr" data-testid="generated-pin" className="num rounded-[13px] border border-border bg-background py-4 text-center text-3xl font-bold tracking-[0.4em] text-text">{view.generatedPin}</p>
                <SecondaryButton onClick={() => void copy(view.generatedPin as string)}>
                  {copied ? <Check aria-hidden="true" className="h-5 w-5" strokeWidth={2} /> : <Copy aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} />}
                  {copied ? t('pin.copied') : t('pin.copy')}
                </SecondaryButton>
              </>
            ) : <p className="text-sm leading-6 text-muted">{t('pin.resultManual')}</p>}
            <PrimaryButton onClick={close}>{t('pin.done')}</PrimaryButton>
          </div>
        ) : (
          <div className="space-y-4">
            <fieldset disabled={busy}>
              <legend className="sr-only">{t('pin.dialogTitle')}</legend>
              <div role="radiogroup" className="grid gap-2">
                {(['generate', 'manual'] as const).map((value) => (
                  <label key={value} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-[13px] border p-3 text-sm ${mode === value ? 'border-primary bg-primary-soft' : 'border-[color:var(--fo-control)] bg-surface'}`}>
                    <input type="radio" name="pin-mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="h-4 w-4" />
                    <span className="text-text">{t(value === 'generate' ? 'pin.modeGenerate' : 'pin.modeManual')}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {mode === 'manual' ? (
              <div>
                <label htmlFor="pin-manual" className="block text-sm font-medium text-text">{t('pin.manualLabel')}</label>
                <input id="pin-manual" dir="ltr" inputMode="numeric" pattern="[0-9]*" autoComplete="off" spellCheck={false} maxLength={12} value={manual} disabled={busy}
                  onChange={(event) => setManual(sanitizePin(event.target.value))} className={`${field} num h-12 text-center text-xl tracking-[0.4em]`} />
                <p className="mt-1 text-xs text-muted">{t('pin.manualHint')}</p>
              </div>
            ) : null}
            <div>
              <label htmlFor="pin-reason" className="block text-sm font-medium text-text">{t('pin.reasonLabel')}</label>
              <input id="pin-reason" maxLength={500} value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} className={`${field} h-12`} />
            </div>
            <p className="text-xs leading-5 text-muted">{t('pin.willRevoke')}</p>
            {errorKey ? <p role="alert" className="rounded-[12px] bg-[color:var(--fo-negative-tint)] p-3 text-sm leading-6 text-negative">{t(errorKey)}</p> : null}
            <div className="grid grid-cols-2 gap-2.5">
              <SecondaryButton onClick={close} disabled={busy}>{t('pin.cancel')}</SecondaryButton>
              <PrimaryButton onClick={() => void confirmSet()} disabled={busy || !manualValid} aria-busy={busy}>{busy ? t('pin.saving') : t('pin.confirm')}</PrimaryButton>
            </div>
          </div>
        )}
      </ConfirmDialog>

      <ConfirmDialog open={dialog === 'clear'} title={t('pin.clearTitle')} onClose={close} busy={busy}>
        <div className="space-y-4">
          <p className="text-sm leading-6 text-muted">{t('pin.clearBody')}</p>
          <div>
            <label htmlFor="pin-clear-reason" className="block text-sm font-medium text-text">{t('pin.reasonLabel')}</label>
            <input id="pin-clear-reason" maxLength={500} value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} className={`${field} h-12`} />
          </div>
          {errorKey ? <p role="alert" className="rounded-[12px] bg-[color:var(--fo-negative-tint)] p-3 text-sm leading-6 text-negative">{t(errorKey)}</p> : null}
          <div className="grid grid-cols-2 gap-2.5">
            <SecondaryButton onClick={close} disabled={busy}>{t('pin.cancel')}</SecondaryButton>
            <PrimaryButton onClick={() => void confirmClear()} disabled={busy} aria-busy={busy}>{busy ? t('pin.saving') : t('pin.clearConfirm')}</PrimaryButton>
          </div>
        </div>
      </ConfirmDialog>
    </section>
  );
}
