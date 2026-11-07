import { litersToMilliliters, millilitersToLiters } from '@/lib/fuel-quantity';
import { minorToRiyal, riyalToMinor } from '@/lib/money';
import { normalizeDecimalInput } from '@/lib/decimal-input';
import type { OpeningAccount, OpeningDoc } from './schemas';

/**
 * PR-2 — منطق معالج الرصيد الافتتاحي (دوال نقية بلا I/O).
 *
 * المبدأ: **لا قيمة افتراضية لكمية أو تكلفة أو حساب**. الحقل الفارغ ليس صفراً. والتحقق هنا يمنع إرسال ما سيُرفض حتماً لكن **الخادم هو السلطة**
 * (السعة، المجمّع الفارغ، الفترة، الحساب، الصلاحيات) ويُعاد عرض موانعه كما هي.
 */

export const STEPS = ['tanks', 'cost', 'review'] as const;
export type StepId = (typeof STEPS)[number];

export interface TankInfo { id: string; name: string; productId: string; capacityMl: number; active: boolean }

export interface WizardForm {
  /** اللترات كما كتبها المستخدم (نص خام) لكل خزان. الفارغ = لا سطر. */
  quantities: Record<string, string>;
  /** تكلفة اللتر بالريال (نص خام) لكل منتج وقود. */
  costs: Record<string, string>;
  date: string;
  notes: string;
  allowZeroCost: boolean;
  /** الحساب المختار لهذه الجلسة؛ `null` = لم يُغيَّر (يُستعمل المعيَّن فعلاً). */
  accountId: string | null;
  /** نطاق حفظ الحساب: المحطة (الافتراضي) أو افتراضي المؤسسة (متقدم). */
  accountScope: 'station' | 'org';
}

export const EMPTY_FORM: WizardForm = { quantities: {}, costs: {}, date: '', notes: '', allowZeroCost: false, accountId: null, accountScope: 'station' };

// ───────────────────────── الكميات ─────────────────────────

export type QuantityIssue = 'invalid' | 'zero' | 'exceeds_capacity' | 'tank_inactive';

export type QuantityState =
  | { kind: 'empty' }
  | { kind: 'ok'; ml: number }
  | { kind: 'issue'; issue: QuantityIssue };

/** لترات المستخدم (حتى 3 منازل) ⇒ mL صحيح موجب. الفراغ لا سطر. الصفر مرفوض (الخزان الفارغ يُترك فارغاً). `1,500` الملتبسة تُرفض. */
export function quantityState(tank: TankInfo, raw: string): QuantityState {
  if (raw.trim() === '') return { kind: 'empty' };
  if (!tank.active) return { kind: 'issue', issue: 'tank_inactive' };
  const ml = litersToMilliliters(raw, true);
  if (ml === null) return { kind: 'issue', issue: 'invalid' };
  if (ml === 0) return { kind: 'issue', issue: 'zero' };
  if (tank.capacityMl > 0 && ml > tank.capacityMl) return { kind: 'issue', issue: 'exceeds_capacity' };
  return { kind: 'ok', ml };
}

export interface TanksEvaluation {
  states: Record<string, QuantityState>;
  lines: Array<{ tank: TankInfo; ml: number }>;
  hasIssue: boolean;
  totalMl: number;
  canContinue: boolean;
}

export function evaluateTanks(tanks: readonly TankInfo[], form: Pick<WizardForm, 'quantities'>): TanksEvaluation {
  const states: Record<string, QuantityState> = {};
  const lines: TanksEvaluation['lines'] = [];
  let hasIssue = false;
  for (const tank of tanks) {
    const state = quantityState(tank, form.quantities[tank.id] ?? '');
    states[tank.id] = state;
    if (state.kind === 'issue') hasIssue = true;
    if (state.kind === 'ok') lines.push({ tank, ml: state.ml });
  }
  const totalMl = lines.reduce((sum, line) => sum + line.ml, 0);
  return { states, lines, hasIssue, totalMl, canContinue: lines.length > 0 && !hasIssue };
}

// ───────────────────────── التكلفة ─────────────────────────

export type CostIssue = 'invalid' | 'zero_needs_approval' | 'required';
export type CostState = { kind: 'empty' } | { kind: 'ok'; minor: number } | { kind: 'issue'; issue: CostIssue };

