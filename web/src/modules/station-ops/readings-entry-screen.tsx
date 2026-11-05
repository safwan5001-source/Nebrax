'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { CircleCheck, CircleDashed, Droplets } from 'lucide-react';
import { useStationOps } from './context';
import { useShiftDetail, usePreviousClosing, useStationAssets, useStationPolicy } from './data';
import { clearDraft, draftKey, loadDraft, saveDraft } from './drafts';
import { evaluateMeterRow, evaluateTankRow, meterSaveItem, requiredNozzles, requiredTanks, tankSaveItem, type RowState, type SaveItem } from './entry';
import { formatLitersFixedFromMl } from './format';
import type { ReadingStage } from './intents';
import { PageMasthead, ScreenBody } from './masthead';
import { OPS_BASE } from './nav';
import { Quantity } from './quantity';
import type { ShiftDetail, Station } from './schemas';
import { StationGate } from './station-gate';
import { EmptyState, ErrorState, InlineNote, LoadingBlock } from './state-views';
import { opsWrite, type WriteResult } from './write-client';
import { ActionBar, ConfirmDialog, NumberField, PrimaryButton, SecondaryButton, SectionCard, WriteNotice } from './write-ui';

/**
 * UI-2 — إدخال قراءات العدادات والخزانات (W3 + W4) لمرحلة واحدة (`opening`/`closing`).
 *
 * قائمة ديناميكية من أصول المحطة الفعلية (مضخة ← فوهة ← منتج، وخزانات) — لا أعداد ثابتة. **القراءة لا تُعدَّل بعد حفظها**، لذلك: مراجعة
 * إلزامية قبل الحفظ (قيمة + كمية محسوبة + تنبيهات)، ومفتاح دليل حتمي لكل (وردية، أصل، مرحلة) فتكون إعادة الإرسال آمنة، وحفظ متسلسل
 * بنتيجة لكل صف: ما حُفظ يُقفل، وما فشل يبقى قابلاً للتعديل، وغير المؤكد يُتحقق منه بإعادة القراءة لا بإعادة الإرسال العمياء.
 */

type ItemKey = string;
const meterKey = (id: string): ItemKey => `m:${id}`;
const tankKey = (id: string): ItemKey => `t:${id}`;

type ItemResult = { status: 'saving' | 'saved' | 'rejected' | 'unknown' | 'pending'; result?: WriteResult; ml?: number };

function isStage(value: string): value is ReadingStage {
  return value === 'opening' || value === 'closing';
}

interface Row {
  key: ItemKey;
  kind: 'meter' | 'tank';
  assetId: string;
  title: string;
  subtitle: string | null;
  state: RowState;
  openingMl: number | null;
  closingMl: number | null;
  previous: number | null;
}

