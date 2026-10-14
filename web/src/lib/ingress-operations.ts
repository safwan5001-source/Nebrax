/**
 * عمليات إدارة نقطة الاستقبال الموقّعة المسموح بها: **الإنشاء** (INT-UX-5c) و**تدوير السر** و**التعطيل** (INT-UX-5b)، عبر
 * المسارات القائمة `POST /delivery-connectors` و`…/{id}/rotate-secret` و`…/{id}/disable`. لا إعادة إسناد (5d) ولا مسار آخر.
 *
 * هذا الملف هو **المكان الوحيد** في الواجهة الذي يقرأ حقل السرّ من استجابة الإنشاء أو التدوير. القواعد:
 *  - السرّ قيمة تُعاد من الدالة ولا يُخزَّن هنا ولا في أي وحدة؛ لا `console` ولا تخزين متصفح ولا عنوان URL ولا تحليلات.
 *  - الأخطاء المرمية لا تحمل السرّ ولا جسم الاستجابة المنحرفة: حمولة نجاح غير مفهومة تُرمى خطأً **بلا حالة HTTP**
 *    فيصنَّف «نتيجة مجهولة» (الخادم قد دوّر فعلاً) ولا تُعاد المحاولة تلقائياً.
 *  - وضع المعاينة (Demo) لا يصل إلى هنا أبداً بنتيجة مختلقة: يُرمى خطأ ثابت ولا يُرسل شيء ولا يُولَّد سرّ.
 */

import { api } from '@/lib/api';
import { isDemo } from '@/lib/demo';

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** حدّ أمان على طول السرّ المقبول من الخادم (السرّ الحقيقي أقصر بكثير)، ولا مسافات داخله. */
const SECRET_MAX = 512;

export interface RotatedSecret {
  /** القيمة الكاملة الجديدة. تُعرض في حوار الكشف لمرة واحدة ثم تُمسح من حالة الواجهة. */
  value: string;
}

/** خطأ ثابت بلا `status`: يصنَّف نتيجةً مجهولة. لا يحمل أي بيانات من الاستجابة. */
export class IngressResponseUnreadable extends Error {
  constructor() {
    super('ingress response unreadable');
    this.name = 'IngressResponseUnreadable';
  }
}

/** مدخل لا يصلح للإرسال أصلاً (لم يُرسل شيء): نتيجته معلومة، لا مجهولة. */
export class IngressRequestInvalid extends Error {
  constructor() {
    super('ingress request invalid');
    this.name = 'IngressRequestInvalid';
  }
}

/** وضع المعاينة: لا طلب ولا سرّ مختلق. */
export class IngressUnavailableInDemo extends Error {
  constructor() {
    super('ingress management unavailable in demo');
    this.name = 'IngressUnavailableInDemo';
  }
}

function readSecret(payload: unknown): RotatedSecret {
  const value = (payload as { secret?: unknown } | null)?.secret;
  if (typeof value !== 'string' || value.length === 0 || value.length > SECRET_MAX || /\s/.test(value)) {
    throw new IngressResponseUnreadable();
  }
  return { value };
}

export interface CreateIngressInput {
  /** ملف الإسناد اليدوي المفعّل للمنصة (من `GET /delivery-platforms`). */
  profileId: string;
  /** معرّف المتجر بعد `checkStoreId` (مقصوص، ≤191 بايت، بلا أحرف تحكم). */
  storeId: string;
  /** فرع الوجهة من خيارات المستخدم، أو `null` = بلا فرع (الخادم يقرّر إن كان ذلك جائزاً لهذا المستخدم). */
  branchId: string | null;
}

/**
 * ينشئ نقطة استقبال ويعيد السرّ مرة واحدة. **غير idempotent**: تكرار الطلب بعد استجابة ضائعة يردّ 409 ولا يعيد السرّ، فلا يُكرَّر
 * تلقائياً أبداً. الجسم هو الحقول الثلاثة التي يقبلها الخادم وحدها؛ المستأجر من الجلسة.
 */
export async function createIngressPoint(input: CreateIngressInput): Promise<RotatedSecret> {
  if (isDemo()) throw new IngressUnavailableInDemo();
  if (!ID_PATTERN.test(input.profileId) || (input.branchId !== null && !ID_PATTERN.test(input.branchId)) || input.storeId.length === 0) {
    throw new IngressRequestInvalid();
  }
  const body: Record<string, string> = { delivery_platform_profile_id: input.profileId, external_store_id: input.storeId };
  if (input.branchId !== null) body.branch_id = input.branchId;
  return readSecret(await api<unknown>('/delivery-connectors', { method: 'POST', body }));
}

function target(id: string, action: 'rotate-secret' | 'disable'): string {
  if (!ID_PATTERN.test(id)) throw new IngressResponseUnreadable();
  return `/delivery-connectors/${id}/${action}`;
}

/** يدوّر السرّ ويعيد القيمة الجديدة. أي فشل يُرمى كما هو؛ التصنيف في `classifyIngressFailure`. */
export async function rotateIngressSecret(id: string): Promise<RotatedSecret> {
  if (isDemo()) throw new IngressUnavailableInDemo();
  return readSecret(await api<unknown>(target(id, 'rotate-secret'), { method: 'POST' }));
}

/**
 * يعطّل النقطة (لا رجعة منها من هذه الواجهة). الخادم idempotent: تكرار الطلب لا يُنشئ حدثاً ثانياً ويبقي `disabled_at` الأول.
 * النجاح = استجابة 2xx بحالة `disabled`؛ غير ذلك يُعامل نتيجةً مجهولة.
 */
export async function disableIngress(id: string): Promise<void> {
  if (isDemo()) throw new IngressUnavailableInDemo();
  const payload = await api<unknown>(target(id, 'disable'), { method: 'POST' });
  const status = (payload as { data?: { status?: unknown } } | null)?.data?.status;
  if (status !== 'disabled') throw new IngressResponseUnreadable();
}
