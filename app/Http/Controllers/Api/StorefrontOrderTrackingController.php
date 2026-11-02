<?php

namespace App\Http\Controllers\Api;

use App\Models\CommerceOrder;
use App\Support\CommerceOrderPublicTracking;
use App\Support\CommerceOrderReference;
use App\Support\CommerceOrderTrackingToken;
use App\Support\PublicApiErrorCode;
use App\Support\PublicApiResponse;
use App\Support\StorefrontClientIdentity;
use App\Tenancy\StorefrontContext;
use App\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;

/**
 * ═══════════════════════════════════════════════════════════════
 *  COPS-H2-5 (D-H2-15/16/17) — تتبّع الضيف الموقَّع لطلب المتجر (`/store/v1`)
 * ═══════════════════════════════════════════════════════════════
 *  • `POST orders/{order}/tracking-link` يصدر رمز `trk1` **بشرط** مرجع الطلب `v1` (ترويسة `X-Order-Reference`) — لا تغيير في استجابة الإتمام.
 *  • `GET order-tracking/{token}` يعيد الإسقاط الضيّق (`CommerceOrderPublicTracking`) — الرمز في المسار.
 *
 *  **404 موحَّد** (الجسم نفسه) لكل خلل: بوابة مغلقة، صيغة، توقيع، انتهاء، طلب آخر/مستأجر آخر/قناة أخرى. مقارنة ثابتة الزمن داخل `CommerceOrderTrackingToken`.
 *  **حدود (D-H2-17):** 30/دقيقة لكل رمز صالح؛ 20/دقيقة للمحاولات **الفاشلة** لكل (متجر، هوية زائر موقَّعة إن فُعِّلت وإلا المتجر) ⇒ 429.
 *  الرمز الصالح لا يتأثر بسلة الفاشل (التحقق عديم الحالة ولا يمكن تخمينه) — فلا يستطيع مخرِّب إقفال زائر شرعي بحامل رمز صالح.
 *  `Cache-Control: no-store`، `X-Robots-Tag: noindex`، `Referrer-Policy: strict-origin-when-cross-origin`. لا كتابة ولا حدث ولا أثر مالي/مخزني.
 */
final class StorefrontOrderTrackingController extends PublicApiController
{
    private const VALID_PER_MINUTE = 30;

    private const FAILED_PER_MINUTE = 20;

    public function issue(Request $request, string $order): JsonResponse
    {
        if (! self::enabled()) {
            return $this->notFound($request);
        }
        $found = $this->scopedOrder($order);
        $reference = $request->header(CommerceOrderReference::HEADER);
        if ($found === null || ! CommerceOrderReference::verify($found, is_string($reference) ? $reference : null)) {
            return $this->notFound($request);
        }

        $token = CommerceOrderTrackingToken::issue($found);
        $exp = CommerceOrderTrackingToken::expiryFor($found);
        if ($token === null || $exp === null) {
            return $this->notFound($request);
        }

        return $this->hardened(PublicApiResponse::success($request, [
            'token' => $token,
            'expires_at' => \Carbon\CarbonImmutable::createFromTimestampUTC($exp)->toIso8601String(),
        ]));
    }

    public function show(Request $request, string $token): JsonResponse
    {
        if (! self::enabled()) {
            return $this->notFound($request);
        }

        $order = null;
        $parsed = CommerceOrderTrackingToken::parse($token);
        if ($parsed !== null) {
            $candidate = $this->scopedOrder($parsed[0]);
            if ($candidate !== null && CommerceOrderTrackingToken::verify($candidate, $token)) {
                $order = $candidate;
            }
        }

        if ($order === null) {
            $attempts = RateLimiter::hit($this->failedKey($request), 60);

            return $attempts > self::FAILED_PER_MINUTE
                ? $this->tooMany($request, RateLimiter::availableIn($this->failedKey($request)))
                : $this->notFound($request);
        }

        $validKey = 'order-tracking-ok|'.hash('sha256', $token);
        if (RateLimiter::tooManyAttempts($validKey, self::VALID_PER_MINUTE)) {
            return $this->tooMany($request, RateLimiter::availableIn($validKey));
        }
        RateLimiter::hit($validKey, 60);

        return $this->hardened(PublicApiResponse::success($request, [
            'tracking' => CommerceOrderPublicTracking::project($order, (int) CommerceOrderTrackingToken::expiryFor($order)),
        ]));
    }

    public static function enabled(): bool
    {
        return (bool) config('commerce.guest_order_tracking_enabled', false);
    }

    /** الطلب المؤكَّد داخل مستأجر وقناة (ومتجر) الطلب الحالي، وإلا null. */
    private function scopedOrder(string $id): ?CommerceOrder
    {
        $storefront = app(StorefrontContext::class);
        $query = CommerceOrder::query()
            ->where('id', $id)
            ->where('tenant_id', app(TenantContext::class)->id())
            ->where('sales_channel_id', $storefront->salesChannelId())
            ->where('status', CommerceOrder::STATUS_CONFIRMED);
        if ($storefront->hasStorefront()) {
            $query->where('storefront_id', $storefront->storefrontId());
        }

        return $query->first();
    }

    private function failedKey(Request $request): string
    {
        $storefront = app(StorefrontContext::class);
        $scope = $storefront->hasStorefront() ? $storefront->storefrontId() : $storefront->salesChannelId();

        return 'order-tracking-fail|'.$scope.'|'.(StorefrontClientIdentity::bucket($request) ?? 'store');
    }

    private function hardened(JsonResponse $response): JsonResponse
    {
        return $response
            ->header('Cache-Control', 'no-store')
            ->header('X-Robots-Tag', 'noindex, nofollow')
            ->header('Referrer-Policy', 'strict-origin-when-cross-origin');
    }

    private function tooMany(Request $request, int $retryAfter): JsonResponse
    {
        return $this->hardened(PublicApiResponse::error($request, PublicApiErrorCode::RATE_LIMITED, 'عدد الطلبات كبير. حاول لاحقاً.'))
            ->header('Retry-After', (string) max(1, $retryAfter));
    }

    private function notFound(Request $request): JsonResponse
    {
        return $this->hardened(PublicApiResponse::error($request, PublicApiErrorCode::NOT_FOUND, 'الطلب غير متاح.'));
    }
}
