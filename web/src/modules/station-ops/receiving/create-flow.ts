import { createDelivery, receivingGet, recordReading, type DeliveryWrite, type ReadingWrite, type WriteFailure } from './receiving-client';
import { buildDeliveryBody, buildReadingBody, matchesIntent, readingEvidenceKey, type Evaluation, type FormValues, type ReadingType } from './logic';
import { deliveriesResponse, readingsResponse, type Delivery, type TankReading } from './schemas';

/**
 * FUEL-B5 — تسلسل إنشاء مسودة الاستلام: قراءة قبل ← قراءة بعد ← المسودة. دالة بلا واجهة (قابلة للاختبار بتبعيات مُحقَنة).
 *
 * ضمانات:
 *  - **لا أثر مخزني ولا محاسبي** في أي خطوة: قراءات الخزانات وسجل المسودة فقط (الاعتماد وحده يحرّك المخزون، وهو فعل منفصل).
 *  - كل قراءة بمفتاح دليل **حتمي** من النية؛ تكرارها (إعادة محاولة/انقطاع) يُرفض في الخادم فنقرأ الموجودة ونتحقق من مطابقة قيمتها بدل أن نكرّرها أو نتجاهل.
 *  - المسودة بمفتاح idempotency ثابت للنية؛ نتيجة غير مؤكدة لا تُعاد تلقائياً (يقرر المستخدم بعد قراءة الحالة).
 *  - لا نحاول أبداً «إصلاح» رفض الخادم: كل رفض يُعاد كما هو.
 */

export type Stage = 'reading_before' | 'reading_after' | 'delivery';

export type FlowResult =
  | { kind: 'ok'; delivery: Delivery; readingIds: ReadingIds }
  | { kind: 'stopped'; stage: Stage; failure: WriteFailure | { kind: 'reading_conflict' }; readingIds: ReadingIds };

export interface ReadingIds { before?: string; after?: string }

export interface FlowDeps {
  recordReading: typeof recordReading;
  createDelivery: typeof createDelivery;
  findReadingByKey: (tankId: string, evidenceKey: string, branchId?: string | null) => Promise<TankReading | null>;
}

export async function findReadingByKey(tankId: string, evidenceKey: string, branchId?: string | null): Promise<TankReading | null> {
  try {
    const page = await receivingGet('/fuel-stations/readings', readingsResponse, { query: { fuel_tank_id: tankId }, branchId });
    return page.data.find((reading) => reading.evidence_key === evidenceKey && reading.fuel_tank_id === tankId) ?? null;
  } catch {
    return null; // تعذّرت القراءة ⇒ لا نفترض شيئاً
  }
}

export const defaultDeps: FlowDeps = { recordReading, createDelivery, findReadingByKey };

export interface FlowInput {
  form: FormValues;
  evaluation: Evaluation;
  stationId: string;
  tankId: string;
  fuelProductId: string;
  warehouseId: string;
  intentKey: string;
  /** قراءات سُجِّلت في محاولة سابقة لهذه النية (تُتخطّى). */
  readingIds?: ReadingIds;
  branchId?: string | null;
}

async function ensureReading(
  deps: FlowDeps, input: FlowInput, stage: 'before' | 'after', ml: number, type: ReadingType,
): Promise<{ id: string } | { stop: { failure: WriteFailure | { kind: 'reading_conflict' } } }> {
  const key = readingEvidenceKey(input.intentKey, stage, type);
  const result: ReadingWrite = await deps.recordReading(buildReadingBody(input.stationId, input.tankId, type, ml, key), { branchId: input.branchId });
  if (result.kind === 'ok') return { id: result.reading.id };

  // موجودة مسبقاً (محاولة سابقة) أو غير مؤكدة: نقرأ الخادم ونتحقق من تطابق القيمة قبل أن نستعملها.
  const existsAlready = (result.kind === 'rejected' && result.code === 'evidence_exists') || result.kind === 'unknown' || result.kind === 'unverified';
  if (existsAlready) {
    const found = await deps.findReadingByKey(input.tankId, key, input.branchId);
    if (found && found.quantity_milliliters === ml && found.reading_type === type) return { id: found.id };
    if (found) return { stop: { failure: { kind: 'reading_conflict' } } };
  }
  return { stop: { failure: result } };
}

export async function runCreate(input: FlowInput, deps: FlowDeps = defaultDeps): Promise<FlowResult> {
  const ids: ReadingIds = { ...(input.readingIds ?? {}) };
  const type = input.form.readingType;

  for (const stage of ['before', 'after'] as const) {
    const ml = stage === 'before' ? input.evaluation.beforeMl : input.evaluation.afterMl;
    if (ml === null || ids[stage]) continue;
    const outcome = await ensureReading(deps, input, stage, ml, type);
    if ('id' in outcome) ids[stage] = outcome.id;
    else return { kind: 'stopped', stage: stage === 'before' ? 'reading_before' : 'reading_after', failure: outcome.stop.failure, readingIds: ids };
  }

  const body = buildDeliveryBody(input.form, input.evaluation, {
    stationId: input.stationId, tankId: input.tankId, fuelProductId: input.fuelProductId, warehouseId: input.warehouseId, idempotencyKey: input.intentKey, readingIds: ids,
  });
  const created: DeliveryWrite = await deps.createDelivery(body, { branchId: input.branchId });
  if (created.kind === 'ok') return { kind: 'ok', delivery: created.delivery, readingIds: ids };
  return { kind: 'stopped', stage: 'delivery', failure: created, readingIds: ids };
}

/** تحقق بعد نتيجة غير مؤكدة: هل أُنشئت مسودة تطابق نيتنا؟ يقرأ آخر استلامات المحطة (الأحدث أولاً). `null` = لم نجد (أو تعذّرت القراءة). */
export async function findDeliveryByIntent(input: FlowInput): Promise<Delivery | null> {
  try {
    const page = await receivingGet('/fuel-stations/deliveries', deliveriesResponse, { query: { station_id: input.stationId, status: 'draft' }, branchId: input.branchId });
    return page.data.find((row) => matchesIntent(row, input.form, input.evaluation)) ?? null;
  } catch {
    return null;
  }
}
