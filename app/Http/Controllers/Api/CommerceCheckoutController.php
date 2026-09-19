<?php

namespace App\Http\Controllers\Api;

use App\Models\CommerceCheckout;
use App\Models\CommerceOrder;
use App\Models\Tenant;
use App\Services\Commerce\CheckoutIdempotencyConflictException;
use App\Services\Commerce\CheckoutNotFoundException;
use App\Services\Commerce\CheckoutReviewRequiredException;
use App\Services\Commerce\CommerceCartService;
use App\Services\Commerce\CommerceCheckoutService;
use App\Support\CommerceOrderReference;
use App\Support\PublicApiErrorCode;
use App\Support\PublicApiIdempotency;
use App\Support\PublicApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use PDOException;
use RuntimeException;

/**
 * Public/Mobile Commerce API V1 — PR-4 (Mobile Checkout).
 *
 * Reuses `CommerceCheckoutService` in full and unmodified in its business
 * logic (revalidation/pricing/stock-check/idempotency/order-creation all
 * come from the service exactly as `/store/v1`'s `StorefrontCheckoutController`
 * already uses it — same method-for-method mirror as `CommerceCartController`
 * is to `StorefrontCartController` in PR-3). The **only** difference from
 * that controller is transport: the guest cart/checkout identity travels in
 * the same dedicated `X-Cart-Token` request/response header PR-3 introduced
 * — never a cookie, and never the `Authorization` header, which carries the
 * unrelated `ApiClient`/Sanctum store token that
 * `AuthenticateApiClient`/`ResolveCommerceChannel` resolve tenant + mobile
 * `SalesChannel` identity from.
 *
 * Idempotency-Key is required on `POST checkout/complete` only — matching
 * `CommerceCheckoutService::createOrResume()`'s actual contract (naturally
 * idempotent via resume-if-open, no key parameter at all) and
 * `AWJ_CHECKOUT_V1_ARCHITECTURE.md` §9's "An Idempotency-Key is mandatory
 * for completion" (singular). No new idempotency mechanism is introduced
 * for `POST checkout` here — the service being reused has none.
 */
final class CommerceCheckoutController extends PublicApiController
{
    private const TOKEN_HEADER = 'X-Cart-Token';

    public function show(Request $request, CommerceCheckoutService $checkouts): JsonResponse
    {
        $result = $checkouts->current($this->tokenFromRequest($request));
        $response = PublicApiResponse::success($request, $checkouts->serialize($result['checkout'], $result['cart']));

        return $result['invalid'] ? $this->clearToken($response) : $response;
    }

    public function store(Request $request, CommerceCartService $carts, CommerceCheckoutService $checkouts): JsonResponse
    {
        $this->rejectUnknown($request, []);
        $token = $this->tokenFromRequest($request);

        $lookup = $carts->findByToken($token);
        if ($lookup['invalid']) {
            return $this->clearToken($this->notFound($request));
        }

        try {
            $result = $checkouts->createOrResume($token);
        } catch (CheckoutNotFoundException) {
            return $this->notFound($request);
        } catch (PDOException $e) {
            throw $e;
        } catch (RuntimeException $e) {
            abort(422, $e->getMessage());
        }

        return PublicApiResponse::success(
            $request,
            $checkouts->serialize($result['checkout'], $result['cart']),
            $result['created'] ? 201 : 200,
        );
    }

