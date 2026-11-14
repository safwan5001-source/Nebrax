/**
 * TANKER-PR6B-1 — منطق نقي لبطاقة «إعدادات الدمج المخزني» (الحساب الوسيط، توقيت الاعتراف، سياسة الانحراف، بدء الترحيل، التنبيهات).
 * **تخزين وتحقق وعرض فقط — لا خصم ولا قيد ولا ترحيل.** الخادم هو السلطة (التحقق والحوكمة والتدقيق)؛ هذا الملف يقرأ الاستجابات دفاعياً ويبني الحمولات.
 */
import { isoToZonedLocal } from '@/lib/formatting';

export { isoToZonedLocal };
export const COST_RECOGNITIONS = ['clearing_until_invoice'] as const;
export type CostRecognition = (typeof COST_RECOGNITIONS)[number];
export const VARIANCE_POLICIES = ['block', 'warn'] as const;
export type VariancePolicy = (typeof VARIANCE_POLICIES)[number];

/** رموز مخالفة الحساب الوسيط (تطابق `FuelTankerClearingAccountGuard::REASONS`)؛ رمز مجهول ⇒ `other`. */
export const CLEARING_REASONS = ['not_found', 'group', 'inactive', 'not_asset', 'inventory_account', 'cash_or_bank', 'tax_account', 'reserved_role'] as const;
export type ClearingReason = (typeof CLEARING_REASONS)[number] | 'other';

/** موانع/ملاحظات الإعداد المعلنة من الخادم؛ مجهولها ⇒ `unknown` (نص عام لا يكشف الرمز). */
export const CONFIG_BLOCKERS = ['clearing_account_missing', 'clearing_account_invalid', 'settlement_mode_conflict'] as const;
export const CONFIG_NOTICES = ['posting_start_not_set', 'posting_gate_closed'] as const;

export const SERVER_KEYS = {
  clearing: 'tanker_issue_clearing_account_id',
  cost: 'tanker_cost_recognition',
  variance: 'fuel_pool_ledger_variance_policy',
  start: 'tanker_inventory_posting_start_at',
  alerts: 'tanker_inventory_alerts_enabled',
} as const;
export type PostingField = keyof typeof SERVER_KEYS;
export const POSTING_FIELDS = Object.keys(SERVER_KEYS) as PostingField[];

/** حقول الحوكمة (تتطلب `fuel.governance.manage` مع `fuel_stations.manage`)؛ التنبيهات تكفيها `fuel_stations.manage`. يفرضها الخادم — هذا للعرض فقط. */
export const GOVERNANCE_FIELDS: readonly PostingField[] = ['clearing', 'cost', 'variance', 'start'];
const GOVERNANCE_SERVER_KEYS = new Set<string>(GOVERNANCE_FIELDS.map((field) => SERVER_KEYS[field]));
export const touchesGovernance = (changes: Record<string, unknown>): boolean => Object.keys(changes).some((key) => GOVERNANCE_SERVER_KEYS.has(key));

export interface PostingValues {
  clearingAccountId: string;
  cost: CostRecognition;
  variance: VariancePolicy;
  /** لحظة بدء الترحيل بتوقيت UTC (RFC3339) أو سلسلة فارغة. */
  startAt: string;
  alerts: boolean;
  /** منطقة تشغيل المؤسسة/المحطة لتفسير حقل التاريخ. */
  timezone: string;
}

export const DEFAULT_VALUES: PostingValues = { clearingAccountId: '', cost: 'clearing_until_invoice', variance: 'block', startAt: '', alerts: true, timezone: 'Asia/Riyadh' };

const obj = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const oneOf = <T extends string>(list: readonly T[], value: unknown, fallback: T): T => (typeof value === 'string' && (list as readonly string[]).includes(value) ? (value as T) : fallback);

/** القيم الفعّالة من استجابة إعدادات المؤسسة/المحطة؛ مفتاح غائب أو تالف ⇒ الافتراضي الآمن (لا تخمين). */
export function readValues(raw: unknown): PostingValues {
  const source = obj(raw);
  const zone = text(source.operating_timezone);
  return {
    clearingAccountId: text(source[SERVER_KEYS.clearing]),
    cost: oneOf(COST_RECOGNITIONS, source[SERVER_KEYS.cost], DEFAULT_VALUES.cost),
    variance: oneOf(VARIANCE_POLICIES, source[SERVER_KEYS.variance], DEFAULT_VALUES.variance),
    startAt: text(source[SERVER_KEYS.start]),
    alerts: source[SERVER_KEYS.alerts] !== false,
    timezone: zone !== '' ? zone : DEFAULT_VALUES.timezone,
  };
}

/** الحقول التي للمحطة **تجاوز صريح** لها (`meta.overrides` بمفاتيح الخادم). */
export function overrideFields(serverKeys: unknown): Set<PostingField> {
  const fields = new Set<PostingField>();
  if (!Array.isArray(serverKeys)) return fields;
  for (const field of POSTING_FIELDS) if (serverKeys.includes(SERVER_KEYS[field])) fields.add(field);
  return fields;
}

export interface AccountLabel { id: string; code: string; name: string }
export interface ClearingEvaluation {
  configured: boolean;
  valid: boolean;
  reason: ClearingReason | null;
  /** يُعاد لمن يملك `accounts.view` فقط؛ `null` = مخفي أو غير معيَّن. */
  account: AccountLabel | null;
}
export interface Evaluation {
  clearing: ClearingEvaluation;
  blockers: string[];
  notices: string[];
  postingGateOpen: boolean;
}

