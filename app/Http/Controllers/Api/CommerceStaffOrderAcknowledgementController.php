<?php

namespace App\Http\Controllers\Api;

use App\Services\Commerce\CommerceOrderAcknowledgementException;
use App\Services\Commerce\CommerceOrderAcknowledgementService;
use App\Services\Commerce\CommerceOrderAlertNotifier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * COPS-H3-4 (ADR-30 §4، R-10) — `POST commerce/orders/{id}/acknowledge`: إقرار تنبيه الطلب لكل طلب (يُسكت كل الأجهزة/المستخدمين بلا تغيير حالة الطلب).
 *
 * `commerce.orders.view` + `EnsureApplicationActive:commerce.storefront` على المسار (فعل مشاهدة لا انتقال؛ لا صلاحية جديدة). بوابة `commerce.order_alerts_enabled` مغلقة ⇒ 404
 * (كغير الموجود). المقيَّد بمخازن يقرّ طلبات مخازنه فقط؛ خارجها/غير موجود/مستأجر آخر ⇒ 404 موحَّد. بلا جسم (`tenant_id` محظور). ناجح/متكرر: 200 `{data:{order_id,
 * acknowledged, acknowledged_at, created}}`؛ الرفض: 409 `{message, reason}` (`already_cancelled`/`not_alertable`) أو 422 (`not_confirmed`).
 */
class CommerceStaffOrderAcknowledgementController extends ApiController
{
    public function acknowledge(Request $request, string $id, CommerceOrderAcknowledgementService $service): JsonResponse
    {
        abort_unless(CommerceOrderAlertNotifier::enabled(), 404);
        $request->validate(['tenant_id' => ['prohibited']]);

        $order = CommerceStaffOrderController::scopedOrders($request->user())->find($id);
        abort_if($order === null, 404, 'الطلب غير موجود.');

        try {
            $result = $service->acknowledge($order, $request->user());
        } catch (CommerceOrderAcknowledgementException $e) {
            return response()->json(['message' => $e->getMessage(), 'reason' => $e->reason], $e->status);
        }

        return response()->json(['data' => [
            'order_id' => (string) $order->id,
            'acknowledged' => true,
            'acknowledged_at' => $result['acknowledgement']->acknowledged_at?->toIso8601String(),
            'created' => $result['created'],
        ]]);
    }
}
