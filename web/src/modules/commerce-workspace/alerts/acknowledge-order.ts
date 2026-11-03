import { ApiError, api } from '@/lib/api';

/**
 * الكتابة الوحيدة في مركز التنبيه (COPS-H3-4، ADR-30 §4، R-10): `POST commerce/orders/{id}/acknowledge` — إقرار لكل طلب يُسكت التنبيه على كل الأجهزة والمستخدمين
 * **دون تغيير حالة الطلب أو إخراجه من قوائم العمل**. معزولة في ملف مستقل (يحرسه `alerts-readonly.test.ts`): ملف الاستعلام GET فقط.
 */
export type AcknowledgeOutcome =
  | { ok: true; created: boolean }
  /** `settled`: الخادم رفض بحالة لا تتغير بإعادة المحاولة (404 غير موجود/خارج النطاق، 409 ملغى/غير جاهز، 422): لا حاجة للتنبيه ولا نعيده. */
  | { ok: false; settled: boolean; status: number | null; reason: string | null };

export async function acknowledgeOrder(orderId: string): Promise<AcknowledgeOutcome> {
  try {
    const res = await api<{ data: { created: boolean } }>(`/commerce/orders/${encodeURIComponent(orderId)}/acknowledge`, { method: 'POST' });

    return { ok: true, created: Boolean(res?.data?.created) };
  } catch (error) {
    if (error instanceof ApiError) {
      const body = error.body as { reason?: unknown } | null;
      const reason = typeof body?.reason === 'string' ? body.reason : null;

      return { ok: false, settled: [404, 409, 422].includes(error.status), status: error.status, reason };
    }

    return { ok: false, settled: false, status: null, reason: null };
  }
}
