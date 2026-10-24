import { apiErrorCode } from '@/modules/payments/gateways/contract';
import type { BadgeTone } from '@/modules/payments/gateways/contract';

/**
 * عقد تبويب «وسائل الدفع» (PAY-SETTINGS-UX) — أنواع ودوال نقية بلا شبكة. مرآة `OnlinePaymentMethodSettingsService::overview()`.
 * الحالة **محسوبة في الخادم** من اتصالات `PaymentGateway` وقدرات المحوّل؛ الواجهة لا تحسب جاهزية ولا تفترض دعماً.
 * «التفعيل» هنا = إظهار الوسيلة للعميل بشرط جاهزية محسوبة؛ لا يقيّد ما تقبله صفحة المزوّد المستضافة.
 */

export const VIEW_PERMISSION = 'payments.view';
export const MANAGE_PERMISSION = 'payment_gateways.manage';

export const METHOD_KEYS = ['mada', 'visa', 'mastercard', 'apple_pay'] as const;
export type MethodKey = (typeof METHOD_KEYS)[number];

export const METHOD_STATUSES = ['enabled', 'disabled', 'needs_setup', 'unsupported'] as const;
export type MethodStatus = (typeof METHOD_STATUSES)[number];

export type MethodReason = 'no_usable_gateway' | 'provider_setup_required';

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
  /** القيمة المخزَّنة (قد تبقى true بينما الحالة `needs_setup` لأن الاتصال عُلّق). */
  enabled: boolean;
  customer_visible: boolean;
  connections: MethodConnection[];
  /** البوابة الفعلية محسوبة (أول اتصال جاهز) لا مخزَّنة. */
  effective_gateway: { id: string; name: string } | null;
  multiple_eligible_gateways: boolean;
  /** دائماً `false` اليوم: لا توجيه متعدد البوابات (H2-04). */
  default_gateway_selectable: boolean;
  usage: { invoices: boolean; store: boolean };
}

export function methodTone(status: MethodStatus): BadgeTone {
  switch (status) {
    case 'enabled': return 'positive';
    case 'needs_setup': return 'warning';
    default: return 'muted';
  }
}

/** الإجراء المطلوب لإكمال الوسيلة (لا يوجد إلا للحالتين غير الجاهزتين). */
export type MethodNextStep = 'add_gateway' | 'activate_gateway' | 'provider_setup' | null;

export function nextStep(method: Pick<OnlineMethod, 'status' | 'reason'>): MethodNextStep {
  if (method.status === 'unsupported') return 'add_gateway';
  if (method.status === 'needs_setup') return method.reason === 'provider_setup_required' ? 'provider_setup' : 'activate_gateway';
  return null;
}

/**
 * يظهر المفتاح قابلاً للتشغيل فقط حين تكون الوسيلة جاهزة (`enabled`/`disabled`) والمستخدم مُدير للبوابات.
 * `needs_setup` و`unsupported` (ومنها Apple Pay ما دام إعداد المزوّد غير قابل للتحقق) لا تُفعَّل من أَوْج.
 */
export function canToggle(method: Pick<OnlineMethod, 'status'> & { enabled?: boolean }, canManage: boolean): boolean {
  // الجاهزة تُشغَّل/تُطفأ؛ ومحفوظة «مفعّلة» لكنها لم تعد جاهزة تُطفأ فقط (لا تظهر لعميل لاحقاً دون إجراء صريح).
  return canManage && (method.status === 'enabled' || method.status === 'disabled' || method.enabled === true);
}

/** محفوظة «مفعّلة» لكنها غير جاهزة الآن: غير ظاهرة للعميل، وستظهر تلقائياً متى عادت الجاهزية ما لم تُطفأ. */
export function isStoredButNotReady(method: Pick<OnlineMethod, 'status' | 'enabled'>): boolean {
  return method.enabled && method.status !== 'enabled';
}

/** سبب تعطيل المفتاح للشرح المرئي (null ⇒ قابل للتشغيل). */
export function toggleBlockReason(method: Pick<OnlineMethod, 'status'>, canManage: boolean): 'no_permission' | 'needs_setup' | 'unsupported' | null {
  if (method.status === 'unsupported') return 'unsupported';
  if (method.status === 'needs_setup') return 'needs_setup';
  return canManage ? null : 'no_permission';
}

/** رموز رفض الخادم المعروفة (تُترجم)؛ غيرها يسقط إلى رسالة عامة. */
export const KNOWN_ERRORS = ['method.unsupported', 'method.needs_setup', 'method.unknown', 'method.reason_too_long'] as const;

export function methodErrorKey(err: unknown): 'unsupported' | 'needs_setup' | 'unknown_method' | 'reason_too_long' | 'generic' {
  switch (apiErrorCode(err)) {
    case 'method.unsupported': return 'unsupported';
    case 'method.needs_setup': return 'needs_setup';
    case 'method.unknown': return 'unknown_method';
    case 'method.reason_too_long': return 'reason_too_long';
    default: return 'generic';
  }
}

export function isMethodKey(value: unknown): value is MethodKey {
  return typeof value === 'string' && (METHOD_KEYS as readonly string[]).includes(value);
}
