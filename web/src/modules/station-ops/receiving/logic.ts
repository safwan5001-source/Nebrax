import { litersToMilliliters, millilitersToLiters } from '@/lib/fuel-quantity';
import type { DeliveryBody, ReadingBody } from './receiving-client';

/**
 * FUEL-B5/B5.1 — منطق نقي لنموذج استلام الوقود (لا شبكة، لا حالة). **لا قيمة مجهولة تتحوّل إلى صفر**: الفراغ ≠ 0.
 * B5.1: **لا تكلفة في النموذج** — موظف المحطة ينشئ المسودة بلا تكلفة، وتُسجَّل لاحقاً بإجراء مالي مستقل (`cost-card`) قبل الاعتماد.
 * لا حدود/عتبات مخترعة للفروق (عقد الخادم بلا عتبة، وقرار B2: لا عتبات مالية غير معتمدة): الفرق يُعرض بقيمته واتجاهه، وما يُحجب فقط هو
 * المستحيل (قراءة ما بعد أقل من ما قبل، كمية مستلمة ≤ 0، رقم غير صالح).
 */

export type ReadingType = 'physical' | 'atg';

export interface FormValues {
  supplierId: string;
  tankId: string;
  deliveryNote: string;
  purchaseRef: string;
  tanker: string;
  driver: string;
  notes: string;
  dispatched: string;
  received: string;
  readingType: ReadingType;
  before: string;
  after: string;
}

export const EMPTY_FORM: FormValues = {
  supplierId: '', tankId: '', deliveryNote: '', purchaseRef: '', tanker: '', driver: '', notes: '',
  dispatched: '', received: '', readingType: 'physical', before: '', after: '',
};

export type Issue =
  | 'supplier_required' | 'tank_required' | 'warehouse_required' | 'delivery_note_required'
  | 'dispatched_required' | 'dispatched_invalid' | 'received_required' | 'received_invalid' | 'received_not_positive'
  | 'before_invalid' | 'after_invalid' | 'after_below_before';

export type Warning = 'received_above_dispatched' | 'received_below_dispatched' | 'readings_incomplete' | 'no_readings' | 'tank_gain_differs';

export interface Evaluation {
  issues: Issue[];
  warnings: Warning[];
  dispatchedMl: number | null;
  receivedMl: number | null;
  beforeMl: number | null;
  afterMl: number | null;
  /** المستلم − المرسل (موجب = زيادة، سالب = نقص) — يطابق `transit_variance_milliliters` في الخادم. */
  transitVarianceMl: number | null;
  /** ما بعد − ما قبل (ارتفاع الخزان). */
  tankGainMl: number | null;
  /** ارتفاع الخزان − المستلم (صفر = متطابق). */
  tankGainDiffMl: number | null;
}

type Quantity = { value: number | null; issue: 'required' | 'invalid' | null };

function quantity(raw: string, allowZero: boolean): Quantity {
  if (raw.trim() === '') return { value: null, issue: 'required' };
  const ml = litersToMilliliters(raw, allowZero);
  return ml === null ? { value: null, issue: 'invalid' } : { value: ml, issue: null };
}

export interface EvaluateContext {
  /** المحطة بلا مخزن مرتبط ⇒ الخادم يرفض (لا fallback). */
  hasWarehouse: boolean;
}

export function evaluate(form: FormValues, context: EvaluateContext): Evaluation {
  const issues: Issue[] = [];
  const warnings: Warning[] = [];

  if (form.supplierId === '') issues.push('supplier_required');
  // FUEL-B5.1: رقم سند التسليم من المورد إلزامي لكل استلام جديد (والمرفق اختياري ولا يحلّ محله). الخادم يفرضه أيضاً.
  if (form.deliveryNote.trim() === '') issues.push('delivery_note_required');
  if (form.tankId === '') issues.push('tank_required');
  if (!context.hasWarehouse) issues.push('warehouse_required');

  const dispatched = quantity(form.dispatched, true);
  if (dispatched.issue === 'required') issues.push('dispatched_required');
  if (dispatched.issue === 'invalid') issues.push('dispatched_invalid');
  const received = quantity(form.received, true);
  if (received.issue === 'required') issues.push('received_required');
  if (received.issue === 'invalid') issues.push('received_invalid');
  if (received.value === 0) issues.push('received_not_positive');

  const before = form.before.trim() === '' ? null : quantity(form.before, true);
  const after = form.after.trim() === '' ? null : quantity(form.after, true);
  if (before?.issue === 'invalid') issues.push('before_invalid');
  if (after?.issue === 'invalid') issues.push('after_invalid');
  const beforeMl = before?.value ?? null;
  const afterMl = after?.value ?? null;
  if (beforeMl !== null && afterMl !== null && afterMl < beforeMl) issues.push('after_below_before');
  if ((before === null) !== (after === null)) warnings.push('readings_incomplete');
  if (before === null && after === null) warnings.push('no_readings');

  const receivedMl = received.value;
  const dispatchedMl = dispatched.value;
  const transitVarianceMl = receivedMl !== null && dispatchedMl !== null ? receivedMl - dispatchedMl : null;
  if (transitVarianceMl !== null && transitVarianceMl > 0) warnings.push('received_above_dispatched');
  if (transitVarianceMl !== null && transitVarianceMl < 0) warnings.push('received_below_dispatched');

  const tankGainMl = beforeMl !== null && afterMl !== null && afterMl >= beforeMl ? afterMl - beforeMl : null;
  const tankGainDiffMl = tankGainMl !== null && receivedMl !== null ? tankGainMl - receivedMl : null;
  if (tankGainDiffMl !== null && tankGainDiffMl !== 0) warnings.push('tank_gain_differs');

  return { issues, warnings, dispatchedMl, receivedMl, beforeMl, afterMl, transitVarianceMl, tankGainMl, tankGainDiffMl };
}

