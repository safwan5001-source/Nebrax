import type { NozzleBlockReason, NozzleView, StationCatalog } from '../catalog';
import type { Pump } from '../schemas';
import type { Tanker } from './schemas';

/**
 * TANKER-PR7 — منطق نقي لمعالج تسجيل تعبئة الصهريج (لا I/O ولا React). **لا حساب مالي**: الكمية mL صحيحة (لتر × 1000) بلا float، والمبالغ لا تظهر في أي موضع.
 * الخادم هو السلطة في كل قاعدة (الوردية، الفوهة، السعة، السند المكرر، السياسة)؛ ما هنا إرشاد وتحقق مبكر يوفّر على الموظف رحلة رفض.
 */

// ───────────────────────── الأرقام والنصوص ─────────────────────────

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EASTERN_PERSIAN = '۰۱۲۳۴۵۶۷۸۹';

/** يحوّل الأرقام العربية والفارسية إلى 0–9 وفاصلة الكسر العربية (٫) إلى نقطة. لا يمسّ غيرها. */
export function normalizeDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const arabic = ARABIC_INDIC.indexOf(ch);
    if (arabic >= 0) { out += String(arabic); continue; }
    const persian = EASTERN_PERSIAN.indexOf(ch);
    if (persian >= 0) { out += String(persian); continue; }
    out += ch === '٫' ? '.' : ch;
  }
  return out;
}

export type QuantityProblem = 'empty' | 'invalid' | 'negative' | 'zero' | 'too_many_decimals' | 'too_large';

export type ParsedQuantity = { ok: true; milliliters: number; liters: string } | { ok: false; problem: QuantityProblem };

/** أكبر قيمة معقولة تُقبل في الواجهة (10 ملايين لتر) — حماية من خطأ كتابة لا سياسة عمل؛ الحدّ الحقيقي يفرضه الخادم. */
const MAX_INTEGER_DIGITS = 7;

/**
 * يقرأ كمية باللترات (حتى ثلاث منازل) ويعيد المللتر الصحيح. الفاصلة العادية والفاصلة العربية للآلاف مرفوضتان (لا تخمين بين «1,500» و«1.500»)؛
 * الكسر يُكتب بنقطة أو ٫. الصفر والسالب مرفوضان، ولا تقريب صامت لأكثر من ثلاث منازل.
 */
export function parseLiters(input: string): ParsedQuantity {
  const value = normalizeDigits(input).trim();
  if (value === '') return { ok: false, problem: 'empty' };
  if (value.startsWith('-')) return { ok: false, problem: 'negative' };
  if (!/^\d+(\.\d+)?$/.test(value)) return { ok: false, problem: 'invalid' };
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > 3) return { ok: false, problem: 'too_many_decimals' };
  const integer = whole.replace(/^0+(?=\d)/, '');
  if (integer.length > MAX_INTEGER_DIGITS) return { ok: false, problem: 'too_large' };
  const milliliters = Number(integer) * 1000 + Number(fraction.padEnd(3, '0'));
  if (!Number.isSafeInteger(milliliters)) return { ok: false, problem: 'too_large' };
  if (milliliters === 0) return { ok: false, problem: 'zero' };
  return { ok: true, milliliters, liters: `${integer}.${fraction.padEnd(3, '0')}` };
}

export type VoucherProblem = 'empty' | 'too_long';
export const VOUCHER_MAX = 64;

/**
 * رقم السند الورقي: يُحفظ **حرفياً** (الأصفار البادئة جزء منه: «04052» ≠ «4052»)، الأرقام العربية ⇒ 0–9، المسافات المتعددة ⇒ مسافة واحدة، والأطراف تُقصّ.
 * هو نص دائماً — لا يمرّ بتحويل رقمي في أي مرحلة.
 */
export function normalizeVoucher(input: string): { ok: true; value: string } | { ok: false; problem: VoucherProblem } {
  const value = normalizeDigits(input).replace(/\s+/g, ' ').trim();
  if (value === '') return { ok: false, problem: 'empty' };
  if (value.length > VOUCHER_MAX) return { ok: false, problem: 'too_long' };
  return { ok: true, value };
}

