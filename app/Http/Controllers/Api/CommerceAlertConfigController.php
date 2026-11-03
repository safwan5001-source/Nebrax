<?php

namespace App\Http\Controllers\Api;

use App\Services\Commerce\CommerceOrderAlertNotifier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * COPS-H3-3 (ADR-30) — إعداد مركز التنبيه من الخادم. **قراءة فقط**، `commerce.orders.view` + `EnsureApplicationActive:commerce.storefront`.
 *
 * يعلن: هل المركز مفعَّل (بوابة النشر `commerce.order_alerts_enabled`؛ مغلقة ⇒ `enabled=false` فلا يبدأ العميل أي استطلاع)، ووضع الاستقبال
 * (`feed_attention` لغير المقيَّد؛ `attention_only` للمقيَّد بمخازن — D-H3-01: لا تغذية له)، ووتيرة الاستطلاع (تُضبط من الخادم دون نشر واجهة). لا حالة ولا سر ولا PII.
 */
class CommerceAlertConfigController extends ApiController
{
    public function show(Request $request): JsonResponse
    {
        $restricted = $request->user()?->allowedWarehouseIds() !== null;
        $cfg = (array) config('commerce.order_alerts_polling', []);

        return response()->json(['data' => [
            'enabled' => CommerceOrderAlertNotifier::enabled(),
            'mode' => $restricted ? 'attention_only' : 'feed_attention',
            'polling' => [
                'feed_ms' => max(5_000, (int) ($cfg['feed_ms'] ?? 10_000)),
                'attention_ms' => max(15_000, (int) ($cfg['attention_ms'] ?? 60_000)),
                'attention_only_ms' => max(10_000, (int) ($cfg['attention_only_ms'] ?? 15_000)),
            ],
        ]], 200, ['Cache-Control' => 'private, no-store']);
    }
}
