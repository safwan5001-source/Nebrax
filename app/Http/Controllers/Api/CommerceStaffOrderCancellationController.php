<?php

namespace App\Http\Controllers\Api;

use App\Models\CommerceOrder;
use App\Services\Commerce\CommerceOrderCancellationException;
use App\Services\Commerce\CommerceOrderLifecycleService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * COMMERCE-ORDERS-O3a-2b — `POST commerce/orders/{id}/cancel` (ADR-28 §5.1). الكتابة الوحيدة الجديدة في مساحة طلبات الموظف؛ كل المنطق في
 * {@see CommerceOrderLifecycleService}. متحكّم مستقل عن {@see CommerceStaffOrderController} (القراءة فقط يحرسه اختبار ساكن).
 *
 * - الصلاحية `commerce.orders.cancel` (owner/admin عبر `*` فقط) + `EnsureApplicationActive:commerce.storefront` على المسار.
 * - بوابة النشر `commerce.order_cancellation_enabled` (مغلقة افتراضياً) ⇒ 404 مطابق لغير الموجود.
 * - المستخدم المقيَّد بمخازن 403 (كالقراءة O1a). طلب مستأجر آخر/غير موجود 404 موحَّد (TenantScope؛ لا IDOR).
 * - الأخطاء: 409 `{message, reason}` لرموز المصفوفة، 422 للمسودة ولمدخل غير صالح.
 * - ناجح: 200 بتفاصيل الموظف نفسها (O1a). الإلغاء المتكرر 200 بلا أي أثر جديد.
 */
class CommerceStaffOrderCancellationController extends ApiController
{
    public function cancel(Request $request, string $id, CommerceOrderLifecycleService $lifecycle, CommerceStaffOrderController $read): JsonResponse
    {
        abort_unless((bool) config('commerce.order_cancellation_enabled'), 404);
        $read->guard($request);

        // `reason_code` اسم ADR-28 الأصلي؛ `reason` اسم التكليف المعتمد — يُقبلان (الأول فقط إن غاب الثاني).
        if (! $request->has('reason') && $request->has('reason_code')) {
            $request->merge(['reason' => $request->input('reason_code')]);
        }
        $data = $request->validate([
            'reason' => ['required', 'string', Rule::in(CommerceOrder::CANCELLATION_REASONS)],
            'note' => ['sometimes', 'nullable', 'string', 'max:500', 'required_if:reason,other'],
        ]);

        $order = CommerceOrder::query()->find($id);
        abort_if($order === null, 404, 'الطلب غير موجود.');

        try {
            $lifecycle->cancel($order, $request->user(), $data['reason'], $data['note'] ?? null);
        } catch (CommerceOrderCancellationException $e) {
            return response()->json(['message' => $e->getMessage(), 'reason' => $e->reason], $e->status);
        }

        return response()->json(['data' => $read->detailData($id, $request->user())]);
    }
}
