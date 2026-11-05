import type { NozzleView, StationCatalog } from './catalog';
import type { MeterReading, Pump, ShiftDetail, TankReading } from './schemas';

/**
 * UI-1 — اشتقاق عرض قراءات الوردية (دوال نقية بلا I/O).
 *
 * المصدر الوحيد للأرقام: `GET /fuel-stations/shifts/{id}` (قراءات العدادات) + كتالوج أصول المحطة الحالي لأسماء الفوهات والمضخات
 * والمنتجات. اللترات المحسوبة = قراءة الإغلاق − قراءة الافتتاح **للفوهة نفسها بأعداد صحيحة (mL)**؛ هي دليل تشغيلي من العداد وليست
 * مبيعات POS ولا تحصيلاً ولا حركة مخزون. لا نقدّر قراءة غائبة ولا نملأها صفراً: الغياب حالة صريحة (`not_recorded`/`awaiting_closing`).
 *
 * قواعد التوقّع: لوردية **مفتوحة** فقط نتوقع قراءة لكل فوهة نشطة حالياً (إذ لا يزال الإعداد الحالي هو الحاكم)؛ ولوردية مغلقة/معتمدة
 * لا نفترض أي فوهة «ناقصة» لأن إعداد المحطة قد يكون تغيّر بعدها — نعرض ما سُجّل فعلاً فقط.
 */

export type NozzleReadingStatus = 'complete' | 'awaiting_closing' | 'closing_without_opening' | 'not_recorded' | 'invalid_order';

export interface NozzleReadingRow {
  nozzleId: string;
  /** `null` = فوهة غير موجودة في إعداد المحطة الحالي (حُذفت/محطة أخرى/لم تُحمَّل) — تُعرض قراءتها ولا تُخفى. */
  view: NozzleView | null;
  opening: MeterReading | null;
  closing: MeterReading | null;
  /** فرق mL للصفوف `complete` فقط. */
  deltaMl: number | null;
  status: NozzleReadingStatus;
}

export interface PumpReadingGroup {
  key: string;
  pump: Pump | null;
  rows: NozzleReadingRow[];
}

export interface ReadingsSummary {
  /** عدد الفوهات المتوقعة (نشطة حالياً) — لوردية مفتوحة فقط، وإلا `null` (لا مقام مخترع). */
  expected: number | null;
  /**
   * التغطية (للتقدم و«جزئي» و«المتبقي»): في الوردية المفتوحة تُحسب **على الفوهات المتوقعة (النشطة حالياً) وحدها** حتى لا تُخفي قراءةُ
   * فوهة معطّلة نقصَ فوهة نشطة؛ وفي المغلقة/المعتمدة (لا متوقَّع) على كل ما سُجِّل.
   */
  withOpening: number;
  withClosing: number;
  complete: number;
  /** أزواج غير صالحة (إغلاق < افتتاح) في كل الفوهات — للتحذير. */
  invalid: number;
  /** غير الصالحة ضمن الفوهات المتوقعة فقط (لحساب «المتبقي»). */
  invalidExpected: number;
  /** كل الأزواج الصالحة المسجَّلة (أي فوهة) — هي مصدر `computedMl`؛ `0` ⇒ لا لترات محسوبة بعد. */
  recordedComplete: number;
  /** مجموع فروق الصفوف المكتملة الصالحة فقط (mL). */
  computedMl: number;
  /** إجمالي الخادم المثبَّت عند الإغلاق، أو `null` لوردية مفتوحة (لم يُحسب بعد — ليس صفراً). */
  serverMl: number | null;
  /** ما يعرضه الخادم لا يطابق ما نحسبه من القراءات المعروضة (مغلقة/معتمدة فقط). */
  mismatch: boolean;
  /** وردية مفتوحة وما زالت فوهات متوقعة بلا فرق مكتمل ⇒ المجموع جزئي. */
  partial: boolean;
}

export interface ShiftReadingsView {
  groups: PumpReadingGroup[];
  /** صفوف فوهات خارج الإعداد الحالي. */
  outsideSetup: NozzleReadingRow[];
  summary: ReadingsSummary;
}

function compareLabel(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true });
}

