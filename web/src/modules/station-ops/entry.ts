import { litersToMilliliters } from '@/lib/fuel-quantity';
import type { NozzleView, StationCatalog, TankView } from './catalog';
import { evidenceKey, type ReadingStage } from './intents';
import type { ShiftPolicy } from './policy';
import type { MeterReading, ShiftDetail, TankReading } from './schemas';

/**
 * UI-2 — منطق إدخال القراءات (دوال نقية بلا I/O).
 *
 * المبدأ: **لا قيمة مجهولة تتحوّل إلى صفر**، و**لا إرسال ما نعلم أن الخادم سيقبله ثم يُعطّل به الوردية**. الخادم يقبل `closing < opening` عند التسجيل
 * ثم يرفض *إغلاق الوردية* (`meterDelta`) ولا تصحيح لوردية مفتوحة ⇒ قراءة إغلاق أقل من الافتتاح تُحجب هنا حجباً صارماً (R2). أما حالات التصفير/
 * الدوران المشروعة فلا سياسة لها في الخادم (BLOCKED B3) فلا نستثنيها بتخمين. المقارنة بآخر إغلاق سابق **تنبيه** لا حجب (القراءة السابقة
 * الرسمية غير متاحة عبر API — B4).
 */

export type NumberParse = { ok: true; ml: number } | { ok: false; reason: 'empty' | 'invalid' };

/** لترات المستخدم (حتى 3 منازل) ⇒ mL صحيح. الفراغ ليس صفراً. يقبل أرقاماً عربية/لاتينية ويرفض الملتبس (`1,500`). */
export function parseLiters(raw: string): NumberParse {
  if (raw.trim() === '') return { ok: false, reason: 'empty' };
  const ml = litersToMilliliters(raw, true);
  return ml === null ? { ok: false, reason: 'invalid' } : { ok: true, ml };
}

export type RowIssue = 'invalid_number' | 'closing_below_opening' | 'opening_above_closing' | 'needs_opening';
export type RowWarning = 'below_previous_closing' | 'differs_from_previous_closing' | 'zero_delta';

export type RowState =
  | { kind: 'saved'; ml: number }
  | { kind: 'empty' }
  | { kind: 'blocked'; issue: 'needs_opening' }
  | { kind: 'invalid'; issue: 'invalid_number' | 'closing_below_opening' | 'opening_above_closing' }
  | { kind: 'ready'; ml: number; deltaMl: number | null; warnings: RowWarning[] };

export interface MeterRowInput {
  stage: ReadingStage;
  raw: string;
  saved: MeterReading | null;
  /** قراءة الافتتاح المحفوظة لهذه الفوهة (للإغلاق فقط). */
  opening: MeterReading | null;
  /** قراءة النهاية المحفوظة لهذه الفوهة (للبداية فقط): تُحجب بداية أعلى منها — الخادم يقبلها ثم يرفض إغلاق الوردية ولا تعديل. */
  closing?: MeterReading | null;
  /** آخر قراءة إغلاق مسجّلة في وردية سابقة (مرجع إرشادي للافتتاح فقط). */
  previousClosingMl: number | null;
  /**
   * قراءة الافتتاح مطلوبة؟ الافتراضي `true` (سياسة غير معلومة ⇒ صارمة). حين تُعلن السياسة أنها اختيارية تُقبل قراءة نهاية بلا افتتاح:
   * الخادم يفحص الشرطين باستقلال و`meterDelta` يتخطى الأزواج الناقصة — بلا فرق مخترع ولا فحص ترتيب.
   */
  openingRequired?: boolean;
}

export function evaluateMeterRow(input: MeterRowInput): RowState {
  if (input.saved) return { kind: 'saved', ml: input.saved.meter_milliliters };
  const unpaired = input.stage === 'closing' && input.opening === null;
  if (unpaired && input.openingRequired !== false) return { kind: 'blocked', issue: 'needs_opening' };
  const parsed = parseLiters(input.raw);
  if (!parsed.ok) return parsed.reason === 'empty' ? { kind: 'empty' } : { kind: 'invalid', issue: 'invalid_number' };

  const warnings: RowWarning[] = [];
  if (input.stage === 'opening' && input.closing && parsed.ml > input.closing.meter_milliliters) return { kind: 'invalid', issue: 'opening_above_closing' };
  if (unpaired) return { kind: 'ready', ml: parsed.ml, deltaMl: null, warnings };
  if (input.stage === 'closing') {
    const opening = (input.opening as MeterReading).meter_milliliters;
    if (parsed.ml < opening) return { kind: 'invalid', issue: 'closing_below_opening' };
    const deltaMl = parsed.ml - opening;
    if (deltaMl === 0) warnings.push('zero_delta');
    return { kind: 'ready', ml: parsed.ml, deltaMl, warnings };
  }
  if (input.previousClosingMl !== null && parsed.ml !== input.previousClosingMl) {
    warnings.push(parsed.ml < input.previousClosingMl ? 'below_previous_closing' : 'differs_from_previous_closing');
  }
  return { kind: 'ready', ml: parsed.ml, deltaMl: null, warnings };
}