/**
 * تكلفة اللتر بالريال ⇒ هللات صحيحة. الخادم يقبل **هللة كاملة للتر** فأكثر من منزلتين عشريتين مرفوض (لا تقريب صامت). الصفر لا يُقبل إلا بموافقة المستند.
 */
export function costState(raw: string, allowZero: boolean): CostState {
  if (raw.trim() === '') return { kind: 'empty' };
  if (normalizeDecimalInput(raw, 2) === null) return { kind: 'issue', issue: 'invalid' };
  const minor = riyalToMinor(raw);
  if (!Number.isSafeInteger(minor) || minor < 0) return { kind: 'issue', issue: 'invalid' };
  if (minor === 0 && !allowZero) return { kind: 'issue', issue: 'zero_needs_approval' };
  return { kind: 'ok', minor };
}

export interface ProductSummary { productId: string; ml: number; tankCount: number }

export function productTotals(lines: TanksEvaluation['lines']): ProductSummary[] {
  const map = new Map<string, ProductSummary>();
  for (const { tank, ml } of lines) {
    const entry = map.get(tank.productId) ?? { productId: tank.productId, ml: 0, tankCount: 0 };
    entry.ml += ml;
    entry.tankCount += 1;
    map.set(tank.productId, entry);
  }
  return [...map.values()];
}

export interface CostEvaluation {
  states: Record<string, CostState>;
  /** هل تُطلب التكلفة من هذا المستخدم؟ (سلطة التكلفة المالية). */
  required: boolean;
  complete: boolean;
}

export function evaluateCosts(products: readonly ProductSummary[], form: Pick<WizardForm, 'costs' | 'allowZeroCost'>, canRecordCost: boolean): CostEvaluation {
  const states: Record<string, CostState> = {};
  let complete = true;
  for (const product of products) {
    const state = costState(form.costs[product.productId] ?? '', form.allowZeroCost);
    states[product.productId] = state;
    if (canRecordCost && state.kind !== 'ok') complete = false;
    if (state.kind === 'issue') complete = false;
  }
  return { states, required: canRecordCost, complete };
}

// ───────────────────────── الحساب ─────────────────────────

/** المؤهَّل لحساب الأرصدة الافتتاحية: حقوق ملكية نشط وحركي (نفس شرط الخادم). الباقي لا يُعرض أصلاً. */
export function eligibleAccounts(accounts: readonly OpeningAccount[]): OpeningAccount[] {
  return accounts.filter((account) => account.type === 'equity' && account.is_active && !account.is_group).sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));
}

export type AccountSource = 'station' | 'org' | 'none';

/** مصدر الحساب المعيَّن: مساوٍ لافتراضي المؤسسة ⇒ موروث، وإلا تخصيص محطة. */
export function accountSource(effective: string | null, tenantDefault: string | null): AccountSource {
  if (!effective) return 'none';
  return effective === tenantDefault ? 'org' : 'station';
}

export interface AccountPlan {
  /** الحساب الذي ستُجرى به المعاينة والترحيل. */
  accountId: string | null;
  /** يلزم كتابة إعداد (الحساب المختار يخالف المعيَّن فعلاً)؟ */
  needsWrite: boolean;
  scope: 'station' | 'org';
}

export function planAccount(form: Pick<WizardForm, 'accountId' | 'accountScope'>, effective: string | null, source: AccountSource): AccountPlan {
  const chosen = form.accountId ?? effective;
  // نطاق المؤسسة متاح فقط لمحطة بلا تخصيص خاص (وإلا ما تغيّر الافتراضي لن يغيّر ما تراه هذه المحطة).
  const scope = form.accountScope === 'org' && source !== 'station' ? 'org' : 'station';
  return { accountId: chosen, needsWrite: !!chosen && chosen !== effective, scope };
}

// ───────────────────────── الجسم ─────────────────────────

export interface DraftBody {
  opening_date: string;
  notes?: string;
  allow_zero_cost?: boolean;
  lines: Array<{ fuel_tank_id: string; quantity_liters: string }>;
  costs?: Array<{ fuel_product_id: string; unit_cost_per_liter_minor: number }>;
}

