/**
 * عمليتا إدارة نقطة الاستقبال الموقّعة المسموح بهما في INT-UX-5b: **تدوير السر** و**التعطيل**، عبر المسارين القائمين
 * `POST /delivery-connectors/{id}/rotate-secret` و`POST /delivery-connectors/{id}/disable`. لا إنشاء ولا إعادة إسناد
 * (5c/5d)، ولا مسار آخر.
 *
 * هذا الملف هو **المكان الوحيد** في الواجهة الذي يقرأ حقل السرّ من استجابة التدوير. القواعد:
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

/** وضع المعاينة: لا طلب ولا سرّ مختلق. */
export class IngressUnavailableInDemo extends Error {
  constructor() {
    super('ingress management unavailable in demo');
    this.name = 'IngressUnavailableInDemo';
  }
}

function target(id: string, action: 'rotate-secret' | 'disable'): string {
  if (!ID_PATTERN.test(id)) throw new IngressResponseUnreadable();
  return `/delivery-connectors/${id}/${action}`;
}

/** يدوّر السرّ ويعيد القيمة الجديدة. أي فشل يُرمى كما هو؛ التصنيف في `classifyIngressFailure`. */
export async function rotateIngressSecret(id: string): Promise<RotatedSecret> {
  if (isDemo()) throw new IngressUnavailableInDemo();
  const payload = await api<unknown>(target(id, 'rotate-secret'), { method: 'POST' });
  const value = (payload as { secret?: unknown } | null)?.secret;
  if (typeof value !== 'string' || value.length === 0 || value.length > SECRET_MAX || /\s/.test(value)) {
    throw new IngressResponseUnreadable();
  }
  return { value };
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