export function evaluateTankRow(raw: string, saved: TankReading | null): RowState {
  if (saved) return { kind: 'saved', ml: saved.quantity_milliliters };
  const parsed = parseLiters(raw);
  if (!parsed.ok) return parsed.reason === 'empty' ? { kind: 'empty' } : { kind: 'invalid', issue: 'invalid_number' };
  return { kind: 'ready', ml: parsed.ml, deltaMl: null, warnings: [] };
}

/* ───────────── الأصول المطلوبة (قاعدة الخادم) ───────────── */

/**
 * الخادم يشترط تغطية **كل فوهة/خزان بحالة `active`** في المحطة (`assertCloseReadiness`) بغضّ النظر عن حالة المضخة/المنتج. نطابق ذلك للمطلوب،
 * ونُبقي `view.blockedBy` ظاهراً للمستخدم كتنبيه إعدادات (لا نخفي فوهة يطلبها الخادم).
 */
export function requiredNozzles(catalog: StationCatalog): NozzleView[] {
  return catalog.pumps.flatMap(({ nozzles }) => nozzles).filter((view) => view.nozzle.status === 'active');
}

export function requiredTanks(catalog: StationCatalog): TankView[] {
  return catalog.tanks.filter((view) => view.tank.status === 'active');
}

/* ───────────── دفعة الحفظ ───────────── */

export type SaveItem =
  | { kind: 'meter'; assetId: string; ml: number; body: { fuel_nozzle_id: string; reading_stage: ReadingStage; meter_milliliters: number; evidence_key: string } }
  | { kind: 'tank'; assetId: string; ml: number; body: { fuel_tank_id: string; reading_stage: ReadingStage; reading_type: 'physical' | 'atg'; quantity_milliliters: number; evidence_key: string } };

export function meterSaveItem(shiftId: string, stage: ReadingStage, nozzleId: string, ml: number): SaveItem {
  return { kind: 'meter', assetId: nozzleId, ml, body: { fuel_nozzle_id: nozzleId, reading_stage: stage, meter_milliliters: ml, evidence_key: evidenceKey('meter', shiftId, nozzleId, stage) } };
}

/** الإغلاق يرث نوع قراءة الافتتاح الموجودة (الخادم يفشل الإغلاق إن اختلف النوعان)؛ وإلا قياس يدوي `physical`. */
export function tankSaveItem(shiftId: string, stage: ReadingStage, tankId: string, ml: number, openingType: string | null): SaveItem {
  const type = openingType === 'atg' ? 'atg' : 'physical';
  return { kind: 'tank', assetId: tankId, ml, body: { fuel_tank_id: tankId, reading_stage: stage, reading_type: type, quantity_milliliters: ml, evidence_key: evidenceKey('tank', shiftId, tankId, stage) } };
}

/* ───────────── تغطية القراءات وجاهزية الإغلاق ───────────── */

export interface Coverage { done: number; total: number }

export interface ReadingsCoverage {
  meterOpening: Coverage;
  meterClosing: Coverage;
  tankOpening: Coverage;
  tankClosing: Coverage;
  /** فوهات بقراءة إغلاق < افتتاح (لا يُغلق الخادم معها). */
  invalidOrder: number;
}

export function readingsCoverage(detail: ShiftDetail, catalog: StationCatalog): ReadingsCoverage {
  const nozzles = requiredNozzles(catalog);
  const tanks = requiredTanks(catalog);
  const at = (stage: ReadingStage) => ({
    meters: new Map(detail.meter_readings.filter((r) => r.reading_stage === stage).map((r) => [r.nozzle_id, r])),
    tanks: new Set(detail.tank_readings.filter((r) => r.reading_stage === stage).map((r) => r.tank_id)),
  });
  const opening = at('opening');
  const closing = at('closing');
  let invalidOrder = 0;
  for (const view of nozzles) {
    const o = opening.meters.get(view.nozzle.id);
    const c = closing.meters.get(view.nozzle.id);
    if (o && c && c.meter_milliliters < o.meter_milliliters) invalidOrder += 1;
  }
  return {
    meterOpening: { done: nozzles.filter((v) => opening.meters.has(v.nozzle.id)).length, total: nozzles.length },
    meterClosing: { done: nozzles.filter((v) => closing.meters.has(v.nozzle.id)).length, total: nozzles.length },
    tankOpening: { done: tanks.filter((v) => opening.tanks.has(v.tank.id)).length, total: tanks.length },
    tankClosing: { done: tanks.filter((v) => closing.tanks.has(v.tank.id)).length, total: tanks.length },
    invalidOrder,
  };
}