    public function updateContact(Request $request, CommerceCheckoutService $checkouts): JsonResponse
    {
        $this->rejectUnknown($request, ['name', 'phone', 'email']);
        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:255'],
            'phone' => ['sometimes', 'string', 'max:32'],
            'email' => ['sometimes', 'nullable', 'email', 'max:255'],
        ]);

        $fields = [];
        if (array_key_exists('name', $data)) {
            $fields['contact_name'] = $data['name'];
        }
        if (array_key_exists('phone', $data)) {
            $fields['contact_phone'] = $data['phone'];
        }
        if (array_key_exists('email', $data)) {
            $fields['contact_email'] = $data['email'];
        }

        return $this->withCurrentCheckout(
            $request,
            $checkouts,
            fn (CommerceCheckout $checkout) => $checkouts->updateContact($checkout, $fields),
        );
    }

    public function updateAddress(Request $request, CommerceCheckoutService $checkouts): JsonResponse
    {
        $allowed = ['country', 'region', 'city', 'district', 'street', 'postal_code', 'notes'];
        $this->rejectUnknown($request, $allowed);
        $data = $request->validate([
            'country' => ['sometimes', 'string', 'max:255'],
            'region' => ['sometimes', 'nullable', 'string', 'max:255'],
            'city' => ['sometimes', 'string', 'max:255'],
            'district' => ['sometimes', 'nullable', 'string', 'max:255'],
            'street' => ['sometimes', 'string', 'max:255'],
            'postal_code' => ['sometimes', 'nullable', 'string', 'max:32'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:1000'],
        ]);

        $fields = [];
        foreach ($allowed as $key) {
            if (array_key_exists($key, $data)) {
                $fields['delivery_'.$key] = $data[$key];
            }
        }

        return $this->withCurrentCheckout(
            $request,
            $checkouts,
            fn (CommerceCheckout $checkout) => $checkouts->updateAddress($checkout, $fields),
        );
    }

    public function updateDelivery(Request $request, CommerceCheckoutService $checkouts): JsonResponse
    {
        $this->rejectUnknown($request, ['method']);
        $data = $request->validate([
            'method' => ['required', 'string', Rule::in(CommerceCheckoutService::DELIVERY_METHODS)],
        ]);

        return $this->withCurrentCheckout(
            $request,
            $checkouts,
            fn (CommerceCheckout $checkout) => $checkouts->updateDelivery($checkout, $data['method']),
        );
    }

    /**
     * `POST /commerce/v1/checkout/complete`. `Idempotency-Key` إلزامية (نفس
     * عقد `PublicApiIdempotency` — تحقّق/تجزئة/بصمة). لا Order يُنشأ إن فشلت
     * إعادة التحقّق النهائية (`review_required`، 409) أو تعارض المفتاح مع
     * محاولةٍ سابقة (`idempotency_conflict`، 409) — راجع
     * `CommerceCheckoutService::complete()`.
     */
    public function complete(Request $request, CommerceCheckoutService $checkouts): JsonResponse
    {
        $this->rejectUnknown($request, []);

        $rawKey = (string) $request->headers->get('Idempotency-Key', '');
        if ($rawKey === '') {
            return PublicApiResponse::error(
                $request, PublicApiErrorCode::IDEMPOTENCY_KEY_REQUIRED,
                'ترويسة Idempotency-Key مطلوبة لإتمام الدفع.', 400,
            );
        }
        if (! PublicApiIdempotency::isValidKey($rawKey)) {
            return PublicApiResponse::error(
                $request, PublicApiErrorCode::INVALID_IDEMPOTENCY_KEY,
                'قيمة Idempotency-Key غير صالحة (طول أو محارف غير مسموحة).', 400,
            );
        }

        $token = $this->tokenFromRequest($request);
        $lookup = $checkouts->resolveForCompletion($token);
        if ($lookup['checkout'] === null) {
            $response = $this->notFound($request);

            return $lookup['invalid'] ? $this->clearToken($response) : $response;
        }

        try {
            $result = $checkouts->complete(
                $lookup['checkout'],
                PublicApiIdempotency::hashKey($rawKey),
                PublicApiIdempotency::fingerprint($request),
            );
        } catch (CheckoutNotFoundException) {
            return $this->notFound($request);
        } catch (CheckoutIdempotencyConflictException $e) {
            return PublicApiResponse::error($request, PublicApiErrorCode::IDEMPOTENCY_CONFLICT, $e->getMessage(), 409);
        } catch (CheckoutReviewRequiredException $e) {
            $current = $checkouts->current($token);

            return PublicApiResponse::error(
                $request,
                PublicApiErrorCode::REVIEW_REQUIRED,
                $e->getMessage(),
                409,
                [
                    'items' => $e->details(),
                    'checkout' => $checkouts->serialize($current['checkout'], $current['cart']),
                ],
            );
        } catch (PDOException $e) {
            throw $e;
        } catch (RuntimeException $e) {
            abort(422, $e->getMessage());
        }

        return PublicApiResponse::success(
            $request,
            [
                'order' => $this->serializeOrder($result['order']),
                // PR-5: مرجع ضيف موقَّع لقراءة الطلب لاحقاً عبر
                // GET /commerce/v1/orders/{id} — حقل إضافي بحت، deterministic
                // (إعادة التشغيل Idempotent تعيد المرجع نفسه حرفياً).
                'order_reference' => CommerceOrderReference::issue($result['order']),
                'replayed' => $result['replayed'],
            ],
            $result['replayed'] ? 200 : 201,
        );
    }

    /** @return array<string, mixed> */
    private function serializeOrder(CommerceOrder $order): array
    {
        $currency = Tenant::findOrFail($order->tenant_id)->currency;

        return [
            'id' => $order->id,
            'number' => $order->number,
            'status' => $order->status,
            'delivery_method' => $order->delivery_method,
            'total' => ['amount_minor' => $order->total, 'currency' => $currency],
            'contact' => [
                'name' => $order->snapshot?->contact_name,
                'phone' => $order->snapshot?->phone,
                'email' => $order->snapshot?->email,
            ],
            'delivery' => [
                'country' => $order->snapshot?->shipping_country,
                'city' => $order->snapshot?->shipping_city,
                'district' => $order->snapshot?->shipping_district,
                'street' => $order->snapshot?->shipping_street,
                'postal_code' => $order->snapshot?->shipping_postal_code,
                'notes' => $order->snapshot?->shipping_notes,
            ],
            'items' => $order->lines->map(fn ($line) => [
                'product_id' => $line->product_id,
                'product_name' => $line->product_name_snapshot,
                'unit_name' => $line->unit_name,
                'quantity' => $line->quantity,
                'unit_price' => ['amount_minor' => $line->unit_price, 'currency' => $currency],
                'line_total' => ['amount_minor' => $line->line_total, 'currency' => $currency],
            ])->all(),
            'created_at' => $order->created_at?->toIso8601String(),
        ];
    }

    /** يحلّ Checkout الحالي من X-Cart-Token، وإلا 404 (مع مسح التوكن إن كان فاسداً)، ثم ينفّذ التحوير. */
    private function withCurrentCheckout(Request $request, CommerceCheckoutService $checkouts, callable $mutate): JsonResponse
    {
        $token = $this->tokenFromRequest($request);
        $lookup = $checkouts->current($token);
        if ($lookup['checkout'] === null) {
            $response = $this->notFound($request);

            return $lookup['invalid'] ? $this->clearToken($response) : $response;
        }

        try {
            $data = $mutate($lookup['checkout']);
        } catch (CheckoutNotFoundException) {
            return $this->notFound($request);
        } catch (PDOException $e) {
            throw $e;
        } catch (RuntimeException $e) {
            abort(422, $e->getMessage());
        }

        return PublicApiResponse::success($request, $data);
    }

    private function tokenFromRequest(Request $request): ?string
    {
        $token = $request->header(self::TOKEN_HEADER);

        return is_string($token) && $token !== '' ? $token : null;
    }

    /** @param array<int, string> $allowed */
    private function rejectUnknown(Request $request, array $allowed): void
    {
        $unknown = array_values(array_diff(array_keys($request->all()), $allowed));
        if ($unknown !== []) {
            throw ValidationException::withMessages([
                'request' => 'حقول غير مسموحة: '.implode(', ', $unknown),
            ]);
        }
    }

    private function notFound(Request $request): JsonResponse
    {
        return PublicApiResponse::error($request, PublicApiErrorCode::NOT_FOUND, 'جلسة الدفع غير متاحة.');
    }

    private function clearToken(JsonResponse $response): JsonResponse
    {
        $response->headers->set(self::TOKEN_HEADER, '');

        return $response;
    }
}