export function classifyRow(opening: MeterReading | null, closing: MeterReading | null): { status: NozzleReadingStatus; deltaMl: number | null } {
  if (opening && closing) {
    const delta = closing.meter_milliliters - opening.meter_milliliters;
    return delta < 0 ? { status: 'invalid_order', deltaMl: null } : { status: 'complete', deltaMl: delta };
  }
  if (opening) return { status: 'awaiting_closing', deltaMl: null };
  if (closing) return { status: 'closing_without_opening', deltaMl: null };
  return { status: 'not_recorded', deltaMl: null };
}

export function buildShiftReadings(detail: ShiftDetail, catalog: StationCatalog): ShiftReadingsView {
  const isOpen = detail.status === 'open';

  const views = new Map<string, NozzleView>();
  for (const { nozzles } of catalog.pumps) for (const view of nozzles) views.set(view.nozzle.id, view);

  const openings = new Map<string, MeterReading>();
  const closings = new Map<string, MeterReading>();
  for (const reading of detail.meter_readings) {
    // الخادم يفرض فريداً (وردية، فوهة، مرحلة)؛ لو تكرر لأي سبب نُبقي أحدث قياس لا الأول.
    const target = reading.reading_stage === 'opening' ? openings : closings;
    const current = target.get(reading.nozzle_id);
    if (!current || (Date.parse(reading.measured_at ?? '') || 0) >= (Date.parse(current.measured_at ?? '') || 0)) target.set(reading.nozzle_id, reading);
  }

  const ids = new Set<string>([...openings.keys(), ...closings.keys()]);
  if (isOpen) for (const [id, view] of views) if (view.blockedBy === null) ids.add(id);

  const rows: NozzleReadingRow[] = [...ids].map((nozzleId) => {
    const opening = openings.get(nozzleId) ?? null;
    const closing = closings.get(nozzleId) ?? null;
    return { nozzleId, view: views.get(nozzleId) ?? null, opening, closing, ...classifyRow(opening, closing) };
  });

  const byPump = new Map<string, PumpReadingGroup>();
  const outsideSetup: NozzleReadingRow[] = [];
  for (const row of rows) {
    if (!row.view) {
      outsideSetup.push(row);
      continue;
    }
    const pump = row.view.pump;
    const key = pump?.id ?? 'no-pump';
    const group = byPump.get(key) ?? { key, pump, rows: [] };
    group.rows.push(row);
    byPump.set(key, group);
  }
  const nozzleLabel = (row: NozzleReadingRow) => row.view?.nozzle.nozzle_number ?? row.nozzleId;
  const groups = [...byPump.values()]
    .map((group) => ({ ...group, rows: [...group.rows].sort((a, b) => compareLabel(nozzleLabel(a), nozzleLabel(b))) }))
    .sort((a, b) => compareLabel(a.pump?.pump_number ?? '~', b.pump?.pump_number ?? '~'));
  outsideSetup.sort((a, b) => compareLabel(a.nozzleId, b.nozzleId));

  const complete = rows.filter((row) => row.status === 'complete');
  const computedMl = complete.reduce((sum, row) => sum + (row.deltaMl ?? 0), 0);
  // نطاق التغطية: وردية مفتوحة ⇒ الفوهات النشطة حالياً فقط؛ وإلا كل الصفوف.
  const scope = isOpen ? rows.filter((row) => row.view !== null && row.view.blockedBy === null) : rows;
  const scopeComplete = scope.filter((row) => row.status === 'complete').length;
  const expected = isOpen ? [...views.values()].filter((view) => view.blockedBy === null).length : null;
  const serverMl = isOpen ? null : detail.operational_meter_milliliters;

  return {
    groups,
    outsideSetup,
    summary: {
      expected,
      withOpening: scope.filter((row) => row.opening).length,
      withClosing: scope.filter((row) => row.closing).length,
      complete: scopeComplete,
      invalid: rows.filter((row) => row.status === 'invalid_order').length,
      invalidExpected: scope.filter((row) => row.status === 'invalid_order').length,
      recordedComplete: complete.length,
      computedMl,
      serverMl,
      mismatch: serverMl !== null && serverMl !== computedMl,
      partial: isOpen && (expected === null || scopeComplete < expected),
    },
  };
}

