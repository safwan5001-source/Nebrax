<?php

namespace App\Http\Controllers\Api;

use App\Models\CommerceCheckout;
use App\Models\CommerceOrder;
use App\Models\Tenant;
use App\Services\Commerce\CheckoutIdempotencyConflictException;
use App\Services\Commerce\CheckoutNotFoundException;
use App\Services\Commerce\CheckoutReviewRequiredException;
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
        try {
            $result = $checkouts->current($this->tokenFromRequest($request));
        } catch (PDOException $e) {
            throw $e;
        } catch (RuntimeException $e) {
            abort(422, $e->getMessage());
        }
        // (Codex, PR #924, P1, tenth round) Same locked recheck-and-serialize
        // as CommerceCartController::show(): current()'s own resolution can
        // be stale by the time this response is actually built.
        try {
            $serialized = $checkouts->serializeForOwnedRead($result['checkout'], $result['cart']);
        } catch (PDOException $e) {
            throw $e;
        } catch (RuntimeException $e) {
            abort(422, $e->getMessage());
        }
        if (! $serialized['owned']) {
            return $this->clearToken($this->notFound($request));
        }
        $response = PublicApiResponse::success($request, $serialized['data']);

        return $this->applyTokenOutcome($response, $result);
    }

    public function store(Request $request, CommerceCheckoutService $checkouts): JsonResponse
    {
        $this->rejectUnknown($request, []);
        $token = $this->tokenFromRequest($request);

        // (Codex, PR #924, P1, seventh round) لا فحصٌ منفصل بـfindByToken()
        // هنا قبل استدعاء createOrResume(): كلاهما كان يعيد ربط الرمز حين لا
        // يطابق أيّ سلة — نداءان في طلبٍ واحد يُلغي أوّلهما الثاني، فيفقد أي
        // جهازٍ آخر يحمل الرمز الأول صلاحيته بلا داع. createOrResume() وحدها
        // تحلّ وتربط الرمز الآن (مرّةً واحدة)، وترمي CheckoutNotFoundException
        // لأي سببٍ يمنع البدء — نفس معاملة "امسح الرمز وأرجع 404" التي كانت
        // تُطبَّق فقط حين يكون الرمز المقدَّم فاسداً تحديداً.
        try {
            $result = $checkouts->createOrResume($token);
        } catch (CheckoutNotFoundException) {
            return $this->clearToken($this->notFound($request));
        } catch (PDOException $e) {
            throw $e;
        } catch (RuntimeException $e) {
            abort(422, $e->getMessage());
        }

        // (Codex, PR #924, P1, eleventh round) createOrResume()'s own cart
        // lock is released once its transaction commits, before this
        // response is built — a claim committing in that gap could leak the
        // new owner's data into this stale response. Same locked
        // recheck-and-serialize as show()/complete()'s review-required
        // branch, not the plain serialize() this call used before.
        try {
            $serialized = $checkouts->serializeForOwnedRead($result['checkout'], $result['cart']);
        } catch (PDOException $e) {
            throw $e;
        } catch (RuntimeException $e) {
            abort(422, $e->getMessage());
        }
        if (! $serialized['owned']) {
            return $this->clearToken($this->notFound($request));
        }

        $response = PublicApiResponse::success(
            $request,
            $serialized['data'],
            $result['created'] ? 201 : 200,
        );
        if ($result['rebound'] !== null) {
            $this->setToken($response, $result['rebound']);
        }

        return $response;
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
            try {
                $current = $checkouts->current($token);
            } catch (PDOException $ePdo) {
                throw $ePdo;
            } catch (RuntimeException $eRuntime) {
                abort(422, $eRuntime->getMessage());
            }

            // (Codex, PR #924, P1, tenth round) Same locked recheck-and-
            // serialize as show(): current()'s own resolution here can also
            // be stale by the time this response is built.
            try {
                $serialized = $checkouts->serializeForOwnedRead($current['checkout'], $current['cart']);
            } catch (PDOException $ePdo) {
                throw $ePdo;
            } catch (RuntimeException $eRuntime) {
                abort(422, $eRuntime->getMessage());
            }
            if (! $serialized['owned']) {
                return $this->clearToken($this->notFound($request));
            }

            // (Codex, PR #924, P2, eighth round) current() now calls
            // resolveCurrent() (seventh round), which can rebind the token —
            // e.g. another device touched the shared cart between
            // resolveForCompletion()'s own lookup and this recovery lookup.
            // Without surfacing it here, the client's retry keeps presenting
            // the now-stale token, which 404s in resolveForCompletion()'s
            // allowConsumed lookup (no identity fallback there, by design).
            return $this->applyTokenOutcome(PublicApiResponse::error(
                $request,
                PublicApiErrorCode::REVIEW_REQUIRED,
                $e->getMessage(),
                409,
                [
                    'items' => $e->details(),
                    'checkout' => $serialized['data'],
                ],
            ), $current);
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
        try {
            $lookup = $checkouts->current($token);
        } catch (PDOException $e) {
            throw $e;
        } catch (RuntimeException $e) {
            abort(422, $e->getMessage());
        }
        if ($lookup['checkout'] === null) {
            return $this->applyTokenOutcome($this->notFound($request), $lookup);
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

        return $this->applyTokenOutcome(PublicApiResponse::success($request, $data), $lookup);
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

    private function setToken(JsonResponse $response, string $rawToken): void
    {
        $response->headers->set(self::TOKEN_HEADER, $rawToken);
    }

    /**
     * (Codex, PR #924, P1, fourth round) `CommerceCartService::findByToken()`
     * can now rebind a stale/rotated token onto the customer's own cart
     * (self-heal, `allowConsumed: false` only) — every checkout preparation
     * step (`show()`/`store()`/`withCurrentCheckout()`, used by
     * updateContact/updateAddress/updateDelivery) must hand that new token
     * back, exactly like `CommerceCartController::applyTokenOutcome()`
     * already does for cart endpoints. Without this, the device keeps
     * presenting the same stale token through its entire checkout flow and
     * only discovers it at `checkout/complete` (`allowConsumed: true`,
     * fallback deliberately excluded there) — the worst possible place to
     * fail, and on a genuinely first attempt, not just a retry.
     *
     * @param  array{invalid: bool, rebound: ?string}  $lookup
     */
    private function applyTokenOutcome(JsonResponse $response, array $lookup): JsonResponse
    {
        if ($lookup['rebound'] !== null) {
            $this->setToken($response, $lookup['rebound']);

            return $response;
        }

        return $lookup['invalid'] ? $this->clearToken($response) : $response;
    }
}
