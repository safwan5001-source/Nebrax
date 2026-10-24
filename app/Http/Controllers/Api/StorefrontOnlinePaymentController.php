<?php

namespace App\Http\Controllers\Api;

use App\Models\CommerceOrder;
use App\Services\Commerce\CommerceOnlinePaymentException;
use App\Services\Commerce\CommerceOnlinePaymentService;
use App\Support\CommerceOrderReference;
use App\Support\PublicApiErrorCode;
use App\Support\PublicApiResponse;
use App\Tenancy\StorefrontContext;
use App\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PAY-H4-04a — الدفع الإلكتروني لطلب المتجر (`/store/v1`)
 * ═══════════════════════════════════════════════════════════════
 *  • `POST checkout/payment-intent` يبدأ (أو يستأنف) محاولة دفع للطلب ويعيد `checkout_url` لصفحة المزوّد المستضافة.
 *  • `GET orders/{order}/payment-status` يعيد **حقيقة الخادم**: يستعلم المزوّد ثم يثبّت النية؛ عودة المتصفح لا تُصدَّق (ADR-04 §7).
 *
 *  **الملكية بمرجع الطلب الموقَّع** (`X-Order-Reference`، ترويسة لا استعلام) لا بمعرّف الطلب: كل فشل ملكية (غائب/تالف/طلب مستأجر أو قناة أخرى)
 *  يعيد 404 الموحّد نفسه. المبلغ والعملة والبوابة كلها من الخادم؛ لا حقل مبلغ ولا مزوّد ولا عنوان في الطلب. مغلق افتراضياً (404) خلف
 *  `payments.commerce_online_checkout.enabled`. لا أثر محاسبي ولا مخزني (G3).
 */
final class StorefrontOnlinePaymentController extends PublicApiController
{
    public function start(Request $request, CommerceOnlinePaymentService $online): JsonResponse
    {
        if (! CommerceOnlinePaymentService::enabled()) {
            return $this->notFound($request);
        }
        $unknown = array_values(array_diff(array_keys($request->all()), ['order_id']));
        if ($unknown !== []) {
            throw ValidationException::withMessages(['request' => 'حقول غير مسموحة: '.implode(', ', $unknown)]);
        }
        $data = $request->validate(['order_id' => ['required', 'uuid']]);

        $order = $this->resolveOrder($request, $data['order_id']);
        if ($order === null) {
            return $this->notFound($request);
        }

        try {
            $result = $online->start($order);
            $payment = $online->snapshot($order);
        } catch (CommerceOnlinePaymentException $e) {
            return $this->failure($request, $e);
        }

        return PublicApiResponse::success($request, ['payment' => $payment], $result['created'] ? 201 : 200)
            ->header('Cache-Control', 'no-store');
    }

    public function status(Request $request, string $order, CommerceOnlinePaymentService $online): JsonResponse
    {
        if (! CommerceOnlinePaymentService::enabled()) {
            return $this->notFound($request);
        }
        $resolved = $this->resolveOrder($request, $order);
        if ($resolved === null) {
            return $this->notFound($request);
        }

        try {
            $payment = $online->status($resolved);
        } catch (CommerceOnlinePaymentException $e) {
            return $this->failure($request, $e);
        }

        return PublicApiResponse::success($request, ['payment' => $payment])->header('Cache-Control', 'no-store');
    }

    /** الطلب داخل مستأجر وقناة (ومتجر) الطلب الحالي وبمرجع موقَّع صحيح؛ وإلا null (لا تمييز بين الأسباب). */
    private function resolveOrder(Request $request, string $id): ?CommerceOrder
    {
        $storefront = app(StorefrontContext::class);
        $query = CommerceOrder::query()
            ->where('id', $id)
            ->where('tenant_id', app(TenantContext::class)->id())
            ->where('sales_channel_id', $storefront->salesChannelId());
        if ($storefront->hasStorefront()) {
            $query->where('storefront_id', $storefront->storefrontId());
        }
        $order = $query->first();
        $reference = $request->header(CommerceOrderReference::HEADER);

        return $order !== null && CommerceOrderReference::verify($order, is_string($reference) ? $reference : null) ? $order : null;
    }

    private function failure(Request $request, CommerceOnlinePaymentException $e): JsonResponse
    {
        $code = match ($e->reason) {
            'not_online' => PublicApiErrorCode::NOT_FOUND,
            'already_paid', 'not_payable', 'attempt_in_progress', 'cancel_failed' => PublicApiErrorCode::PAYMENT_NOT_PAYABLE,
            'provider_unavailable' => PublicApiErrorCode::PAYMENT_PROVIDER_UNAVAILABLE,
            default => PublicApiErrorCode::PAYMENT_UNAVAILABLE,
        };

        return PublicApiResponse::error($request, $code, $e->getMessage(), null, ['reason' => $e->reason])
            ->header('Cache-Control', 'no-store');
    }

    private function notFound(Request $request): JsonResponse
    {
        return PublicApiResponse::error($request, PublicApiErrorCode::NOT_FOUND, 'الطلب غير متاح.');
    }
}
