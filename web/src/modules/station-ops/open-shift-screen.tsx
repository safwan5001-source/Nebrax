'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CircleCheck, Info } from 'lucide-react';
import { SAUDI_RIYAL_SYMBOL, formatMinorRiyal } from '@/lib/money';
import { parseMoney } from './cash';
import { useStationOps } from './context';
import { useCurrentShift, useStationPolicy } from './data';
import { createIntentStore } from './intents';
import { PageMasthead, ScreenBody } from './masthead';
import { OPS_BASE } from './nav';
import type { Shift, ShiftDetail, Station } from './schemas';
import { StationGate } from './station-gate';
import { EmptyState, ErrorState, InlineNote, LoadingBlock } from './state-views';
import { opsWrite, type WriteResult } from './write-client';
import { settledWithoutEffect } from './write-outcome';
import { ConfirmDialog, NumberField, PrimaryButton, SecondaryButton, SectionCard, WriteNotice } from './write-ui';

/**
 * UI-2 — «فتح وردية» (W1 + W2). داخل التطبيق فقط.
 *
 * - عهدة الافتتاح **بلا قيمة مسبقة**: الخادم يطلبها صراحةً (ولو صفراً) افتراضياً، و«لا يوجد نقد (0)» اختيار صريح بزر مستقل.
 * - تأكيد صريح قبل الإرسال؛ مفتاح idempotency ثابت لكل نية (محفوظ لحين حسم الناتج) لأن الخادم يعيد **الأثر الأول** لأي مفتاح موجود،
 *   فلا يُعاد استعماله لحمولة مختلفة. الردّ يُتحقق منه (مفتوحة؟ محطتنا؟ العهدة المرسلة؟) قبل إعلان النجاح.
 * - الفتح والإسناد عمليتان منفصلتان في الخادم: الإسناد خطوة ثانية بحالة مستقلة وإعادة محاولة (التكرار «مسند بالفعل» يُعدّ نجاحاً).
 */

type Phase =
  | { name: 'form' }
  | { name: 'confirm' }
  | { name: 'sending' }
  | { name: 'opened'; shift: ShiftDetail; staff: 'assigning' | 'done' | 'failed'; staffResult: WriteResult | null };

function verifiedOpen(result: WriteResult, station: Station, floatMinor: number | null): ShiftDetail | null {
  if (result.kind !== 'ok') return null;
  const shift = result.shift;
  if (shift.status !== 'open' || shift.station_id !== station.id) return null;
  if (floatMinor !== null && shift.opening_float_minor !== floatMinor) return null;
  return shift;
}