/** خطوات النموذج وما يلزم لتجاوز كل خطوة. */
export type StepId = 'who' | 'quantities' | 'readings' | 'documents' | 'review';
export const STEPS: readonly StepId[] = ['who', 'quantities', 'readings', 'documents', 'review'];

const STEP_ISSUES: Record<Exclude<StepId, 'review'>, readonly Issue[]> = {
  documents: [],
  who: ['supplier_required', 'tank_required', 'warehouse_required', 'delivery_note_required'],
  quantities: ['dispatched_required', 'dispatched_invalid', 'received_required', 'received_invalid', 'received_not_positive'],
  readings: ['before_invalid', 'after_invalid', 'after_below_before'],
};

export function stepIssues(step: StepId, evaluation: Evaluation): Issue[] {
  if (step === 'review') return evaluation.issues;
  return evaluation.issues.filter((issue) => STEP_ISSUES[step].includes(issue));
}

/** مفتاح دليل القراءة الحتمي: نفس النية ⇒ نفس المفتاح ⇒ إعادة الإرسال لا تكرّر قراءة (الخادم يرفض المفتاح المكرَّر فنقرأ الموجود). */
export function readingEvidenceKey(intentKey: string, stage: 'before' | 'after', type: ReadingType): string {
  return `awj-ops:rcv:${intentKey}:${stage}:${type}`;
}

export interface BuildContext {
  stationId: string;
  tankId: string;
  fuelProductId: string;
  warehouseId: string;
  idempotencyKey: string;
  /** معرّفات القراءات المسجَّلة فعلاً (بعد نجاح تسجيلها). */
  readingIds: { before?: string; after?: string };
}

/** حمولة الإنشاء: لترات كنص بثلاث منازل كحدٍّ أقصى (عقد الخادم). **بلا تكلفة أبداً** (NULL في الخادم حتى تسجّلها المالية). تُستدعى بعد `evaluate` بلا مشكلات. */
export function buildDeliveryBody(form: FormValues, evaluation: Evaluation, ctx: BuildContext): DeliveryBody {
  if (evaluation.issues.length > 0 || evaluation.receivedMl === null || evaluation.dispatchedMl === null) {
    throw new Error('station-ops/receiving: form is not valid');
  }
  const body: DeliveryBody = {
    fuel_station_id: ctx.stationId,
    fuel_tank_id: ctx.tankId,
    fuel_product_id: ctx.fuelProductId,
    warehouse_id: ctx.warehouseId,
    supplier_id: form.supplierId,
    dispatched_liters: millilitersToLiters(evaluation.dispatchedMl) || '0',
    received_liters: millilitersToLiters(evaluation.receivedMl) || '0',
    idempotency_key: ctx.idempotencyKey,
  };
  const optional: Array<[keyof DeliveryBody, string]> = [
    ['delivery_note_number', form.deliveryNote], ['purchase_reference', form.purchaseRef], ['tanker_identifier', form.tanker], ['driver_name', form.driver], ['notes', form.notes],
  ];
  for (const [key, value] of optional) if (value.trim() !== '') (body as unknown as Record<string, string>)[key] = value.trim();
  const prefix = form.readingType === 'physical' ? 'physical' : 'atg';
  if (ctx.readingIds.before) (body as unknown as Record<string, string>)[`before_${prefix}_reading_id`] = ctx.readingIds.before;
  if (ctx.readingIds.after) (body as unknown as Record<string, string>)[`after_${prefix}_reading_id`] = ctx.readingIds.after;
  return body;
}

export function buildReadingBody(stationId: string, tankId: string, type: ReadingType, ml: number, evidenceKey: string): ReadingBody {
  return { fuel_station_id: stationId, fuel_tank_id: tankId, reading_type: type, quantity_liters: millilitersToLiters(ml) || '0', evidence_key: evidenceKey };
}

/**
 * هل يطابق سجل الخادم ما نوينا إنشاءه؟ (للتحقق بعد نتيجة غير مؤكدة): المورد والخزان والكميات ورقم الإذن.
 * استلام بلا رقم إذن لا يُحسم بيقين بين استلامين متماثلين — لذا يطلب المستدعي مطابقة حديثة (الأحدث أولاً) ويُعلِم المستخدم عند الالتباس.
 */
export function matchesIntent(delivery: { supplier_id: string; tank_id: string; dispatched_milliliters: number; received_milliliters: number; delivery_note_number?: string | null }, form: FormValues, evaluation: Evaluation): boolean {
  return delivery.supplier_id === form.supplierId
    && delivery.tank_id === form.tankId
    && delivery.dispatched_milliliters === evaluation.dispatchedMl
    && delivery.received_milliliters === evaluation.receivedMl
    && (delivery.delivery_note_number ?? '') === form.deliveryNote.trim();
}
