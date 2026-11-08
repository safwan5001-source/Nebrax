'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fetchCatalog, fetchReport, type ReportFilters } from './client';
import { summaryText, type Lang } from './format';
import { presetRange, rangeError, type PresetId } from './filters';
import { ReportActions } from './report-actions';
import { MiniBars, ReportTable } from './report-table';
import type { ReportDefinition, ReportPayload } from './schemas';
import { nozzleLabel, productLabel, pumpLabel, shiftLabel, stationLabel, useOptions } from './use-options';

/**
 * عارض تقرير وقود واحد (مشترك بين تطبيق المحطة ووحدة أَوْج): مرشحات حسب تعريف التقرير، بطاقات مؤشرات، رسم بسيط، جداول، وأزرار الطباعة والتصدير.
 * كل رقم من حمولة الخادم؛ لا حساب مالي هنا. حالات: تحميل · خطأ (إعادة محاولة) · غير مصرّح · فارغ · بيانات غير مكتملة · مقتطع.
 */
const PRESETS: PresetId[] = ['today', 'yesterday', 'last7', 'month', 'lastMonth'];
const SHIFT_STATUSES = ['open', 'closed', 'approved'];
const CORRECTION_STATUSES = ['requested', 'approved', 'rejected'];
/** تقارير المخزون المبنية على سجلات بحالتَي مسودة/معتمد (استلامات، جرد، فروقات، تتبع) لا على حالات الورديات. */
const DRAFT_APPROVED_REPORTS = ['inventory.receipts', 'inventory.supply_tracking', 'inventory.stocktake', 'inventory.variances'];
const DRAFT_APPROVED = ['draft', 'approved'];
const FIELD = 'mt-1.5 h-12 w-full rounded-[11px] border border-[color:var(--fo-control,var(--border))] bg-surface px-3 text-base text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

type State = { status: 'idle' } | { status: 'loading' } | { status: 'error'; code: number | 'contract' | 'network' } | { status: 'ready'; payload: ReportPayload };