export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** الجسم الذي يُرسَل للخادم. اللترات تُرسَل نصاً قانونياً (لا float). `costs` تُرسَل فقط لمن يملك سلطتها وبعد اكتمالها. */
export function buildDraftBody(input: { date: string; notes: string; allowZeroCost: boolean; lines: TanksEvaluation['lines']; costs: CostEvaluation; canRecordCost: boolean; products: readonly ProductSummary[] }): DraftBody {
  const body: DraftBody = {
    opening_date: input.date,
    lines: input.lines.map(({ tank, ml }) => ({ fuel_tank_id: tank.id, quantity_liters: millilitersToLiters(ml) })),
  };
  const notes = input.notes.trim();
  if (notes !== '') body.notes = notes;
  if (input.allowZeroCost) body.allow_zero_cost = true;
  if (input.canRecordCost) {
    body.costs = input.products.map((product) => {
      const state = input.costs.states[product.productId];
      return { fuel_product_id: product.productId, unit_cost_per_liter_minor: state?.kind === 'ok' ? state.minor : 0 };
    });
  }
  return body;
}

/** بصمة الحمولة: نفسها ⇒ لا إعادة حفظ للمسودة، وهي مفتاح نية الإنشاء. */
export function bodyFingerprint(stationId: string, body: DraftBody): string {
  return JSON.stringify({ stationId, body });
}

// ───────────────────────── الاستئناف ─────────────────────────

/** يملأ النموذج من مسودة موجودة في الخادم (الكميات من السطور، والتكلفة فقط إن وصلت للمستخدم). */
export function formFromDraft(doc: OpeningDoc): WizardForm {
  const quantities: Record<string, string> = {};
  const costs: Record<string, string> = {};
  for (const line of doc.lines ?? []) {
    quantities[line.tank_id] = line.quantity_liters ?? millilitersToLiters(line.quantity_milliliters);
    if (typeof line.unit_cost_per_liter_minor === 'number') costs[line.fuel_product_id] = minorToRiyal(line.unit_cost_per_liter_minor);
  }
  return { ...EMPTY_FORM, quantities, costs, date: doc.opening_date, notes: doc.notes ?? '', allowZeroCost: doc.allow_zero_cost === true };
}

/** التاريخ المحلي YYYY-MM-DD للجهاز — قيمة مبدئية قابلة للتعديل فقط؛ الخادم يرفض المستقبلي بتاريخ المحطة. */
export function todayLocal(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// ───────────────────────── حسم النتيجة غير المؤكدة ─────────────────────────

/**
 * هل المسودة في الخادم تطابق ما أرسلناه؟ تُستعمل لحسم «انقطع الاتصال بعد الإرسال» بالقراءة لا بإعادة الإرسال.
 * تقارن التاريخ والكميات (mL) لكل خزان، وتقارن التكلفة فقط إن كانت ظاهرة في الاستجابة (من لا يرى التكلفة لا تصله).
 */
export function draftMatchesBody(doc: OpeningDoc, body: DraftBody): boolean {
  if (doc.opening_date !== body.opening_date) return false;
  const lines = doc.lines ?? [];
  if (lines.length !== body.lines.length) return false;
  for (const sent of body.lines) {
    const sentMl = litersToMilliliters(sent.quantity_liters, true);
    const found = lines.find((line) => line.tank_id === sent.fuel_tank_id);
    if (!found || sentMl === null || found.quantity_milliliters !== sentMl) return false;
  }
  for (const cost of body.costs ?? []) {
    const lineWithCost = lines.find((line) => line.fuel_product_id === cost.fuel_product_id && typeof line.unit_cost_per_liter_minor === 'number');
    if (lineWithCost && lineWithCost.unit_cost_per_liter_minor !== cost.unit_cost_per_liter_minor) return false;
  }
  return true;
}

// ───────────────────────── فصل المعتمِد ─────────────────────────

/**
 * هل يمنع **فصل المعتمِد** (FUEL-B2) هذا المستخدم من اعتماد هذه المسودة؟ الخادم هو السلطة (`FUEL_DISTINCT_APPROVER_REQUIRED` عند الترحيل)؛ هذا إدراك مسبق يوفّر
 * على المستخدم نقرة تُرفض حتماً. السياسة غير المعروفة (`null`) أو مسودة بلا منشئ معروف ⇒ لا حجب مسبق. لا يتجاوز المعالج هذا الضابط ولا يغيّره.
 */
export function blockedByDistinctApprover(policy: boolean | null, createdBy: string | null | undefined, viewerId: string): boolean {
  return policy === true && !!createdBy && createdBy === viewerId;
}