/** لترات للعرض من mL صحيح (ثلاث منازل). */
export function litersFromMl(milliliters: number): string {
  return `${Math.trunc(milliliters / 1000)}.${String(milliliters % 1000).padStart(3, '0')}`;
}

// ───────────────────────── السياسة والسعة ─────────────────────────

export type OverrunPolicy = 'allow_with_confirmation' | 'block' | 'allow';
export interface TankerPolicy {
  /** `null` = غير معروفة (خادم أقدم/تعذّر القراءة): لا يُحجب شيء بتخمين؛ الخادم يفصل. */
  selectionRequired: boolean | null;
  overrun: OverrunPolicy | null;
}

export function toTankerPolicy(settings: { tanker_selection_required?: boolean; tanker_capacity_overrun_policy?: string } | null | undefined): TankerPolicy {
  const raw = settings?.tanker_capacity_overrun_policy;
  const overrun: OverrunPolicy | null = raw === 'allow_with_confirmation' || raw === 'block' || raw === 'allow' ? raw : null;
  return { selectionRequired: typeof settings?.tanker_selection_required === 'boolean' ? settings.tanker_selection_required : null, overrun };
}

export type CapacityMode = 'none' | 'confirm' | 'block' | 'allow';
export interface CapacityCheck { mode: CapacityMode; overrunMilliliters: number }

/**
 * تجاوز سعة الصهريج: لا فحص بلا صهريج أو بلا سعة معروفة. السياسة غير المعروفة تُعامَل «يتطلب تأكيداً» (الأحوط)؛ والخادم يحسم ويرفض دائماً ما لا تسمح به السياسة.
 */
export function capacityCheck(quantityMl: number | null, tankerCapacityMl: number | null | undefined, policy: OverrunPolicy | null): CapacityCheck {
  if (quantityMl === null || tankerCapacityMl === null || tankerCapacityMl === undefined || tankerCapacityMl <= 0) return { mode: 'none', overrunMilliliters: 0 };
  const overrun = quantityMl - tankerCapacityMl;
  if (overrun <= 0) return { mode: 'none', overrunMilliliters: 0 };
  return { mode: policy === 'block' ? 'block' : policy === 'allow' ? 'allow' : 'confirm', overrunMilliliters: overrun };
}

// ───────────────────────── الفوهات ─────────────────────────

export type NozzleChoiceReason = NozzleBlockReason | 'operation_not_allowed';

export interface NozzleChoice {
  view: NozzleView;
  eligible: boolean;
  reason: NozzleChoiceReason | null;
}

export interface PumpChoices { pump: Pump; nozzles: NozzleChoice[] }

const TANKER_FILL = 'tanker_fill';

/**
 * قابلية الفوهة لتعبئة الصهريج: مشتقة من كتالوج المحطة (فوهة/مضخة/خزان/منتج/محطة نشطة) **و**قيد عمليات الفوهة (`effective_operations` ثم `allowed_operations`؛ `null` = كل العمليات).
 * غياب الحقلين (خادم أقدم) ≠ منع: لا نخمّن، والخادم يرفض `nozzle_operation_not_allowed` إن لزم.
 */
export function nozzleChoice(view: NozzleView): NozzleChoice {
  if (view.blockedBy !== null) return { view, eligible: false, reason: view.blockedBy };
  const { effective_operations: effective, allowed_operations: allowed } = view.nozzle;
  const operations = effective ?? (Array.isArray(allowed) ? allowed : null);
  if (operations !== null && !operations.includes(TANKER_FILL)) return { view, eligible: false, reason: 'operation_not_allowed' };
  return { view, eligible: true, reason: null };
}

export function pumpChoices(catalog: StationCatalog): PumpChoices[] {
  return catalog.pumps
    .map(({ pump, nozzles }) => ({ pump, nozzles: nozzles.map(nozzleChoice) }))
    .filter((group) => group.nozzles.length > 0);
}

