<?php

namespace App\Http\Controllers\Api;

use App\Services\Commerce\CartNotFoundException;
use App\Services\Commerce\CommerceCartService;
use App\Support\PublicApiErrorCode;
use App\Support\PublicApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use PDOException;
use RuntimeException;

/**
 * Public/Mobile Commerce API V1 — PR-3 (Guest Cart).
 *
 * Reuses `CommerceCartService` in full and unmodified in its business logic
 * (pricing/publication/availability/quantity/eligibility/expiry/locking all
 * come from the service exactly as `/store/v1`'s `StorefrontCartController`
 * already uses it). The **only** difference from that controller is
 * transport: a native mobile client cannot reliably carry an HttpOnly
 * cookie the way a browser does, so the guest cart token travels as an
 * opaque bearer value in a dedicated `X-Cart-Token` request/response
 * header — never the `Authorization` header, which already carries the
 * unrelated `ApiClient`/Sanctum store token that
 * `AuthenticateApiClient`/`ResolveCommerceChannel` resolve tenant + mobile
 * `SalesChannel` identity from (`docs/plans/commerce/PR3_GUEST_CART_ARCHITECTURE_RECONCILIATION.md`).
 *
 * The guest token itself is the exact same primitive `CommerceCartService`
 * already generates and stores for web (`newToken()`/`token_hash`, 32
 * cryptographically random bytes, sha256-hashed at rest, raw value never
 * persisted) — no new token mechanism, no new table, no new column.
 */
final class CommerceCartController extends PublicApiController
{
    private const TOKEN_HEADER = 'X-Cart-Token';

    public function show(Request $request, CommerceCartService $carts): JsonResponse
    {
        $lookup = $carts->resolveCurrent($this->tokenFromRequest($request));
        $response = PublicApiResponse::success($request, $carts->serialize($lookup['cart']));

        return $this->applyTokenOutcome($response, $lookup);
    }

    public function store(Request $request, CommerceCartService $carts): JsonResponse
    {
        $this->rejectUnknown($request, ['product_id', 'product_variant_id', 'unit_key', 'quantity']);
        $data = $request->validate([
            'product_id' => ['required', 'uuid'],
            'product_variant_id' => ['sometimes', 'nullable', 'uuid'],
            'unit_key' => ['sometimes', 'string', 'max:80'],
            'quantity' => ['required', 'integer', 'min:1', 'max:2147483647'],
        ]);

        $lookup = $carts->resolveCurrent($this->tokenFromRequest($request));
        if ($lookup['invalid']) {
            return $this->clearToken($this->notFound($request));
        }

        try {
            $result = $carts->add(
                $lookup['cart'],
                $data['product_id'],
                $data['unit_key'] ?? 'base',
                $data['quantity'],
                $data['product_variant_id'] ?? null,
            );
        } catch (CartNotFoundException) {
            return $this->clearToken($this->notFound($request));
        } catch (PDOException $e) {
            throw $e;
        } catch (RuntimeException $e) {
            abort(422, $e->getMessage());
        }

        $response = PublicApiResponse::success($request, $result['data'], $result['created'] ? 201 : 200);
        $this->setToken($response, $lookup['rebound'] ?? $result['token'] ?? (string) $this->tokenFromRequest($request));

        return $response;
    }

    public function update(Request $request, CommerceCartService $carts): JsonResponse
    {
        $this->rejectUnknown($request, ['quantity']);
        $data = $request->validate([
            'quantity' => ['required', 'integer', 'min:1', 'max:2147483647'],
        ]);
        $lookup = $carts->resolveCurrent($this->tokenFromRequest($request));
        if ($lookup['cart'] === null) {
            $response = $this->notFound($request);

            return $lookup['invalid'] ? $this->clearToken($response) : $response;
        }

        try {
            $data = $carts->update($lookup['cart'], (string) $request->route('item'), $data['quantity']);
        } catch (CartNotFoundException) {
            return $this->notFoundAfterMutation($request, $carts);
        } catch (PDOException $e) {
            throw $e;
        } catch (RuntimeException $e) {
            abort(422, $e->getMessage());
        }

        $response = PublicApiResponse::success($request, $data);
        $this->setToken($response, $lookup['rebound'] ?? (string) $this->tokenFromRequest($request));

        return $response;
    }

    public function destroy(Request $request, CommerceCartService $carts): JsonResponse
    {
        $this->rejectUnknown($request, []);
        $lookup = $carts->resolveCurrent($this->tokenFromRequest($request));
        if ($lookup['cart'] === null) {
            $response = $this->notFound($request);

            return $lookup['invalid'] ? $this->clearToken($response) : $response;
        }

        try {
            $data = $carts->remove($lookup['cart'], (string) $request->route('item'));
        } catch (CartNotFoundException) {
            return $this->notFoundAfterMutation($request, $carts);
        }

        $response = PublicApiResponse::success($request, $data);
        $this->setToken($response, $lookup['rebound'] ?? (string) $this->tokenFromRequest($request));

        return $response;
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
        return PublicApiResponse::error($request, PublicApiErrorCode::NOT_FOUND, 'السلة غير متاحة.');
    }

    private function notFoundAfterMutation(Request $request, CommerceCartService $carts): JsonResponse
    {
        $response = $this->notFound($request);
        $lookup = $carts->resolveCurrent($this->tokenFromRequest($request));

        return $this->applyTokenOutcome($response, $lookup);
    }

    /** @param array{cart: mixed, invalid: bool, rebound: ?string} $lookup */
    private function applyTokenOutcome(JsonResponse $response, array $lookup): JsonResponse
    {
        if ($lookup['rebound'] !== null) {
            $this->setToken($response, $lookup['rebound']);

            return $response;
        }

        return $lookup['invalid'] ? $this->clearToken($response) : $response;
    }

    private function clearToken(JsonResponse $response): JsonResponse
    {
        $response->headers->set(self::TOKEN_HEADER, '');

        return $response;
    }

    private function setToken(JsonResponse $response, string $rawToken): void
    {
        if ($rawToken === '') {
            return;
        }

        $response->headers->set(self::TOKEN_HEADER, $rawToken);
    }
}
