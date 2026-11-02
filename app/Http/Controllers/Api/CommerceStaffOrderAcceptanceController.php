<?php

namespace App\Http\Controllers\Api;

use App\Models\CommerceOrder;
use App\Services\Commerce\CommerceOrderAcceptanceException;
use App\Services\Commerce\CommerceOrderCancellationException;
use App\Services\Commerce\CommerceOrderLifecycleService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * COPS-H1-4 (ADR-29 §2.2) — `POST commerce/orders/{id}/accept` و`POST commerce/orders/{id}/reject`. كل المنطق في {@see CommerceOrderLifecycleService};
 * متحكّم مستقل عن متحكّم القراءة (O1a، يحرسه اختبار ساكن).
 *
 * - **القبول:** `commerce.orders.manage` + `EnsureApplicationActive:commerce.storefront` (على المسار)؛ بوابة `commerce.order_acceptance_enabled`
 *   مغلقة ⇒ 404 مطابق لغير الموجود.
 * - **الرفض:** `commerce.orders.manage` (على المسار) **و**`commerce.orders.cancel` (هنا، 403)؛ يُتاح فقط حين **البوابتان** مفتوحتان
 *   (`order_acceptance_enabled` و`order_cancellation_enabled`) وإلا 404 — القبول اليدوي لا يفتح طريقاً خلفياً للإلغاء.
 * - المستخدم المقيَّد بمخازن 403. طلب مستأجر آخر/غير موجود 404 موحَّد (TenantScope؛ لا IDOR). المدخلات: القبول بلا جسم؛ الرفض `note` اختياري ≤ 500.
 * - الأخطاء: 409 `{message, reason}` للحالات، 422 لغير المؤكَّد/المدخل. ناجح: 200 بتفاصيل الموظف نفسها (O1a). المتكرر 200 بلا أثر.
 */
class CommerceStaffOrderAcceptanceController extends ApiController
{
    public function accept(Request $request, string $id, CommerceOrderLifecycleService $lifecycle, CommerceStaffOrderController $read): JsonResponse
    {
        abort_unless((bool) config('commerce.order_acceptance_enabled'), 404);
        $read->guard($request);
        $request->validate(['tenant_id' => ['prohibited']]);

        $order = CommerceStaffOrderController::scopedOrders($request->user())->find($id);
        abort_if($order === null, 404, 'الطلب غير موجود.');

        try {
            $lifecycle->accept($order, $request->user());
        } catch (CommerceOrderAcceptanceException $e) {
            return response()->json(['message' => $e->getMessage(), 'reason' => $e->reason], $e->status);
        }

        return response()->json(['data' => $read->detailData($id, $request->user())]);
    }

    public function reject(Request $request, string $id, CommerceOrderLifecycleService $lifecycle, CommerceStaffOrderController $read): JsonResponse
    {
        abort_unless((bool) config('commerce.order_acceptance_enabled') && (bool) config('commerce.order_cancellation_enabled'), 404);
        abort_unless($request->user()?->hasPermission('commerce.orders.cancel'), 403, 'ليست لديك صلاحية رفض الطلب.');
        $read->guard($request);
        $data = $request->validate([
            'tenant_id' => ['prohibited'],
            'note' => ['sometimes', 'nullable', 'string', 'max:500'],
        ]);

        $order = CommerceStaffOrderController::scopedOrders($request->user())->find($id);
        abort_if($order === null, 404, 'الطلب غير موجود.');

        try {
            $lifecycle->reject($order, $request->user(), $data['note'] ?? null);
        } catch (CommerceOrderCancellationException $e) {
            return response()->json(['message' => $e->getMessage(), 'reason' => $e->reason], $e->status);
        }

        return response()->json(['data' => $read->detailData($id, $request->user())]);
    }
}