export function ReportViewer({ reportKey, defaultStationId }: { reportKey: string; defaultStationId?: string }) {
  const t = useTranslations('fuelReports');
  const locale = useLocale();
  const lang: Lang = locale.startsWith('en') ? 'en' : 'ar';
  const [definition, setDefinition] = useState<ReportDefinition | null>(null);
  const [defError, setDefError] = useState<number | 'contract' | 'network' | null>(null);
  // تطبيق المحطة يبدأ بمحطته المختارة؛ أَوْج بلا افتراض (كل المحطات المتاحة للمستخدم).
  const initial: ReportFilters = defaultStationId ? { station_id: defaultStationId } : {};
  const [draft, setDraft] = useState<ReportFilters>(initial);
  const [applied, setApplied] = useState<ReportFilters>(initial);
  const [state, setState] = useState<State>({ status: 'idle' });
  const [tick, setTick] = useState(0);
  const request = useRef(0);

  // تعريف التقرير (مرشحاته) من الكتالوج المفوَّض للمستخدم؛ غياب التقرير = غير متاح.
  useEffect(() => {
    let cancelled = false;
    fetchCatalog()
      .then((catalog) => {
        if (cancelled) return;
        const found = catalog.reports.find((r) => r.key === reportKey) ?? null;
        setDefinition(found);
        setDefError(found ? null : 404);
      })
      .catch((error: unknown) => { if (!cancelled) setDefError(errorCode(error)); });
    return () => { cancelled = true; };
  }, [reportKey]);

  const has = (name: string) => definition?.filters.includes(name) ?? false;
  const needsShift = definition?.filters.includes('shift_id') === true && reportKey === 'shifts.detail';

  const stations = useOptions(definition ? '/fuel-stations/stations' : null, stationLabel);
  const products = useOptions(has('product_id') ? '/fuel-stations/products' : null, productLabel);
  const pumps = useOptions(has('pump_id') ? '/fuel-stations/pumps' : null, pumpLabel);
  const nozzles = useOptions(has('nozzle_id') ? '/fuel-stations/nozzles' : null, nozzleLabel);
  const shiftPath = has('shift_id') ? `/fuel-stations/shifts${draft.station_id ? `?station_id=${encodeURIComponent(draft.station_id)}` : ''}` : null;
  const shifts = useOptions(shiftPath, shiftLabel);

  const load = useCallback(() => {
    if (!definition) return;
    if (needsShift && !applied.shift_id) { setState({ status: 'idle' }); return; }
    const id = ++request.current;
    setState({ status: 'loading' });
    fetchReport(reportKey, applied)
      .then((payload) => { if (id === request.current) setState({ status: 'ready', payload }); })
      .catch((error: unknown) => { if (id === request.current) setState({ status: 'error', code: errorCode(error) }); });
  }, [definition, needsShift, applied, reportKey]);

  useEffect(() => { load(); }, [load, tick]);

  // عند وصول أول حمولة تُعرض الفترة الافتراضية في الحقول (دون إعادة طلب).
  useEffect(() => {
    if (state.status === 'ready' && state.payload.period && !draft.from && !draft.to) {
      setDraft((d) => ({ ...d, from: state.payload.period?.from, to: state.payload.period?.to }));
    }
  }, [state, draft.from, draft.to]);

  const timezone = state.status === 'ready' ? state.payload.timezone : 'Asia/Riyadh';
  const localError = rangeError(draft);
  const set = (key: string, value: string) => setDraft((d) => ({ ...d, [key]: value }));
  const apply = () => { if (!localError) { setApplied({ ...draft }); setTick((n) => n + 1); } };
  const reset = () => { setDraft(initial); setApplied(initial); setTick((n) => n + 1); };
  const preset = (id: PresetId) => { const range = presetRange(id, timezone); setDraft((d) => ({ ...d, ...range })); };
  const statuses = reportKey === 'shifts.corrections' ? CORRECTION_STATUSES : DRAFT_APPROVED_REPORTS.includes(reportKey) ? DRAFT_APPROVED : SHIFT_STATUSES;
  const showPeriod = definition ? (has('from') || has('to')) : false;

  const chart = useMemo(() => state.status === 'ready' && ['sales.daily', 'sales.period', 'sales.by_product', 'sales.by_station', 'sales.by_pump'].includes(reportKey), [state, reportKey]);

  if (defError !== null) return <Problem code={defError} t={t} />;
  if (!definition) return <p className="py-10 text-center text-sm text-muted" role="status"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" aria-hidden="true" />{t('loading')}</p>;

  const select = (id: string, label: string, value: string | undefined, onChange: (v: string) => void, options: Array<{ id: string; label: string }>, any: string) => (
    <label className="block text-sm font-medium text-text" key={id}>{label}
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={FIELD} data-filter={id}>
        <option value="">{any}</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </label>
  );
  const fixed = (id: string, label: string, values: string[], keyOf: (v: string) => string, any?: string) => select(id, label, draft[id], (v) => set(id, v), values.map((v) => ({ id: v, label: t(keyOf(v)) })), any ?? t('all'));

  return (
    <div className="space-y-5" data-report-viewer={reportKey}>
      <div>
        <h2 className="text-lg font-semibold text-text">{definition.title[lang]}</h2>
        <p className="mt-1 text-sm leading-6 text-muted">{definition.description[lang]}</p>
        <p className="mt-1 text-xs text-muted" data-report-source={definition.source}>{t(`source_${definition.source}`)}</p>
      </div>

      <details open className="rounded-[12px] border border-border bg-surface p-3" data-report-filters="">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-text">{t('filters')}</summary>
        <div className="mt-2 space-y-3">
          {showPeriod ? (
            <>
              <div className="flex flex-wrap gap-2" role="group" aria-label={t('presets')}>
                {PRESETS.map((id) => (
                  <button key={id} type="button" onClick={() => preset(id)} className="min-h-10 rounded-full border border-[color:var(--fo-control,var(--border))] px-3 text-xs font-medium text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{t(`preset_${id}`)}</button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <label className="block text-sm font-medium text-text">{t('from')}<input type="date" dir="ltr" value={draft.from ?? ''} onChange={(e) => set('from', e.target.value)} className={FIELD} data-filter="from" /></label>
                <label className="block text-sm font-medium text-text">{t('to')}<input type="date" dir="ltr" value={draft.to ?? ''} onChange={(e) => set('to', e.target.value)} className={FIELD} data-filter="to" /></label>
              </div>
              {localError ? <p role="alert" className="text-sm text-negative">{t(localError === 'reversed' ? 'rangeReversed' : 'rangeTooLong')}</p> : null}
            </>
          ) : null}
          {has('compare_from') ? (
            <div className="grid grid-cols-2 gap-2.5">
              <label className="block text-sm font-medium text-text">{t('compareFrom')}<input type="date" dir="ltr" value={draft.compare_from ?? ''} onChange={(e) => set('compare_from', e.target.value)} className={FIELD} /></label>
              <label className="block text-sm font-medium text-text">{t('compareTo')}<input type="date" dir="ltr" value={draft.compare_to ?? ''} onChange={(e) => set('compare_to', e.target.value)} className={FIELD} /></label>
            </div>
          ) : null}
          {has('station_id') ? select('station_id', t('station'), draft.station_id, (v) => { set('station_id', v); set('shift_id', ''); }, stations.options, t('allStations')) : null}
          {has('product_id') ? select('product_id', t('product'), draft.product_id, (v) => set('product_id', v), products.options, t('allProducts')) : null}
          {has('pump_id') ? select('pump_id', t('pump'), draft.pump_id, (v) => set('pump_id', v), pumps.options, t('allPumps')) : null}
          {has('nozzle_id') ? select('nozzle_id', t('nozzle'), draft.nozzle_id, (v) => set('nozzle_id', v), nozzles.options, t('allNozzles')) : null}
          {has('shift_id') ? select('shift_id', t('shift'), draft.shift_id, (v) => set('shift_id', v), shifts.options, needsShift ? t('chooseShift') : t('allShifts')) : null}
          {has('status') ? fixed('status', t('status'), statuses, (v) => `status_${v}`) : null}
          {has('group') ? fixed('group', t('group'), ['day', 'week', 'month'], (v) => `group_${v}`, t('groupDefault')) : null}
          {has('dimension') ? fixed('dimension', t('dimension'), ['product', 'station'], (v) => `dim_${v}`, t('dimDefault')) : null}
          {has('date_basis') ? fixed('date_basis', t('dateBasis'), ['opened', 'closed'], (v) => `basis_${v}`, t('basisDefault')) : null}
          {has('overdue_hours') ? (
            <label className="block text-sm font-medium text-text">{t('overdueHours')}
              <input type="number" inputMode="numeric" min={1} max={720} dir="ltr" value={draft.overdue_hours ?? ''} placeholder="12" onChange={(e) => set('overdue_hours', e.target.value)} className={FIELD} />
            </label>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" data-apply="" disabled={localError !== null || state.status === 'loading'} onClick={apply} className="min-h-12 rounded-[12px] bg-[color:var(--fo-cta-bg,var(--primary))] px-4 text-sm font-bold text-[color:var(--fo-cta-fg,#fff)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50">{t('apply')}</button>
            <button type="button" onClick={reset} className="min-h-12 rounded-[12px] border border-[color:var(--fo-control,var(--border))] bg-surface px-4 text-sm font-semibold text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{t('reset')}</button>
          </div>
        </div>
      </details>

      {state.status === 'idle' && needsShift ? <p className="rounded-[12px] border border-dashed border-border px-4 py-8 text-center text-sm text-muted" data-choose-shift="">{t('chooseShiftHint')}</p> : null}
      {state.status === 'loading' ? <p className="py-8 text-center text-sm text-muted" role="status"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" aria-hidden="true" />{t('loading')}</p> : null}
      {state.status === 'error' ? (
        <div>
          <Problem code={state.code} t={t} />
          {state.code !== 403 && state.code !== 404 ? (
            <button type="button" onClick={() => setTick((n) => n + 1)} className="mx-auto mt-3 flex min-h-11 items-center gap-2 rounded-[11px] border border-[color:var(--fo-control,var(--border))] px-4 text-sm font-semibold text-text hover:bg-primary-soft"><RefreshCw className="h-4 w-4" aria-hidden="true" />{t('retry')}</button>
          ) : null}
        </div>
      ) : null}

      {state.status === 'ready' ? (
        <Ready payload={state.payload} lang={lang} filters={applied} chart={chart} />
      ) : null}
    </div>
  );
}

function Ready({ payload, lang, filters, chart }: { payload: ReportPayload; lang: Lang; filters: ReportFilters; chart: boolean }) {
  const t = useTranslations('fuelReports');
  const tableLabels = { total: t('total'), empty: t('empty'), more: t('more'), rows: t('rows') };
  const notes = payload.data_quality.notes;
  const gaps = payload.data_quality.gaps;
  const firstTable = payload.tables[0];

  return (
    <div className="space-y-5" data-report-ready="">
      <p className="text-xs leading-5 text-muted">
        <span className="num" dir="ltr">{payload.period ? `${payload.period.from} → ${payload.period.to}` : t('currentState')}</span>
        {' · '}{payload.stations.map((s) => s.name).join('، ') || '—'}{' · '}{t('timezone')}: <span dir="ltr">{payload.timezone}</span>
      </p>

      {!payload.data_quality.complete ? (
        <div role="status" data-data-quality="incomplete" className="flex gap-2 rounded-[12px] bg-[color:var(--fo-warning-tint,rgba(217,119,6,.1))] p-3 text-sm leading-6 text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">{t('incomplete')}</p>
            {gaps.length > 0 ? <p className="text-xs">{t('gapsTitle')}: {gaps.map((g) => t.has(`gap.${g}`) ? t(`gap.${g}`) : g).join('، ')}</p> : null}
            {payload.truncated ? <p className="text-xs">{t('truncated')}</p> : null}
          </div>
        </div>
      ) : null}

      {payload.summary.length > 0 ? (
        <dl className="grid grid-cols-2 gap-2.5 md:grid-cols-4" data-report-summary="">
          {payload.summary.map((item) => (
            <div key={item.key} className="rounded-[12px] border border-border bg-surface p-3">
              <dt className="text-xs text-muted">{item.label[lang]}</dt>
              <dd dir="ltr" className={cn('num mt-1 text-lg font-semibold text-text', lang === 'ar' && 'text-end')}>{summaryText(item, lang, payload.timezone)}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {chart && firstTable ? <MiniBars table={firstTable} lang={lang} label={t('chart')} /> : null}

      {payload.tables.map((table) => <ReportTable key={table.key} table={table} lang={lang} timezone={payload.timezone} labels={tableLabels} />)}

      {notes.length > 0 ? (
        <ul className="space-y-1 text-xs leading-5 text-muted" data-report-notes="">{notes.map((n, i) => <li key={i}>• {n[lang]}</li>)}</ul>
      ) : null}

      <p className="text-[11px] text-muted">{t('generatedAt')}: <span dir="ltr">{payload.generated_at.slice(0, 16).replace('T', ' ')} UTC</span></p>

      <ReportActions payload={payload} filters={filters} lang={lang} />
    </div>
  );
}

function errorCode(error: unknown): number | 'contract' | 'network' {
  const status = (error as { status?: number })?.status;
  if (typeof status === 'number') return status;
  return (error as { name?: string })?.name === 'ReportContractError' ? 'contract' : 'network';
}

function Problem({ code, t }: { code: number | 'contract' | 'network'; t: ReturnType<typeof useTranslations> }) {
  const key = code === 403 ? 'forbidden' : code === 404 ? 'notFound' : code === 422 ? 'invalid' : code === 'contract' ? 'contract' : 'failed';
  return <p role="alert" data-report-error={String(code)} className="rounded-[12px] bg-[color:var(--fo-negative-tint,rgba(220,38,38,.08))] p-4 text-center text-sm leading-6 text-negative">{t(`error.${key}`)}</p>;
}

