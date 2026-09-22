<?php

namespace App\Http\Controllers\Api;

use App\Models\CommercePaymentIntent;
use App\Services\Commerce\CommercePaymentIntentService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * COM-MOBILE-PAYMENTS-1 (ADR-04/ADR-09) — إدارة داخلية بحتة لالتزامات
 * الدفع (لا `/commerce/v1`/`/store/v1`): تحصيلٌ فعلي (`collect`) أو إلغاء
 * (`cancel`) — الانتقال الصريح الوحيد الذي يثبت أن آلة الحالة تعمل
 * (ADR-09 §2: "القدرة على الانتقال إلى collected يجب أن توجد"). صلاحية
 * `payments.manage` نفسها المستعملة لعمليات الدفع الأخرى — لا نطاق جديد.
 *
 * **لا أثر محاسبي هنا** — راجع توثيق `CommercePaymentIntentService` ورأس
 * ملف الهجرة: ربط `collect()` بسند قبض حقيقي (`Payment`/`LedgerService`)
 * مؤجَّلٌ صراحةً (ADR-09 §4 يجعله اختيارياً لهذا الإصدار)، ليس ناقصاً بالخطأ.
 */
class CommercePaymentIntentController extends ApiController
{
    public function index(): JsonResponse
    {
        return response()->json([
            'data' => CommercePaymentIntent::query()
                ->with('order:id,number')
                ->orderByDesc('created_at')
                ->get()
                ->map(fn (CommercePaymentIntent $intent) => $this->serialize($intent))
                ->all(),
        ]);
    }

    public function collect(Request $request, string $id, CommercePaymentIntentService $intents): JsonResponse
    {
        $data = $request->validate(['note' => ['sometimes', 'nullable', 'string', 'max:1000']]);
        $intent = CommercePaymentIntent::findOrFail($id);

        $intent = $this->domain(fn () => $intents->markCollected($intent, $data['note'] ?? null));

        return response()->json(['data' => $this->serialize($intent)]);
    }

    public function cancel(string $id, CommercePaymentIntentService $intents): JsonResponse
    {
        $intent = CommercePaymentIntent::findOrFail($id);

        $intent = $this->domain(fn () => $intents->cancel($intent));

        return response()->json(['data' => $this->serialize($intent)]);
    }

    /** @return array<string, mixed> */
    private function serialize(CommercePaymentIntent $intent): array
    {
        return [
            'id' => $intent->id,
            'commerce_order_id' => $intent->commerce_order_id,
            'order_number' => $intent->order?->number,
            'method' => $intent->method,
            'status' => $intent->status,
            'payment_method_name' => $intent->payment_method_name,
            'amount_minor' => $intent->amount_minor,
            'currency' => $intent->currency,
            'collected_at' => $intent->collected_at?->toIso8601String(),
            'cancelled_at' => $intent->cancelled_at?->toIso8601String(),
            'created_at' => $intent->created_at?->toIso8601String(),
        ];
    }
}