function RowView({ row, value, onChange, result, stage, locale, previousShift, openingHref, onEnter, inputRef }: {
  row: Row;
  value: string;
  onChange: (value: string) => void;
  result: ItemResult | undefined;
  stage: ReadingStage;
  locale: string;
  previousShift: string | null;
  openingHref: string;
  onEnter: () => void;
  inputRef: (element: HTMLInputElement | null) => void;
}) {
  const t = useTranslations('stationOps');
  const { state } = row;
  const fmt = (ml: number) => formatLitersFixedFromMl(ml, locale);

  if (state.kind === 'saved' || result?.status === 'saved') {
    const ml = state.kind === 'saved' ? state.ml : result?.ml ?? null;
    return (
      <li data-row-state="saved" className="flex items-center justify-between gap-3 py-3">
        <div className="min-w-0">
          <p className="break-words text-[15px] font-semibold text-text">{row.title}</p>
          {row.subtitle ? <p className="mt-0.5 break-words text-xs text-muted">{row.subtitle}</p> : null}
        </div>
        <div className="shrink-0 text-end">
          <p className="text-base font-bold text-text"><Quantity value={ml === null ? '—' : fmt(ml)} unit={t('unit.liter')} /></p>
          <p className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-positive"><CircleCheck aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />{t('entry.saved')}</p>
        </div>
      </li>
    );
  }

  if (state.kind === 'blocked') {
    return (
      <li data-row-state="blocked" className="py-3">
        <p className="text-[15px] font-semibold text-text">{row.title}</p>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-warning"><CircleDashed aria-hidden="true" className="h-4 w-4" strokeWidth={1.9} />{t('entry.needsOpening')}</p>
        <Link href={openingHref} className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{t('entry.goOpening')}</Link>
      </li>
    );
  }

  const error = state.kind === 'invalid'
    ? state.issue === 'closing_below_opening' ? t('entry.error.closing_below_opening', { opening: row.openingMl === null ? '—' : fmt(row.openingMl) })
      : state.issue === 'opening_above_closing' ? t('entry.error.opening_above_closing', { closing: row.closingMl === null ? '—' : fmt(row.closingMl) })
      : t(`entry.error.${state.issue}`)
    : null;
  const warning = state.kind === 'ready' && state.warnings.length > 0
    ? t(`entry.warning.${state.warnings[0]}`, { value: row.previous === null ? '—' : fmt(row.previous) })
    : null;
  const hint = (
    <span className="block space-y-0.5">
      {row.kind === 'meter' && stage === 'opening' && row.previous !== null ? <span className="block">{t('entry.previous', { value: fmt(row.previous), shift: previousShift ?? '—' })}</span> : null}
      {row.kind === 'meter' && stage === 'closing' && row.openingMl !== null ? <span className="block">{t('entry.openingValue', { value: fmt(row.openingMl) })}</span> : null}
      {state.kind === 'ready' && state.deltaMl !== null ? <span className="block font-semibold text-text">{t('entry.computed', { value: `${fmt(state.deltaMl)} ${t('unit.liter')}` })}</span> : null}
    </span>
  );

  return (
    <li data-row-state={result?.status === 'rejected' || result?.status === 'unknown' ? result.status : state.kind} className="py-3.5">
      <div className="mb-2">
        <p className="text-[15px] font-semibold text-text">{row.title}</p>
        {row.subtitle ? <p className="mt-0.5 text-xs text-muted">{row.subtitle}</p> : null}
      </div>
      <NumberField
        label={t(`entry.fieldLabel.${stage}`)}
        ariaLabel={t(`entry.label.${stage}`, { name: row.title })}
        value={value}
        onChange={onChange}
        suffix={t('unit.liter')}
        hint={hint}
        error={error}
        warning={warning}
        inputRef={inputRef}
        onEnter={onEnter}
        testId={`entry-${row.key}`}
      />
      {result && (result.status === 'rejected' || result.status === 'unknown') && result.result ? <div className="mt-2"><WriteNotice result={result.result} /></div> : null}
    </li>
  );
}

