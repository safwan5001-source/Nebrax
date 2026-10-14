/**
 * أساس إدارة نقاط الاستقبال الموقّعة (INT-UX-5a) — منطق نقيّ بلا شبكة ولا واجهة ولا حالة.
 *
 * **لا يُفعِّل أي إجراء.** يحدّد فقط (١) من يحق له رؤية كل إجراء وفق الصلاحيات القائمة دون توسيعها،
 * و(٢) كيف يُصنَّف فشل طلب إدارة إلى رسالة آمنة من قاموس ثابت — **لا نصّ خادم يُعرض أبداً** — مع تمييز
 * «النتيجة مجهولة» (انقطاع/خطأ خادم بعد أن قد يكون الخادم أتمّ العملية): الإنشاء والتدوير يثبتان في الخادم قبل وصول
 * الاستجابة، فإن ضاعت ضاع السرّ ولا تجوز إعادة المحاولة العمياء (الإنشاء المكرّر يردّ 409 والتدوير المكرّر يبطل
 * سرّاً لم يُحفظ). التعطيل وإعادة الإسناد idempotent فتكرارهما آمن.
 *
 * مصدر الحقائق: `DLV-INTEGRATIONS-UX-DESIGN-1.md` (INT-UX-5، §5.7، §9.4) وقرارات المالك D1–D10.
 */

import { hasPermission } from '@/lib/permissions';

export const INGRESS_MANAGE_PERMISSION = 'delivery_connector.manage';
export const INGRESS_REASSIGN_PERMISSION = 'delivery_connector.reassign';
/** منتقي المشغّل يقرأ قائمة المستخدمين من `GET /users` (صلاحية مختلفة عن إعادة الإسناد). */
export const USERS_VIEW_PERMISSION = 'users.view';

export type IngressOperation = 'create' | 'rotate' | 'disable' | 'reassign';

export interface IngressActionAvailability {
  create: boolean;
  rotate: boolean;
  disable: boolean;
  reassign: boolean;
}

/**
 * ما يُعرض من إجراءات. الإجراء غير المتاح **غائب** لا معطَّل (نمط Horizon §5.9). الصلاحيات من قائمة الخادم
 * لا من اسم الدور. لا صلاحية جديدة: الإنشاء والتدوير والتعطيل = `delivery_connector.manage`؛ إعادة الإسناد تتطلب
 * `delivery_connector.reassign` **و**`users.view` معاً (قرار D3).
 *
 * `point === null` = لا نقطة محدّدة (مثل زرّ «إنشاء» على اللوحة). التدوير والتعطيل لا يُعرضان لنقطة **معطّلة** (D5):
 * الخادم لا يمنع تدوير معطَّلة، لكن الواجهة لا تعرضه. إعادة الإسناد لا تعتمد على الحالة هنا (يُحسم في 5d).
 */
export function ingressActionAvailability(
  permissions: string[] | undefined,
  role: string | undefined,
  point: { status: 'configured' | 'disabled' } | null,
): IngressActionAvailability {
  const manage = hasPermission(permissions, role, INGRESS_MANAGE_PERMISSION);
  const reassign = hasPermission(permissions, role, INGRESS_REASSIGN_PERMISSION) && hasPermission(permissions, role, USERS_VIEW_PERMISSION);
  const configured = point !== null && point.status === 'configured';
  return {
    create: manage,
    rotate: manage && configured,
    disable: manage && configured,
    reassign: reassign && point !== null,
  };
}

/** رموز `error_code` التي يردّها الخادم في مسارات الإدارة (DeliveryConnectorException). */
export const KNOWN_INGRESS_ERROR_CODES = [
  'mapping_ambiguous',
  'profile_unavailable',
  'branch_unavailable',
  'branch_inactive',
  'branch_required',
  'invalid_store',
  'operator_ineligible',
  'connector_unavailable',
  'tenant_required',
] as const;

export type KnownIngressErrorCode = (typeof KNOWN_INGRESS_ERROR_CODES)[number];