export function eligibleNozzleCount(groups: PumpChoices[]): number {
  return groups.reduce((sum, group) => sum + group.nozzles.filter((choice) => choice.eligible).length, 0);
}

// ───────────────────────── المسودة والخطوات ─────────────────────────

export const STEPS = ['owner', 'nozzle', 'quantity', 'review'] as const;
export type Step = (typeof STEPS)[number];

export interface FillDraft {
  ownerId: string | null;
  /** `null` = بلا صهريج (يُسمح به فقط إن كانت السياسة اختيارية أو لا يملك الصاحب صهاريج نشطة). */
  tankerId: string | null;
  nozzleId: string | null;
  quantityInput: string;
  voucherInput: string;
  /** إقرار الموظف بتجاوز السعة (يُرسَل `true` فقط عند الحاجة). */
  confirmOverrun: boolean;
}

export const EMPTY_DRAFT: FillDraft = { ownerId: null, tankerId: null, nozzleId: null, quantityInput: '', voucherInput: '', confirmOverrun: false };

export interface StepContext {
  tankers: Tanker[];
  policy: TankerPolicy;
  eligibleNozzleIds: ReadonlySet<string>;
}

export type StepProblem =
  | 'owner_required' | 'tanker_required' | 'nozzle_required' | 'nozzle_not_eligible'
  | `quantity_${QuantityProblem}` | `voucher_${VoucherProblem}` | 'capacity_blocked' | 'capacity_confirmation_required';

/**
 * أول مشكلة تمنع مغادرة الخطوة (أو `null`). الصهريج: إلزامي حين تكون السياسة «إلزامي» **وللصاحب صهاريج نشطة** (صاحب بلا صهاريج لا يُمنع أبداً — قرار معتمد)،
 * وإلا اختياري. السياسة غير المعروفة ⇒ اختياري (الخادم يرفض `tanker_required` إن لزم فيُعاد الموظف إلى هذه الخطوة).
 */
export function stepProblem(step: Step, draft: FillDraft, ctx: StepContext): StepProblem | null {
  if (step === 'owner') {
    if (!draft.ownerId) return 'owner_required';
    if (ctx.policy.selectionRequired === true && ctx.tankers.length > 0 && !draft.tankerId) return 'tanker_required';
    return null;
  }
  if (step === 'nozzle') {
    if (!draft.nozzleId) return 'nozzle_required';
    return ctx.eligibleNozzleIds.has(draft.nozzleId) ? null : 'nozzle_not_eligible';
  }
  if (step === 'quantity') {
    const quantity = parseLiters(draft.quantityInput);
    if (!quantity.ok) return `quantity_${quantity.problem}`;
    const voucher = normalizeVoucher(draft.voucherInput);
    if (!voucher.ok) return `voucher_${voucher.problem}`;
    const tanker = ctx.tankers.find((row) => row.id === draft.tankerId) ?? null;
    const capacity = capacityCheck(quantity.milliliters, tanker?.capacity_milliliters, ctx.policy.overrun);
    if (capacity.mode === 'block') return 'capacity_blocked';
    if (capacity.mode === 'confirm' && !draft.confirmOverrun) return 'capacity_confirmation_required';
    return null;
  }
  return null;
}

/** أول خطوة بها مشكلة قبل الحفظ (للرجوع إليها عند رفض الخادم أو تغيّر المعطيات)، وإلا `null`. */
export function firstInvalidStep(draft: FillDraft, ctx: StepContext): Step | null {
  for (const step of ['owner', 'nozzle', 'quantity'] as const) if (stepProblem(step, draft, ctx) !== null) return step;
  return null;
}

// ───────────────────────── الحمولة ─────────────────────────

