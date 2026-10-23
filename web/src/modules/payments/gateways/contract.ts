import { ApiError } from '@/lib/api';

/**
 * عقد شاشة اتصالات بوابات الدفع (PAY-H1-05) — أنواع ودوال نقية فقط، بلا شبكة.
 * مرآة `PaymentGatewayResource` (الخادم هو الحاسم: الإخفاء هنا ليس حدّاً أمنياً).
 * الأسرار لا تظهر في أي استجابة: لا نحمل منها إلا مؤشرات `has_*`.
 */

export const GATEWAY_STATUSES = ['draft', 'active', 'suspended', 'revoked'] as const;
export type GatewayStatus = (typeof GATEWAY_STATUSES)[number];

export const GATEWAY_ENVIRONMENTS = ['sandbox', 'live'] as const;
export type GatewayEnvironment = (typeof GATEWAY_ENVIRONMENTS)[number];

/** مزوّدو `PaymentGateway::PROVIDERS`. `custom` = ربط محاسبي يدوي بلا مزوّد (لا محوّل ولا اتصال شبكي). */
export const GATEWAY_PROVIDERS = ['stripe', 'tap', 'paytabs', 'checkout', 'moyasar', 'custom'] as const;
export type GatewayProvider = (typeof GATEWAY_PROVIDERS)[number];

export const MANAGE_PERMISSION = 'payment_gateways.manage';
export const VIEW_PERMISSION = 'payments.view';

export interface GatewayConnection {
  id: string;
  provider: GatewayProvider;
  name: string;
  name_en: string | null;
  environment: GatewayEnvironment;
  status: GatewayStatus;
  is_usable: boolean;
  merchant_reference: string | null;
  publishable_key: string | null;
  has_secret_key: boolean;
  has_webhook_secret: boolean;
  has_extra_credentials: boolean;
  credential_version: number;
  /** نهاية نافذة السماح لسرّ webhook السابق، أو `null` إن انتهت/لم تبدأ. */
  previous_secret_valid_until: string | null;
  verified_at: string | null;
  activated_at: string | null;
  deactivated_at: string | null;
  created_at: string | null;
}

export interface GatewayEvent {
  id: string;
  event_type: string;
  from_status: GatewayStatus | null;
  to_status: GatewayStatus | null;
  credential_version: number | null;
  actor_user_id: string | null;
  reason: string | null;
  /** أسماء الحقول المتغيّرة فقط — لا قيم ولا أسرار. */
  changed_fields: string[] | null;
  occurred_at: string | null;
}

export type GatewayAction = 'edit' | 'rotate' | 'activate' | 'suspend' | 'revoke' | 'delete' | 'events';

export type BadgeTone = 'neutral' | 'muted' | 'positive' | 'warning' | 'negative';

export function statusTone(status: GatewayStatus): BadgeTone {
  switch (status) {
    case 'active': return 'positive';
    case 'suspended': return 'warning';
    case 'revoked': return 'negative';
    default: return 'muted';
  }
}

/** مزوّد حقيقي (له محوّل) يحتاج تحققاً قبل التفعيل؛ `custom` يُفعَّل مباشرة. */
export function isRealProvider(provider: GatewayProvider): boolean {
  return provider !== 'custom';
}

/**
 * سبب منع التفعيل المعروف سلفاً (الخادم يتحقق أيضاً). `verification_required`: اتصال مزوّد حقيقي بلا `verified_at`
 * — زر التحقق يصل مع أول محوّل حقيقي (PAY-H2-01)، فلا نعرض زراً يزيّف التحقق.
 */
export function activationBlock(connection: GatewayConnection): 'verification_required' | null {
  return isRealProvider(connection.provider) && connection.verified_at === null ? 'verification_required' : null;
}

/** الإجراءات المتاحة لاتصال بحالته. من لا يملك `payment_gateways.manage` لا إجراء له (قراءة فقط). */
export function availableActions(connection: GatewayConnection, canManage: boolean): GatewayAction[] {
  if (!canManage) return [];
  switch (connection.status) {
    case 'draft': return ['edit', 'rotate', 'activate', 'delete', 'events'];
    case 'active': return ['edit', 'rotate', 'suspend', 'revoke', 'events'];
    case 'suspended': return ['edit', 'rotate', 'activate', 'revoke', 'delete', 'events'];
    default: return ['events']; // revoked: مرجع تاريخي نهائي
  }
}

/** رمز الخطأ الثابت من `{error:{code}}` (الواجهة تترجم به)، أو `null`. */
export function apiErrorCode(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const code = (err.body as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof code === 'string' ? code : null;
}

/** مفتاح الترجمة لرمز خطأ (next-intl لا يقبل النقطة في المفاتيح): `gateway.has_references` ← `errors.gateway_has_references`. */
export function errorMessageKey(code: string): string {
  return `errors.${code.replace(/\./g, '_')}`;
}

/** رسالة الخادم من `{error:{message}}` أو الجذر، وإلا `null`. */
export function apiErrorMessage(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const body = err.body as { error?: { message?: unknown }; message?: unknown } | null;
  const nested = body?.error?.message;
  if (typeof nested === 'string' && nested !== '') return nested;
  return err.message || null;
}

/** حقول الأسرار الاختيارية: القيم الفارغة تُحذف من الحمولة (فلا تُمسح أسرار قائمة بالخطأ). */
export function secretsPayload(input: {
  secret_key?: string;
  webhook_secret?: string;
}): Partial<Record<'secret_key' | 'webhook_secret', string>> {
  const out: Partial<Record<'secret_key' | 'webhook_secret', string>> = {};
  const secret = input.secret_key?.trim();
  const webhook = input.webhook_secret?.trim();
  if (secret) out.secret_key = secret;
  if (webhook) out.webhook_secret = webhook;
  return out;
}

export function gatewayDisplayName(connection: Pick<GatewayConnection, 'name' | 'name_en'>, locale: string): string {
  return locale === 'en' && connection.name_en ? connection.name_en : connection.name;
}