function Form({ station }: { station: Station }) {
  const t = useTranslations('stationOps');
  const { viewer, scopeKey, can } = useStationOps();
  const current = useCurrentShift(station);
  const { policy, loading: policyLoading } = useStationPolicy(station);
  const intents = useMemo(() => createIntentStore(`${scopeKey}|${station.id}`), [scopeKey, station.id]);
  const submitting = useRef(false);

  const [raw, setRaw] = useState('');
  const [phase, setPhase] = useState<Phase>({ name: 'form' });
  const [failure, setFailure] = useState<WriteResult | null>(null);
  const [checking, setChecking] = useState(false);

  const parsed = raw.trim() === '' ? null : parseMoney(raw);
  const floatMinor = parsed && parsed.ok ? parsed.minor : null;
  const floatError = parsed && !parsed.ok ? t('openShift.floatInvalid') : null;
  const floatMissing = policy.openingFloatRequired && floatMinor === null;
  const formValid = !floatError && !floatMissing && station.status === 'active';

  const assign = useCallback(async (shift: ShiftDetail) => {
    setPhase({ name: 'opened', shift, staff: 'assigning', staffResult: null });
    const result = await opsWrite({ action: 'assign_staff', shiftId: shift.id, body: { user_id: viewer.id, role: 'attendant' } }, { branchId: station.branch_id });
    // «مسند بالفعل» = الحالة المرغوبة نفسها.
    const done = result.kind === 'ok' || (result.kind === 'rejected' && result.code === 'staff_already_assigned');
    setPhase({ name: 'opened', shift, staff: done ? 'done' : 'failed', staffResult: done ? null : result });
  }, [station.branch_id, viewer.id]);

  const submit = useCallback(async () => {
    if (submitting.current || !formValid) return;
    submitting.current = true;
    setFailure(null);
    setPhase({ name: 'sending' });
    try {
      const key = intents.keyFor('open', { station: station.id, float: floatMinor });
      const result = await opsWrite(
        { action: 'open', body: { fuel_station_id: station.id, idempotency_key: key, ...(floatMinor !== null ? { opening_float_minor: floatMinor } : {}) } },
        { branchId: station.branch_id },
      );
      const shift = verifiedOpen(result, station, floatMinor);
      if (shift) {
        intents.clear('open');
        void assign(shift);
        return;
      }
      if (settledWithoutEffect(result)) intents.clear('open');
      // ردّ 2xx لا يطابق ما أرسلناه (أو غير مفهوم) ⇒ «غير مؤكد» ولا نعلن نجاحاً؛ المفتاح يبقى لإعادة آمنة.
      setFailure(result.kind === 'ok' ? { kind: 'unverified' } : result);
      setPhase({ name: 'form' });
    } finally {
      submitting.current = false;
    }
  }, [assign, floatMinor, formValid, intents, station]);

  const check = useCallback(() => {
    setChecking(true);
    current.reload();
    window.setTimeout(() => setChecking(false), 600);
  }, [current]);

  if (phase.name === 'opened') {
    const { shift, staff, staffResult } = phase;
    return (
      <div className="space-y-4 pt-5" data-open-success="">
        <SectionCard>
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[color:var(--fo-positive-tint)] text-positive"><CircleCheck className="h-6 w-6" strokeWidth={1.9} /></span>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-text">{t('openShift.success', { number: shift.number })}</h2>
              <p className="mt-1 text-sm leading-6 text-muted">{t('openShift.successBody')}</p>
            </div>
          </div>
          <p role="status" className={`mt-3 text-sm ${staff === 'failed' ? 'text-warning' : 'text-muted'}`}>
            {staff === 'assigning' ? t('openShift.staff.assigning') : staff === 'done' ? t('openShift.staff.done') : t('openShift.staff.failed')}
          </p>
        </SectionCard>
        {staff === 'failed' ? (
          <>
            <WriteNotice result={staffResult} />
            <SecondaryButton onClick={() => void assign(shift)}>{t('openShift.staff.retry')}</SecondaryButton>
          </>
        ) : null}
        <Link
          href={`${OPS_BASE}/shifts/${encodeURIComponent(shift.id)}/readings/opening`}
          data-primary-action=""
          className="flex min-h-14 w-full items-center justify-center rounded-[13px] bg-[color:var(--fo-cta-bg)] px-4 text-[15px] font-bold text-[color:var(--fo-cta-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {t('openShift.goReadings')}
        </Link>
      </div>
    );
  }

  if (!can('fuel.shift.open')) {
    return <div className="pt-5"><EmptyState title={t('openShift.noPermission.title')} body={t('openShift.noPermission.body')} /></div>;
  }
  if (current.state.status === 'loading') return <div className="pt-5"><LoadingBlock rows={2} /></div>;
  if (current.state.status === 'error') return <div className="pt-5"><ErrorState error={current.state.error} onRetry={current.reload} /></div>;
  const existing: Shift | null = current.state.data.shift;
  if (existing && phase.name !== 'sending') {
    return (
      <div className="space-y-4 pt-5" data-open-existing="">
        <EmptyState title={t('openShift.alreadyOpen.title')} body={t('openShift.alreadyOpen.body', { number: existing.number })} />
        <Link
          href={`${OPS_BASE}/shifts/${encodeURIComponent(existing.id)}`}
          data-primary-action=""
          className="flex min-h-14 w-full items-center justify-center rounded-[13px] bg-[color:var(--fo-cta-bg)] px-4 text-[15px] font-bold text-[color:var(--fo-cta-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {t('openShift.alreadyOpen.cta')}
        </Link>
      </div>
    );
  }
  if (station.status !== 'active') return <div className="pt-5"><EmptyState title={t('openShift.stationInactive')} /></div>;

  const sending = phase.name === 'sending';
  return (
    <div className="space-y-4 pt-5">
      <SectionCard>
        <dl className="space-y-3 text-sm">
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted">{t('openShift.station')}</dt><dd className="min-w-0 break-words text-end text-base font-semibold text-text">{station.name}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted">{t('openShift.responsible')}</dt><dd className="min-w-0 break-words text-end text-base font-semibold text-text">{t('openShift.you', { name: viewer.name })}</dd></div>
        </dl>
      </SectionCard>

      <SectionCard>
        <NumberField
          label={t('openShift.floatLabel')}
          value={raw}
          onChange={(value) => { setRaw(value); setFailure(null); }}
          suffix={SAUDI_RIYAL_SYMBOL}
          hint={policy.openingFloatRequired ? t('openShift.floatRequired') : t('openShift.floatOptional')}
          error={floatError}
          disabled={sending}
          testId="open-float"
          onEnter={() => { if (formValid) setPhase({ name: 'confirm' }); }}
        />
        <button
          type="button"
          onClick={() => setRaw('0')}
          disabled={sending}
          className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-[color:var(--fo-control)] bg-surface px-4 text-sm font-medium text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
        >
          {t('openShift.floatZero')}
        </button>
        <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted"><Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.7} />{t('openShift.floatHint')}</p>
        {!policy.known && !policyLoading ? <div className="mt-2"><InlineNote tone="warning">{t('openShift.policyUnknown')}</InlineNote></div> : null}
      </SectionCard>

      <WriteNotice result={failure} onCheck={check} checking={checking} />

      <PrimaryButton disabled={!formValid || sending} onClick={() => setPhase({ name: 'confirm' })}>{t('openShift.review')}</PrimaryButton>

      <ConfirmDialog open={phase.name === 'confirm' || sending} title={t('openShift.confirmTitle')} onClose={() => setPhase({ name: 'form' })} busy={sending}>
        <div className="space-y-4">
          <p className="text-sm text-muted">{t('openShift.confirmBody')}</p>
          <dl className="space-y-2 rounded-[12px] border border-border p-3 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-muted">{t('openShift.station')}</dt><dd className="min-w-0 break-words text-end font-semibold text-text">{station.name}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">{t('openShift.responsible')}</dt><dd className="min-w-0 break-words text-end font-semibold text-text">{viewer.name}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">{t('openShift.floatLabel')}</dt><dd className="num font-semibold text-text">{floatMinor === null ? '—' : formatMinorRiyal(floatMinor)}</dd></div>
          </dl>
          <p className="text-xs leading-5 text-muted">{t('openShift.confirmNote')}</p>
          <PrimaryButton disabled={sending} onClick={() => void submit()} data-confirm-open="">{sending ? t('openShift.sending') : t('openShift.confirm')}</PrimaryButton>
          <SecondaryButton disabled={sending} onClick={() => setPhase({ name: 'form' })}>{t('openShift.back')}</SecondaryButton>
        </div>
      </ConfirmDialog>
    </div>
  );
}

export function OpenShiftScreen() {
  const t = useTranslations('stationOps');
  return (
    <>
      <PageMasthead title={t('openShift.title')} subtitle={t('openShift.subtitle')} />
      <ScreenBody flush>
        <StationGate gateClassName="pt-5">{(station) => <Form key={station.id} station={station} />}</StationGate>
      </ScreenBody>
    </>
  );
}