/* ───────────── التقدم في الوردية ───────────── */

export type StepKey = 'opened' | 'opening_readings' | 'closing_readings' | 'closed' | 'approved';
export type StepState = 'done' | 'current' | 'pending' | 'none';

export interface ProgressStep {
  key: StepKey;
  state: StepState;
  /** وقت الخطوة إن وُجد (ISO). */
  at: string | null;
  /** عدّاد القراءات: `total` غير معروف (`null`) لورديات غير مفتوحة. */
  count: { done: number; total: number | null } | null;
}

/**
 * التقدم يتبع حالات أَوْج الثلاث فقط (open ← closed ← approved) مع تفصيل قراءات العدادات داخل الوردية المفتوحة.
 * لا حالة «مُرسلة/مُعادة» (غير موجودة في الخادم). «الحالية» = أول خطوة غير مكتملة.
 */
export function deriveProgress(detail: ShiftDetail, summary: ReadingsSummary, extra?: { openingRemaining: number; closingRemaining: number } | null): ProgressStep[] {
  const isOpen = detail.status === 'open';
  const isApproved = detail.status === 'approved';
  const closed = detail.status === 'closed' || isApproved;
  const total = summary.expected;

  const readingState = (done: number): StepState => {
    if (closed) return done > 0 ? 'done' : 'none';
    if (total === null || total === 0) return done > 0 ? 'done' : 'pending';
    return done >= total ? 'done' : 'pending';
  };

  // مع قراءات متبقية محسوبة بالسياسة (UI-2) هي **الحكم في الاتجاهين** لوردية مفتوحة: متبقٍ > 0 ⇒ معلّقة، و0 ⇒ مكتملة حتى لو بقيت قراءات
  // عدادات اختيارية بلا تسجيل (وإلا لا يصل المستخدم إلى التسليم أبداً). بدونها (UI-1) يبقى الاشتقاق من العدادات كما كان.
  const gate = (state: StepState, remaining: number | undefined): StepState => (closed || remaining === undefined ? state : remaining > 0 ? 'pending' : 'done');

  const steps: ProgressStep[] = [
    { key: 'opened', state: 'done', at: detail.opened_at, count: null },
    // UI-2: قراءات الخزانات المطلوبة جزء من اكتمال المرحلة (الخادم يمنع الإغلاق بدونها)؛ العدّاد يبقى للفوهات.
    { key: 'opening_readings', state: gate(readingState(summary.withOpening), extra?.openingRemaining), at: null, count: { done: summary.withOpening, total } },
    { key: 'closing_readings', state: gate(readingState(summary.withClosing), extra?.closingRemaining), at: null, count: { done: summary.withClosing, total } },
    { key: 'closed', state: closed ? 'done' : 'pending', at: detail.closed_at, count: null },
    { key: 'approved', state: isApproved ? 'done' : 'pending', at: detail.approved_at, count: null },
  ];

  const firstPending = steps.findIndex((step) => step.state === 'pending');
  if (firstPending >= 0 && (isOpen || detail.status === 'closed')) steps[firstPending] = { ...steps[firstPending], state: 'current' };
  return steps;
}

/* ───────────── قراءات الخزانات ───────────── */

export interface TankReadingRow {
  tankId: string;
  opening: TankReading | null;
  closing: TankReading | null;
}

/** قراءات الخزانات (قياس فعلي/ATG) مجمّعة بالخزان؛ لا اشتقاق فروق هنا — فرق الخزان التشغيلي يحسبه الخادم عند الإغلاق. */
export function buildTankRows(detail: ShiftDetail): TankReadingRow[] {
  const rows = new Map<string, TankReadingRow>();
  for (const reading of detail.tank_readings) {
    const row = rows.get(reading.tank_id) ?? { tankId: reading.tank_id, opening: null, closing: null };
    if (reading.reading_stage === 'opening') row.opening = reading;
    else row.closing = reading;
    rows.set(reading.tank_id, row);
  }
  return [...rows.values()].sort((a, b) => compareLabel(a.tankId, b.tankId));
}