function Content({ station, shiftId, stage }: { station: Station; shiftId: string; stage: ReadingStage }) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  const { scopeKey, can } = useStationOps();
  const query = useShiftDetail(station, shiftId);
  const assets = useStationAssets(station);
  const { policy } = useStationPolicy(station);
  const previous = usePreviousClosing(station, shiftId, stage === 'opening');
  const previousData = previous.status === 'success' ? previous.data : null;

  const storageKey = useMemo(() => draftKey(`${scopeKey}|${station.id}`, shiftId, stage), [scopeKey, station.id, shiftId, stage]);
  const [values, setValues] = useState<Record<ItemKey, string>>(() => loadDraft(storageKey));
  const [results, setResults] = useState<Record<ItemKey, ItemResult>>({});
  const [phase, setPhase] = useState<'edit' | 'review' | 'saving'>('edit');
  const [acked, setAcked] = useState(false);
  const saving = useRef(false);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => { saveDraft(storageKey, values); }, [storageKey, values]);

  const detail: ShiftDetail | null = query.state.status === 'success' ? query.state.data : query.retained?.data ?? null;
  const catalog = assets.catalog;

  const rows = useMemo<{ meters: Row[]; tanks: Row[] }>(() => {
    if (!detail || !catalog) return { meters: [], tanks: [] };
    const meterAt = (nozzleId: string, s: ReadingStage) => detail.meter_readings.find((r) => r.nozzle_id === nozzleId && r.reading_stage === s) ?? null;
    const meters = requiredNozzles(catalog).map<Row>((view) => {
      const id = view.nozzle.id;
      const opening = meterAt(id, 'opening');
      const prev = previousData?.byNozzle[id] ?? null;
      return {
        key: meterKey(id), kind: 'meter', assetId: id,
        title: `${t('products.pump')} ${view.pump?.pump_number ?? '?'} · ${t('products.nozzle')} ${view.nozzle.nozzle_number}`,
        subtitle: [view.product?.name, view.tank?.name].filter(Boolean).join(' · ') || null,
        state: evaluateMeterRow({ stage, raw: values[meterKey(id)] ?? '', saved: meterAt(id, stage), opening, closing: meterAt(id, 'closing'), previousClosingMl: prev, openingRequired: policy.openingMeterRequired }),
        openingMl: opening?.meter_milliliters ?? null,
        closingMl: meterAt(id, 'closing')?.meter_milliliters ?? null,
        previous: prev,
      };
    }).sort((a, b) => a.title.localeCompare(b.title, 'en', { numeric: true }));
    const tankAt = (tankId: string, s: ReadingStage) => detail.tank_readings.find((r) => r.tank_id === tankId && r.reading_stage === s) ?? null;
    const tanks = requiredTanks(catalog).map<Row>((view) => ({
      key: tankKey(view.tank.id), kind: 'tank', assetId: view.tank.id,
      title: view.tank.name, subtitle: view.product?.name ?? null,
      state: evaluateTankRow(values[tankKey(view.tank.id)] ?? '', tankAt(view.tank.id, stage)),
      openingMl: null, closingMl: null, previous: null,
    }));
    return { meters, tanks };
  }, [detail, catalog, previousData, stage, values, t, policy.openingMeterRequired]);

  const all = useMemo(() => [...rows.meters, ...rows.tanks], [rows]);
  const ready = all.filter((row) => row.state.kind === 'ready' && results[row.key]?.status !== 'saved');
  const invalid = all.filter((row) => row.state.kind === 'invalid');
  const recorded = all.filter((row) => row.state.kind === 'saved' || results[row.key]?.status === 'saved').length;
  const warnings = ready.some((row) => row.state.kind === 'ready' && row.state.warnings.length > 0);
  const outstanding = all.filter((row) => row.state.kind !== 'saved' && results[row.key]?.status !== 'saved' && row.state.kind !== 'blocked');
  const tanksRequired = stage === 'opening' ? policy.openingTankRequired : policy.closingTankRequired;
  const metersRequired = stage === 'opening' ? policy.openingMeterRequired : policy.closingMeterRequired;
  const gating = [...(metersRequired ? rows.meters : []), ...(tanksRequired ? rows.tanks : [])];
  const complete = gating.length > 0 && gating.every((row) => row.state.kind === 'saved' || results[row.key]?.status === 'saved');
  const hasAny = all.length > 0;

  const focusNext = useCallback((index: number) => {
    for (let i = index + 1; i < inputs.current.length; i += 1) {
      const el = inputs.current[i];
      if (el && !el.disabled) { el.focus(); return; }
    }
    (document.activeElement as HTMLElement | null)?.blur();
  }, []);

  const buildItems = useCallback((): SaveItem[] => {
    if (!detail) return [];
    // نوع القراءة يرث نوع قراءة المرحلة المقابلة إن وُجدت (في الاتجاهين): الخادم يقبل زوجاً مختلف النوع ثم يرفض إغلاق الوردية.
    const otherStage: ReadingStage = stage === 'opening' ? 'closing' : 'opening';
    const otherTypes = new Map(detail.tank_readings.filter((r) => r.reading_stage === otherStage).map((r) => [r.tank_id, r.reading_type]));
    return ready.flatMap((row) => {
      if (row.state.kind !== 'ready') return [];
      return row.kind === 'meter'
        ? [meterSaveItem(shiftId, stage, row.assetId, row.state.ml)]
        : [tankSaveItem(shiftId, stage, row.assetId, row.state.ml, otherTypes.get(row.assetId) ?? null)];
    });
  }, [detail, ready, shiftId, stage]);

  const save = useCallback(async () => {
    if (saving.current) return;
    saving.current = true;
    setPhase('saving');
    const items = buildItems();
    const keyOf = (item: SaveItem) => (item.kind === 'meter' ? meterKey(item.assetId) : tankKey(item.assetId));
    setResults((prev) => ({ ...prev, ...Object.fromEntries(items.map((item) => [keyOf(item), { status: 'pending' } as ItemResult])) }));
    let stop = false;
    for (const item of items) {
      const key = keyOf(item);
      if (stop) break;
      setResults((prev) => ({ ...prev, [key]: { status: 'saving' } }));
      const result = item.kind === 'meter'
        ? await opsWrite({ action: 'meter_reading', shiftId, body: item.body }, { branchId: station.branch_id })
        : await opsWrite({ action: 'tank_reading', shiftId, body: item.body }, { branchId: station.branch_id });
      if (result.kind === 'ok') {
        setResults((prev) => ({ ...prev, [key]: { status: 'saved', result, ml: item.ml } }));
        setValues((prev) => { const { [key]: _removed, ...rest } = prev; void _removed; return rest; });
      } else if (result.kind === 'rejected') {
        setResults((prev) => ({ ...prev, [key]: { status: 'rejected', result } }));
      } else {
        // غير مؤكد / لم يُرسل: نتوقف (الشبكة غالباً معطّلة) ونترك الباقي «لم تُرسل».
        setResults((prev) => ({ ...prev, [key]: { status: result.kind === 'not_sent' ? 'pending' : 'unknown', result } }));
        stop = true;
      }
    }
    saving.current = false;
    setPhase('edit');
    setAcked(false);
    query.reload();
  }, [buildItems, query, shiftId, station.branch_id]);

  const check = useCallback(() => {
    setResults((prev) => Object.fromEntries(Object.entries(prev).filter(([, value]) => value.status === 'saved')));
    query.reload();
  }, [query]);

  if (!query.allowed) return <div className="pt-5"><EmptyState title={t('shift.noPermission.title')} body={t('shift.noPermission.body')} /></div>;
  if (!can('fuel.shift.open')) return <div className="pt-5"><EmptyState title={t('openShift.noPermission.title')} body={t('openShift.noPermission.body')} /></div>;
  if (!detail) {
    if (query.state.status === 'error') {
      return <div className="pt-5"><ErrorState error={query.state.error} onRetry={query.reload} /></div>;
    }
    return <div className="pt-5"><LoadingBlock rows={3} /></div>;
  }
  if (detail.status !== 'open') {
    return (
      <div className="space-y-4 pt-5">
        <EmptyState title={t('entry.notOpen.title')} body={t('entry.notOpen.body')} />
        <Link href={`${OPS_BASE}/shifts/${encodeURIComponent(shiftId)}`} className="flex min-h-12 items-center justify-center rounded-lg border border-[color:var(--fo-control)] bg-surface px-4 text-base font-medium text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{t('entry.notOpen.back')}</Link>
      </div>
    );
  }
  if (assets.state.status === 'error') return <div className="pt-5"><ErrorState error={assets.state.error} onRetry={assets.reload} /></div>;
  if (assets.state.status === 'loading' || !catalog) return <div className="pt-5"><LoadingBlock rows={3} /></div>;

  const unitTank = (flag: boolean) => (flag ? t('entry.tankRequired') : t('entry.tankOptional'));
  const savedNow = Object.values(results).filter((r) => r.status === 'saved').length;
  // الحالتان اللتان توقفان الدفعة: غير مؤكد (قد يكون حُفظ) و«لم يُرسل» (دون اتصال) — كلتاهما تُعرض صراحةً، لا عودة صامتة للنموذج.
  const unknownResult = Object.values(results).find((r) => r.status === 'unknown' || r.result?.kind === 'not_sent')?.result ?? null;
  let inputIndex = -1;
  const registerInput = (index: number) => (element: HTMLInputElement | null) => { inputs.current[index] = element; };
  const nextHref = stage === 'opening' ? `${OPS_BASE}/shifts/${encodeURIComponent(shiftId)}` : `${OPS_BASE}/shifts/${encodeURIComponent(shiftId)}/handover`;

  const renderRows = (list: Row[]) => (
    <ul className="divide-y divide-border">
      {list.map((row) => {
        const editable = row.state.kind !== 'saved' && row.state.kind !== 'blocked' && results[row.key]?.status !== 'saved';
        const index = editable ? (inputIndex += 1) : -1;
        return (
          <RowView
            key={row.key}
            row={row}
            value={values[row.key] ?? ''}
            onChange={(value) => { setValues((prev) => ({ ...prev, [row.key]: value })); setResults((prev) => { if (!prev[row.key]) return prev; const { [row.key]: _gone, ...rest } = prev; void _gone; return rest; }); }}
            result={results[row.key]}
            stage={stage}
            locale={locale}
            previousShift={previousData?.shiftNumber ?? null}
            openingHref={`${OPS_BASE}/shifts/${encodeURIComponent(shiftId)}/readings/opening`}
            onEnter={() => focusNext(index)}
            inputRef={editable ? registerInput(index) : () => undefined}
          />
        );
      })}
    </ul>
  );

  return (
    <div className="space-y-4 pt-5" data-entry-stage={stage}>
      {complete ? (
        <SectionCard>
          <div className="flex items-start gap-3" data-entry-complete="">
            <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[color:var(--fo-positive-tint)] text-positive"><CircleCheck className="h-6 w-6" strokeWidth={1.9} /></span>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-text">{t(`entry.done.title.${stage}`)}</h2>
              <p className="mt-1 text-sm text-muted tabular-nums">{t('entry.progress', { done: String(recorded), total: String(all.length) })}</p>
            </div>
          </div>
          <Link href={nextHref} data-primary-action="" className="mt-4 flex min-h-14 w-full items-center justify-center rounded-[13px] bg-[color:var(--fo-cta-bg)] px-4 text-[15px] font-bold text-[color:var(--fo-cta-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background">
            {t(`entry.done.next.${stage}`)}
          </Link>
        </SectionCard>
      ) : null}

      {hasAny ? <p className="text-sm text-muted tabular-nums" role="status">{t('entry.progress', { done: String(recorded), total: String(all.length) })}</p> : null}
      <WriteNotice result={unknownResult} onCheck={check} />

      {rows.meters.length > 0 ? (
        <SectionCard title={t('entry.meters')} id="entry-meters-h">{renderRows(rows.meters)}</SectionCard>
      ) : (
        <EmptyState title={t('shiftDetail.readings.empty.title')} body={t('shiftDetail.readings.empty.body')} />
      )}
      {rows.tanks.length > 0 ? (
        <SectionCard title={t('entry.tanks')} id="entry-tanks-h">
          <p className="-mt-1 mb-1 text-xs text-muted">{t('entry.tankHint')} · <span className="font-semibold">{unitTank(tanksRequired)}</span></p>
          {renderRows(rows.tanks)}
        </SectionCard>
      ) : null}

      <InlineNote>{t('entry.draftNote')}</InlineNote>

      {!complete || ready.length > 0 || invalid.length > 0 ? (
        <ActionBar>
          <div className="mx-auto max-w-3xl space-y-2">
            <p role="status" className="text-xs text-muted tabular-nums">
              {invalid.length > 0 ? t('entry.footer.invalid', { count: String(invalid.length) }) : ready.length > 0 ? t('entry.footer.ready', { count: String(ready.length) }) : t('entry.footer.nothing')}
              {savedNow > 0 ? ` · ${t('entry.result.summary', { saved: String(savedNow), total: String(savedNow + outstanding.length) })}` : ''}
            </p>
            <PrimaryButton disabled={ready.length === 0 || invalid.length > 0 || phase === 'saving'} onClick={() => { setAcked(false); setPhase('review'); }}>
              <Droplets aria-hidden="true" className="h-5 w-5" strokeWidth={1.9} />
              {t('entry.footer.review', { count: String(ready.length) })}
            </PrimaryButton>
          </div>
        </ActionBar>
      ) : null}

      <ConfirmDialog open={phase === 'review' || phase === 'saving'} title={t('entry.review.title')} onClose={() => setPhase('edit')} busy={phase === 'saving'}>
        <div className="space-y-4">
          <p className="text-sm leading-6 text-muted">{t('entry.review.intro')}</p>
          <ul className="divide-y divide-border rounded-[12px] border border-border px-3" data-review-list="">
            {ready.map((row) => {
              const state = row.state;
              if (state.kind !== 'ready') return null;
              const result = results[row.key];
              return (
                <li key={row.key} className="py-2.5 text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 break-words font-medium text-text">{row.title}</span>
                    <span className="shrink-0 text-base font-bold text-text"><Quantity value={formatLitersFixedFromMl(state.ml, locale)} unit={t('unit.liter')} /></span>
                  </div>
                  {state.deltaMl !== null ? <p className="mt-0.5 text-xs text-muted">{t('entry.computed', { value: `${formatLitersFixedFromMl(state.deltaMl, locale)} ${t('unit.liter')}` })}</p> : null}
                  {state.warnings.map((w) => <p key={w} className="mt-1 text-xs text-warning">{t(`entry.warning.${w}`, { value: row.previous === null ? '—' : formatLitersFixedFromMl(row.previous, locale) })}</p>)}
                  {result && result.status !== 'pending' ? <p className="mt-1 text-xs font-semibold text-muted">{t(`entry.result.${result.status === 'rejected' ? 'failed' : result.status}`)}</p> : null}
                </li>
              );
            })}
          </ul>
          {warnings ? (
            <label className="flex min-h-11 items-start gap-3 text-sm text-text">
              <input type="checkbox" checked={acked} onChange={(event) => setAcked(event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-[color:var(--primary)]" data-review-ack="" />
              <span>{t('entry.review.ack')}</span>
            </label>
          ) : null}
          <PrimaryButton disabled={phase === 'saving' || (warnings && !acked)} onClick={() => void save()} data-confirm-save="">{phase === 'saving' ? t('entry.review.saving') : t('entry.review.confirm')}</PrimaryButton>
          <SecondaryButton disabled={phase === 'saving'} onClick={() => setPhase('edit')}>{t('entry.review.back')}</SecondaryButton>
        </div>
      </ConfirmDialog>
    </div>
  );
}

export function ReadingsEntryScreen({ shiftId, stage }: { shiftId: string; stage: string }) {
  const t = useTranslations('stationOps');
  if (!isStage(stage)) {
    return (
      <>
        <PageMasthead title={t('shiftDetail.notFound.title')} backHref={`${OPS_BASE}/shifts`} />
        <ScreenBody flush><div className="pt-5"><EmptyState title={t('shiftDetail.notFound.title')} body={t('shiftDetail.notFound.body')} /></div></ScreenBody>
      </>
    );
  }
  return (
    <>
      <PageMasthead title={t(`entry.title.${stage}`)} subtitle={t(`entry.subtitle.${stage}`)} backHref={`${OPS_BASE}/shifts/${encodeURIComponent(shiftId)}`} backLabel={t('shiftDetail.back')} />
      <ScreenBody flush>
        <StationGate gateClassName="pt-5">{(station) => <Content station={station} shiftId={shiftId} stage={stage} />}</StationGate>
      </ScreenBody>
    </>
  );
}