export type ReadinessBlocker =
  | { kind: 'meter_opening' | 'meter_closing' | 'tank_opening' | 'tank_closing'; remaining: number }
  | { kind: 'invalid_order'; remaining: number }
  | { kind: 'tank_type_mismatch'; remaining: number }
  | { kind: 'staff_missing'; remaining: 1 };

/**
 * ما يمنع الإغلاق **بحسب السياسة المعلومة**. غير المعروفة (`policy.known=false`) نعاملها صارمة للقراءات فنعرض النقص، لكننا لا نحجب زر
 * الإغلاق بناءً على تخمين: `hardBlock` تُحسب من السياسة المؤكدة فقط، والخادم يبقى الحكم النهائي.
 */
export function closeBlockers(detail: ShiftDetail, catalog: StationCatalog, policy: ShiftPolicy): { blockers: ReadinessBlocker[]; hardBlock: boolean } {
  const coverage = readingsCoverage(detail, catalog);
  const blockers: ReadinessBlocker[] = [];
  const need = (flag: boolean, kind: 'meter_opening' | 'meter_closing' | 'tank_opening' | 'tank_closing', c: Coverage) => {
    if (flag && c.done < c.total) blockers.push({ kind, remaining: c.total - c.done });
  };
  need(policy.openingMeterRequired, 'meter_opening', coverage.meterOpening);
  need(policy.closingMeterRequired, 'meter_closing', coverage.meterClosing);
  need(policy.openingTankRequired, 'tank_opening', coverage.tankOpening);
  need(policy.closingTankRequired, 'tank_closing', coverage.tankClosing);
  if (coverage.invalidOrder > 0) blockers.push({ kind: 'invalid_order', remaining: coverage.invalidOrder });

  const openingTypes = new Map(detail.tank_readings.filter((r) => r.reading_stage === 'opening').map((r) => [r.tank_id, r.reading_type]));
  const mismatched = detail.tank_readings.filter((r) => r.reading_stage === 'closing' && openingTypes.has(r.tank_id) && openingTypes.get(r.tank_id) !== r.reading_type).length;
  if (mismatched > 0) blockers.push({ kind: 'tank_type_mismatch', remaining: mismatched });

  if (policy.staffMandatory && policy.known && (detail.staff_assignments?.length ?? 1) === 0) blockers.push({ kind: 'staff_missing', remaining: 1 });
  return { blockers, hardBlock: blockers.length > 0 && (policy.known || coverage.invalidOrder > 0) };
}

/** آخر قراءة إغلاق لكل فوهة من وردية سابقة — مرجع إرشادي (B4): ليست القراءة السابقة الرسمية. */
export function previousClosingMap(detail: Pick<ShiftDetail, 'meter_readings'> | null): Record<string, number> {
  const map: Record<string, number> = {};
  if (!detail) return map;
  for (const reading of detail.meter_readings) if (reading.reading_stage === 'closing') map[reading.nozzle_id] = reading.meter_milliliters;
  return map;
}

/**
 * قراءات متبقية للمرحلتين **بحسب السياسة** (عدادات + خزانات) — تغذّي «الخطوة التالية» والتقدّم كي لا يُعلن أن قراءات البداية اكتملت
 * بينما قراءات الخزانات المطلوبة ناقصة (الخادم يمنع الإغلاق عندها). سياسة غير معلومة ⇒ صارمة (تُظهر النقص ولا تحجب).
 */
export interface ReadingsExtra { openingRemaining: number; closingRemaining: number }

export function pendingReadings(detail: ShiftDetail, catalog: StationCatalog, policy: ShiftPolicy): ReadingsExtra {
  const c = readingsCoverage(detail, catalog);
  const rem = (flag: boolean, cov: Coverage) => (flag ? Math.max(0, cov.total - cov.done) : 0);
  return {
    openingRemaining: rem(policy.openingMeterRequired, c.meterOpening) + rem(policy.openingTankRequired, c.tankOpening),
    closingRemaining: rem(policy.closingMeterRequired, c.meterClosing) + rem(policy.closingTankRequired, c.tankClosing),
  };
}
