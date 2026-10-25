import { apiErrorCode } from '@/modules/payments/gateways/contract';
import type { BadgeTone } from '@/modules/payments/gateways/contract';

/**
 * عقد تبويب «وسائل الدفع» (PAY-SETTINGS-UX) — أنواع ودوال نقية بلا شبكة. مرآة `OnlinePaymentMethodSettingsService::overview()`.
 * الحالة **محسوبة في الخادم** من اتصالات `PaymentGateway` وقدرات المحوّل؛ الواجهة لا تحسب جاهزية ولا تفترض دعماً.
 * **مفهومان منفصلان (Beta):** `enabled` اختيار التاجر (إظهار الوسيلة للعميل — يجوز قبل جاهزية أي بوابة) و`ready` جاهزية التحصيل (محسوبة في الخادم).
 * التفعيل لا يجعل التحصيل ممكناً؛ والخادم يرفض أي محاولة دفع بوسيلة غير جاهزة قبل أي محاولة تحصيل. التفعيل لا يقيّد ما تقبله صفحة المزوّد المستضافة.
 */

export const VIEW_PERMISSION = 'payments.view';
export const MANAGE_PERMISSION = 'payment_gateways.manage';

export const METHOD_KEYS = ['mada', 'visa', 'mastercard', 'apple_pay'] as const;
export type MethodKey = (typeof METHOD_KEYS)[number];

export const METHOD_STATUSES = ['enabled', 'enabled_not_ready', 'disabled', 'needs_setup', 'unsupported'] as const;
export type MethodStatus = (typeof METHOD_STATUSES)[number];

export type MethodReason = 'no_gateway' | 'no_usable_gateway' | 'provider_setup_required';

export interface MethodConnection {
  gateway_id: string;
  gateway_name: string;
  provider: string;
  environment: 'sandbox' | 'live';
  usable: boolean;
  requires_provider_setup: boolean;
  eligible: boolean;
}

export interface OnlineMethod {
  key: MethodKey;
  status: MethodStatus;
  reason: MethodReason | null;
  /** اختيار التاجر المخزَّن: تُعرض للعميل (قد يبقى true بينما `ready=false` إن عُلّق الاتصال). */
  enabled: boolean;
  /** جاهزية التحصيل المحسوبة: يوجد اتصال نشط متحقَّق منه يعلن الوسيلة ولا يحتاج إعداد مزوّد غير قابل للتحقق. */
  ready: boolean;
  customer_visible: boolean;
  connections: MethodConnection[];
  /** البوابة الفعلية: الافتراضية المختارة إن جهزت، وإلا (حين لا اختيار) أول اتصال جاهز. لا تحويل تلقائي بين البوابات. */
  effective_gateway: { id: string; name: string } | null;
  /** اتصال اختاره التاجر للوسيلة؛ null ⇒ تلقائي. */
  default_gateway_id: string | null;
  multiple_eligible_gateways: boolean;
  /** يوجد اتصال يعلن الوسيلة فيمكن اختياره افتراضياً. */
  default_gateway_selectable: boolean;
  /** أماكن الاستخدام المحفوظة فعلاً. */
  usage: MethodUsage;
  /** أي أماكن لها تكامل حقيقي (POS لا تكامل له بعد ⇒ لا مفتاح). */
  usage_supported: MethodUsage;
}

export interface MethodUsage {
  invoices: boolean;
  store: boolean;
  pos: boolean;
}

/** مسودة نافذة «إدارة»: ما يُحفظ فعلاً فقط. */
export interface ManageDraft {
  default_gateway_id: string | null;
  use_in_invoices: boolean;
  use_in_store: boolean;
}

export function draftOf(method: Pick<OnlineMethod, 'default_gateway_id' | 'usage'>): ManageDraft {
  return { default_gateway_id: method.default_gateway_id, use_in_invoices: method.usage.invoices, use_in_store: method.usage.store };
}

/** الحقول المتغيّرة فقط (تُرسل إلى PUT)؛ فارغ ⇒ لا شيء للحفظ. */
export function changesOf(method: Pick<OnlineMethod, 'default_gateway_id' | 'usage'>, draft: ManageDraft): Partial<ManageDraft> {
  const base = draftOf(method);
  const out: Partial<ManageDraft> = {};
  if (draft.default_gateway_id !== base.default_gateway_id) out.default_gateway_id = draft.default_gateway_id;
  if (draft.use_in_invoices !== base.use_in_invoices) out.use_in_invoices = draft.use_in_invoices;
  if (draft.use_in_store !== base.use_in_store) out.use_in_store = draft.use_in_store;
  return out;
}

export function methodTone(status: MethodStatus): BadgeTone {
  switch (status) {
    case 'enabled': return 'positive';
    case 'enabled_not_ready':
    case 'needs_setup': return 'warning';
    default: return 'muted';
  }
}

/** الإجراء المطلوب لتصير الوسيلة جاهزة للتحصيل (لا يوجد إلا لغير الجاهزة). */
export type MethodNextStep = 'add_gateway' | 'activate_gateway' | 'provider_setup' | null;

export function nextStep(method: Pick<OnlineMethod, 'ready' | 'reason'>): MethodNextStep {
  if (method.ready) return null;
  if (method.reason === 'no_gateway') return 'add_gateway';
  return method.reason === 'provider_setup_required' ? 'provider_setup' : 'activate_gateway';
}

/** المفتاح يعمل لمن يملك إدارة البوابات فقط؛ الجاهزية لا تمنع التفعيل (Beta) بل تحكم التحصيل. */
export function canToggle(canManage: boolean): boolean {
  return canManage;
}

/** سبب تعطيل المفتاح للشرح المرئي (null ⇒ قابل للتشغيل). */
export function toggleBlockReason(canManage: boolean): 'no_permission' | null {
  return canManage ? null : 'no_permission';
}

/** مفعَّلة (تظهر للعميل) لكن التحصيل غير ممكن الآن. */
export function isEnabledNotReady(method: Pick<OnlineMethod, 'enabled' | 'ready'>): boolean {
  return method.enabled && !method.ready;
}

/** رموز رفض الخادم المعروفة (تُترجم)؛ غيرها يسقط إلى رسالة عامة. */
export const KNOWN_ERRORS = ['method.unknown', 'method.reason_too_long', 'method.default_gateway_invalid'] as const;

export function methodErrorKey(err: unknown): 'unknown_method' | 'reason_too_long' | 'default_gateway_invalid' | 'generic' {
  switch (apiErrorCode(err)) {
    case 'method.unknown': return 'unknown_method';
    case 'method.reason_too_long': return 'reason_too_long';
    case 'method.default_gateway_invalid': return 'default_gateway_invalid';
    default: return 'generic';
  }
}

export function isMethodKey(value: unknown): value is MethodKey {
  return typeof value === 'string' && (METHOD_KEYS as readonly string[]).includes(value);
}
