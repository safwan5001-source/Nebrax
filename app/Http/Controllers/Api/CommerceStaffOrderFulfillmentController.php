<?php

namespace App\Http\Controllers\Api;

use App\Models\CommerceOrder;
use App\Services\Commerce\CommerceOrderFulfillmentException;
use App\Services\Commerce\CommerceOrderFulfillmentService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * COPS-H2-1 (ADR-29 §2.3 · خطة H2-0) — إجراءات تنفيذ طلب المتجر: `POST commerce/orders/{id}/fulfillment/{action}` و`PATCH commerce/orders/{id}/fulfillment`.
 * كل المنطق في {@see CommerceOrderFulfillmentService} (الكاتب الوحيد)؛ متحكّم مستقل عن متحكّم القراءة (يحرسه اختبار ساكن).
 *
 * - الصلاحية `commerce.orders.manage` + `EnsureApplicationActive:commerce.storefront` على المسار (D-H2-12: لا صلاحية جديدة). بوابة
 *   `commerce.order_fulfillment_enabled` مغلقة ⇒ 404 مطابق لغير الموجود. المستخدم المقيَّد بمخازن 403 (حتى H2-2). طلب مستأجر آخر/غير موجود 404 موحَّد
 *   **قبل** أي 428/422 (لا يكشف وجود الطلب).
 * - الجسم: `expected_version` (إلزامي، 428 بدونه؛ 0 = لا صف)، وللإجراء `fail`: `reason` (+`note`)؛ وتفاصيل اختيارية. مفاتيح غير معروفة ⇒ 422.
 * - أخطاء: `{message, reason[, current_version, current_status]}` برمز HTTP من الاستثناء (409/422/428). ناجح: 200 بتفاصيل الموظف نفسها (O1a).
 */
class CommerceStaffOrderFulfillmentController extends ApiController
{
    private const ACTION_KEYS = ['expected_version', 'reason', 'note', 'carrier_name', 'tracking_number', 'tracking_url', 'courier_name', 'courier_phone'];

    private const DETAIL_KEYS = ['expected_version', 'type', 'carrier_name', 'tracking_number', 'tracking_url', 'courier_name', 'courier_phone', 'note'];

    public function act(Request $request, string $id, string $action, CommerceOrderFulfillmentService $service, CommerceStaffOrderController $read): JsonResponse
    {
        abort_unless((bool) config('commerce.order_fulfillment_enabled'), 404);
        abort_unless(isset(CommerceOrderFulfillmentService::TARGETS[$action]), 404);
        $read->guard($request);
        $input = $this->input($request, self::ACTION_KEYS);

        $order = CommerceOrder::query()->find($id);
        abort_if($order === null, 404, 'الطلب غير موجود.');

        try {
            $service->act($order, $request->user(), $action, $this->version($input), $input);
        } catch (CommerceOrderFulfillmentException $e) {
            return $this->error($e);
        }

        return response()->json(['data' => $read->detailData($id, $request->user())]);
    }

    public function update(Request $request, string $id, CommerceOrderFulfillmentService $service, CommerceStaffOrderController $read): JsonResponse
    {
        abort_unless((bool) config('commerce.order_fulfillment_enabled'), 404);
        $read->guard($request);
        $input = $this->input($request, self::DETAIL_KEYS);

        $order = CommerceOrder::query()->find($id);
        abort_if($order === null, 404, 'الطلب غير موجود.');

        try {
            $service->updateDetails($order, $request->user(), $this->version($input), $input);
        } catch (CommerceOrderFulfillmentException $e) {
            return $this->error($e);
        }

        return response()->json(['data' => $read->detailData($id, $request->user())]);
    }

    /**
     * @param  list<string>  $allowed
     * @return array<string, mixed>
     */
    private function input(Request $request, array $allowed): array
    {
        $request->validate(['tenant_id' => ['prohibited']]);
        $all = $request->json()->all() ?: $request->all();
        $unknown = array_diff(array_keys($all), $allowed);
        if ($unknown !== []) {
            abort(422, 'حقول غير معروفة: '.implode(', ', array_map(fn ($k) => (string) $k, $unknown)));
        }

        return $all;
    }

    /** `expected_version` غائب ⇒ null (428 من الخدمة بعد التحقق من وجود الطلب)؛ غير صحيح ⇒ 422. */
    private function version(array $input): ?int
    {
        if (! array_key_exists('expected_version', $input) || $input['expected_version'] === null) {
            return null;
        }
        $v = $input['expected_version'];
        if (is_int($v) && $v >= 0) {
            return $v;
        }
        if (is_string($v) && preg_match('/\A(0|[1-9][0-9]{0,8})\z/', $v) === 1) {
            return (int) $v;
        }
        abort(422, 'expected_version يجب أن يكون عدداً صحيحاً غير سالب.');
    }

    private function error(CommerceOrderFulfillmentException $e): JsonResponse
    {
        return response()->json(['message' => $e->getMessage(), 'reason' => $e->reason, ...$e->extra], $e->status);
    }
}