/** حقول الطلب كما يقبلها الخادم (`StoreFuelTankerFillRequest`): بلا `tenant_id` ولا `branch_id` ولا منتج/خزان/مضخة (تُشتق من الفوهة) ولا وقت من العميل. */
export interface FillBody {
  fuel_station_id: string;
  fuel_nozzle_id: string;
  fuel_tanker_owner_id: string;
  fuel_tanker_id?: string;
  fuel_shift_id: string;
  voucher_number: string;
  quantity_milliliters: number;
  confirm_capacity_overrun?: true;
  idempotency_key: string;
}

export type IntentPayload = Omit<FillBody, 'idempotency_key'>;

/** الحمولة بلا المفتاح: بصمة النية. تغيّر أي حقل ⇒ نية جديدة ⇒ مفتاح جديد (الخادم يعيد الأثر الأول لأي مفتاح موجود). */
export function buildIntentPayload(input: { stationId: string; shiftId: string; draft: FillDraft; tankers: Tanker[]; policy: TankerPolicy }): IntentPayload | null {
  const { draft } = input;
  const quantity = parseLiters(draft.quantityInput);
  const voucher = normalizeVoucher(draft.voucherInput);
  if (!draft.ownerId || !draft.nozzleId || !quantity.ok || !voucher.ok) return null;
  const tanker = input.tankers.find((row) => row.id === draft.tankerId) ?? null;
  const capacity = capacityCheck(quantity.milliliters, tanker?.capacity_milliliters, input.policy.overrun);
  return {
    fuel_station_id: input.stationId,
    fuel_nozzle_id: draft.nozzleId,
    fuel_tanker_owner_id: draft.ownerId,
    fuel_shift_id: input.shiftId,
    voucher_number: voucher.value,
    quantity_milliliters: quantity.milliliters,
    ...(tanker ? { fuel_tanker_id: tanker.id } : {}),
    // التأكيد يُرسَل فقط حين يلزم ويقرّه الموظف؛ لا قيمة افتراضية ولا إرسال «تلقائي».
    ...(capacity.mode === 'confirm' && draft.confirmOverrun ? { confirm_capacity_overrun: true as const } : {}),
  };
}

// ───────────────────────── رموز الرفض ─────────────────────────

/** رموز `reason` التي يعيدها الخادم لتسجيل التعبئة (مصدرها `FuelTankerFillException`). غير المعروف ⇒ `validation` مع نص الخادم ثانوياً. */
export const KNOWN_REASONS = [
  'shift_required', 'shift_not_open', 'nozzle_operation_not_allowed', 'equipment_not_operational', 'product_mismatch', 'owner_inactive',
  'tanker_required', 'tanker_mismatch', 'tanker_inactive', 'voucher_duplicate', 'voucher_invalid', 'quantity_invalid',
  'capacity_overrun_blocked', 'capacity_overrun_confirmation_required', 'idempotency_key_reused', 'invalid_input',
] as const;
export type KnownReason = (typeof KNOWN_REASONS)[number];
export const isKnownReason = (value: unknown): value is KnownReason => typeof value === 'string' && (KNOWN_REASONS as readonly string[]).includes(value);

/** الخطوة التي يعود إليها الموظف لتصحيح الرفض (لا تُعاد المحاولة تلقائياً). */
export const REJECTION_STEP: Partial<Record<KnownReason, Step>> = {
  owner_inactive: 'owner', tanker_required: 'owner', tanker_mismatch: 'owner', tanker_inactive: 'owner',
  nozzle_operation_not_allowed: 'nozzle', equipment_not_operational: 'nozzle', product_mismatch: 'nozzle',
  voucher_duplicate: 'quantity', voucher_invalid: 'quantity', quantity_invalid: 'quantity', capacity_overrun_blocked: 'quantity', capacity_overrun_confirmation_required: 'quantity',
};

/** رفض يعني أن الوردية تغيّرت/أُغلقت: تُعاد قراءة الوردية الحالية ولا يُكمَل المعالج على معرّف قديم. */
export const SHIFT_REASONS: readonly KnownReason[] = ['shift_required', 'shift_not_open'];