/** مفاتيح الرسائل تحت `integrationCenter.ingressManagement.errors`. */
export type IngressErrorKey =
  | 'mappingAmbiguous'
  | 'profileUnavailable'
  | 'branchUnavailable'
  | 'branchInactive'
  | 'branchRequired'
  | 'invalidStore'
  | 'operatorIneligible'
  | 'connectorUnavailable'
  | 'tenantRequired'
  | 'forbidden'
  | 'notFound'
  | 'validation'
  | 'conflict'
  | 'outcomeUnknown'
  | 'serverError'
  | 'disableOutcomeUnknown'
  | 'createBlocked'
  | 'reassignOutcomeUnknown'
  | 'demoUnavailable'
  | 'unknown';

const CODE_TO_KEY: Record<KnownIngressErrorCode, IngressErrorKey> = {
  mapping_ambiguous: 'mappingAmbiguous',
  profile_unavailable: 'profileUnavailable',
  branch_unavailable: 'branchUnavailable',
  branch_inactive: 'branchInactive',
  branch_required: 'branchRequired',
  invalid_store: 'invalidStore',
  operator_ineligible: 'operatorIneligible',
  connector_unavailable: 'connectorUnavailable',
  tenant_required: 'tenantRequired',
};

export interface IngressFailure {
  /** مفتاح رسالة ثابتة من القاموس؛ لا يُعرض نصّ الخادم أبداً. */
  messageKey: IngressErrorKey;
  /** الرمز المعروف إن وُجد (للاختبار والتتبّع غير الحسّاس). */
  code: KnownIngressErrorCode | null;
  /**
   * قد يكون الخادم أتمّ العملية دون أن تصل الاستجابة (انقطاع أو خطأ خادم). للإنشاء والتدوير يعني أن السرّ ربما
   * وُلد وضاع: يُوجَّه المستخدم إلى تحديث القائمة ثم التدوير، **لا** إلى إعادة المحاولة.
   */
  outcomeUnknown: boolean;
  /** هل يُعرض زرّ «إعادة المحاولة» لهذا الفشل. دائماً `false` عندما تكون النتيجة مجهولة للإنشاء/التدوير. */
  retryable: boolean;
}

function statusOf(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : null;
}

function codeOf(error: unknown): KnownIngressErrorCode | null {
  const body = (error as { body?: unknown } | null)?.body;
  const code = body !== null && typeof body === 'object' ? (body as { error_code?: unknown }).error_code : undefined;
  return typeof code === 'string' && (KNOWN_INGRESS_ERROR_CODES as readonly string[]).includes(code) ? (code as KnownIngressErrorCode) : null;
}

/**
 * تصنيف فشل طلب إدارة. أخطاء 4xx الصريحة نتيجتها **معلومة** (لم يتغيّر شيء). الانقطاع (بلا حالة HTTP) وأخطاء
 * 5xx نتيجتها **مجهولة**: للإنشاء والتدوير لا إعادة محاولة (D8)، وللتعطيل وإعادة الإسناد (idempotent) إعادة المحاولة آمنة.
 * 401 تعالجه طبقة `api` عالمياً بإعادة التوجيه ولا يُصنَّف هنا.
 */
export function classifyIngressFailure(error: unknown, operation: IngressOperation): IngressFailure {
  const status = statusOf(error);
  const code = codeOf(error);

  if (code !== null) {
    // الرمز المعروف يحدّد الرسالة؛ كلها فشل صريح لم يغيّر شيئاً، وقابلة للتصحيح ثم الإعادة (ما عدا ما سيُصلحه المستخدم).
    return { messageKey: CODE_TO_KEY[code], code, outcomeUnknown: false, retryable: false };
  }

  if (status === null || status >= 500) {
    const mutatesSecret = operation === 'create' || operation === 'rotate';
    return {
      messageKey: mutatesSecret ? 'outcomeUnknown' : 'serverError',
      code: null,
      outcomeUnknown: true,
      retryable: !mutatesSecret,
    };
  }

  const byStatus: Record<number, IngressErrorKey> = { 403: 'forbidden', 404: 'notFound', 409: 'conflict', 422: 'validation' };
  return { messageKey: byStatus[status] ?? 'unknown', code: null, outcomeUnknown: false, retryable: false };
}