export function readEvaluation(payload: unknown): Evaluation {
  const body = obj(payload);
  const data = obj(body.data);
  const meta = obj(body.meta);
  const clearing = obj(data.clearing_account);
  const account = obj(clearing.account);
  const reason = text(clearing.reason);
  const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
  return {
    clearing: {
      configured: clearing.configured === true,
      valid: clearing.valid === true,
      reason: reason === '' ? null : ((CLEARING_REASONS as readonly string[]).includes(reason) ? (reason as ClearingReason) : 'other'),
      account: typeof account.id === 'string' && typeof account.code === 'string' ? { id: account.id, code: account.code, name: text(account.name) } : null,
    },
    blockers: strings(data.blockers),
    notices: strings(data.notices),
    postingGateOpen: meta.posting_gate_open === true,
  };
}

/** رمز مخالفة الحساب الوسيط من رسالة الخادم `FUEL_TANKER_CLEARING_ACCOUNT_INVALID:<reason>: …`؛ غير ذلك ⇒ `null`. */
export function clearingReasonFromMessage(message: string | null | undefined): ClearingReason | null {
  const match = /FUEL_TANKER_CLEARING_ACCOUNT_INVALID:([a-z_]+):/.exec(message ?? '');
  if (!match) return null;
  return (CLEARING_REASONS as readonly string[]).includes(match[1]) ? (match[1] as ClearingReason) : 'other';
}

/** حسابات الأصل النشطة غير التجميعية فقط (تصفية عرض؛ القرار النهائي للخادم: لا حساب مخزون/نقد/بنك/ضريبة/دور آخر). */
export interface LedgerAccount { id: string; code: string; name: string; type: string; is_active: boolean; is_group: boolean }
export function readAccounts(payload: unknown): LedgerAccount[] {
  const data = obj(payload).data;
  if (!Array.isArray(data)) return [];
  return data
    .map(obj)
    .filter((row) => typeof row.id === 'string' && typeof row.code === 'string')
    .map((row) => ({ id: row.id as string, code: row.code as string, name: text(row.name), type: text(row.type), is_active: row.is_active !== false, is_group: row.is_group === true }))
    .sort((a, b) => a.code.localeCompare(b.code, 'en'));
}
export const candidateAccounts = (accounts: readonly LedgerAccount[]): LedgerAccount[] => accounts.filter((account) => account.type === 'asset' && account.is_active && !account.is_group);

// ───────────────────────── المسودة والتغييرات ─────────────────────────

export const INHERIT = 'inherit';
export const UNSET = '';
export type PostingDraft = Record<PostingField, string>;

/**
 * المسودة الابتدائية. نطاق المؤسسة (`overrides = null`): القيم الفعلية. نطاق المحطة: `inherit` لما **لا تجاوز له**، والقيمة لما له تجاوز صريح —
 * فتبقى حالة الوراثة مرئية حتى لو تساوت القيمة الفعّالة مع قيمة المؤسسة.
 */
export function toDraft(values: PostingValues, overrides: ReadonlySet<PostingField> | null = null): PostingDraft {
  const own: PostingDraft = { clearing: values.clearingAccountId, cost: values.cost, variance: values.variance, start: isoToZonedLocal(values.startAt, values.timezone), alerts: String(values.alerts) };
  const draft = {} as PostingDraft;
  for (const field of POSTING_FIELDS) draft[field] = overrides !== null && !overrides.has(field) ? INHERIT : own[field];
  return draft;
}

/** حقل التاريخ المحلي ⇒ لحظة RFC3339 للخادم عبر المحوّل المشترك؛ غير صالح ⇒ `undefined` (يمنع الحفظ). */
export type ToIso = (local: string, timeZone: string) => string | null;

/**
 * المتغيّر عن المسودة الابتدائية فقط (لا طلب عند عدم التغيير). `inherit` ⇒ `null` (مسح تجاوز المحطة)؛ فارغ في نطاق المؤسسة ⇒ `null` (مسح الإعداد).
 * قيمة صريحة بعد `inherit` تُرسَل حتى لو ساوت الفعّالة (تثبيت تجاوز). تاريخ غير صالح ⇒ `invalid` يمنع الحفظ.
 */
export function postingChanges(initial: PostingDraft, draft: PostingDraft, timezone: string, toIso: ToIso): { payload: Record<string, boolean | string | null>; invalid: PostingField[] } {
  const payload: Record<string, boolean | string | null> = {};
  const invalid: PostingField[] = [];
  for (const field of POSTING_FIELDS) {
    if (draft[field] === initial[field]) continue;
    const value = draft[field];
    // نطاق المحطة: إلغاء «موروث» بترك الحقل فارغاً لا يعني شيئاً (لا تجاوز بقيمة غائبة) فلا يُعدّ تغييراً.
    if (initial[field] === INHERIT && value === UNSET) continue;
    if (value === INHERIT || (field === 'clearing' && value === UNSET) || (field === 'start' && value === UNSET)) {
      payload[SERVER_KEYS[field]] = null;
    } else if (field === 'alerts') {
      payload[SERVER_KEYS[field]] = value === 'true';
    } else if (field === 'start') {
      const iso = toIso(value, timezone);
      if (iso === null) invalid.push(field);
      else payload[SERVER_KEYS[field]] = iso;
    } else {
      payload[SERVER_KEYS[field]] = value;
    }
  }
  return { payload, invalid };
}
