<?php

namespace App\Http\Controllers\Api;

use App\Http\Middleware\EnsureApplicationActive;
use App\Models\CommerceOrder;
use App\Models\CommercePaymentIntent;
use App\Models\PaymentAttempt;
use App\Services\Commerce\CommerceOrderCancellationException;
use App\Services\Commerce\CommerceOrderLifecycleService;
use App\Services\Commerce\CommercePaymentIntentService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;

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
        $intents = CommercePaymentIntent::query()
            ->with('order:id,number')
            ->orderByDesc('created_at')
            ->get();

        // PAY-H4-04a: محاولات الدفع الإلكتروني (قراءة فقط) لعرض المراجعة اليدوية (التقاط متأخر/عدم تطابق مبلغ) دون واجهة موازية.
        $attempts = PaymentAttempt::query()
            ->whereIn('payable_key', $intents->filter->isOnline()->map->payableKey()->values()->all() ?: ['-'])
            ->orderByDesc('created_at')
            ->get()
            ->groupBy('payable_key');

        return response()->json([
            'data' => $intents
                ->map(fn (CommercePaymentIntent $intent) => $this->serialize($intent, $attempts->get($intent->payableKey())))
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

    /**
     * إلغاء التزام دفع. **سلوك قديم محفوظ حرفياً** ما دامت بوابة `commerce.order_cancellation_enabled` مغلقة (الافتراضي).
     *
     * ADR-28 D-9-R1 (البوابة مفتوحة): نية تتبع طلب متجر **تُفوَّض إلى خدمة إلغاء الطلب** فتمرّ بالمعاملة والتنظيف بعد الالتزام نفسيهما،
     * فلا تبقى طريقة تترك «طلباً مؤكَّداً بنية ملغاة». تتطلب صلاحيتين: `payments.manage` (المسار) **و**`commerce.orders.cancel`، وجسماً
     * `reason` (+`note` عند `other`). لا يتوسّع هذا في صلاحيات بقية المسارات.
     */
    public function cancel(Request $request, string $id, CommercePaymentIntentService $intents, CommerceOrderLifecycleService $lifecycle): JsonResponse
    {
        $intent = CommercePaymentIntent::findOrFail($id);

        if ((bool) config('commerce.order_cancellation_enabled') && $intent->commerce_order_id !== null) {
            abort_unless($request->user()->hasPermission('commerce.orders.cancel'), 403, 'إلغاء التزام دفع مرتبط بطلب يتطلب صلاحية إلغاء الطلبات.');
            abort_if($request->user()->allowedWarehouseIds() !== null, 403, 'إلغاء الطلبات غير متاح للمستخدم المقيَّد بمخازن محددة.');
            // نفس حارس القدرة الذي يطبّقه المسار المخصَّص (commerce.storefront) — مدخلان لإلغاء واحد بقيد واحد. الإنفاذ بالمنطق الوحيد القائم.
            app(EnsureApplicationActive::class)->authorize($request, 'commerce.storefront');
            $data = $request->validate([
                'reason' => ['required', 'string', Rule::in(CommerceOrder::CANCELLATION_REASONS)],
                'note' => ['sometimes', 'nullable', 'string', 'max:500', 'required_if:reason,other'],
            ]);
            $order = CommerceOrder::query()->find($intent->commerce_order_id);
            abort_if($order === null, 404);

            try {
                $lifecycle->cancel($order, $request->user(), $data['reason'], $data['note'] ?? null);
            } catch (CommerceOrderCancellationException $e) {
                return response()->json(['message' => $e->getMessage(), 'reason' => $e->reason], $e->status);
            }

            return response()->json(['data' => $this->serialize($intent->fresh())]);
        }

        $intent = $this->domain(fn () => $intents->cancel($intent));

        return response()->json(['data' => $this->serialize($intent)]);
    }

    /**
     * @param  Collection<int, PaymentAttempt>|null  $attempts  محاولات النية الإلكترونية (الأحدث أولاً)
     * @return array<string, mixed>
     */
    private function serialize(CommercePaymentIntent $intent, ?Collection $attempts = null): array
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
            // PAY-H4-04a: للنية الإلكترونية فقط (غائبان لـCOD/الاستلام فيبقى شكل الاستجابة كما كان).
            ...($intent->isOnline() ? [
                'paid_at' => $intent->paid_at?->toIso8601String(),
                'attempts' => ($attempts ?? collect())->map(fn (PaymentAttempt $a) => [
                    'id' => $a->id,
                    'capture_status' => $a->capture_status,
                    'amount_minor' => (int) $a->amount_minor,
                    'captured_minor' => (int) $a->captured_minor,
                    'currency' => $a->currency,
                    'review_reasons' => $a->review_reasons ?? [],
                    'captured_at' => $a->captured_at?->toIso8601String(),
                    'created_at' => $a->created_at?->toIso8601String(),
                ])->values()->all(),
            ] : []),
        ];
    }
}
