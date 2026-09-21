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
        $lookup = $this->resolveCurrent($request, $carts);
        // (Codex, PR #924, P1, ninth round) resolveCurrent() checked
        // ownership at resolution time, but a concurrent claim can commit
        // between that check and this response being built — recheck right
        // before serializing so a claimed cart's contents are never handed
        // to the stale guest bearer that resolved it moments earlier.
        if ($lookup['cart'] !== null && ! $carts->isOwnedByCurrentBearer($lookup['cart']->id)) {
            return $this->clearToken($this->notFound($request));
        }
        // (Codex, PR #924, P2) serialize()'s own subtotal arithmetic
        // (safeMultiply()/safeAdd()) can throw a plain RuntimeException for
        // an unrepresentable total — pre-existing, not specific to merging,
        // but this is the one call site that was never behind a try/catch
        // at all (add()/update()/remove() already return their own
        // serialize() result from inside store()/update()/destroy()'s
        // existing try/catch).
        try {
            $data = $carts->serialize($lookup['cart']);
        } catch (PDOException $e) {
            throw $e;
        } catch (RuntimeException $e) {
            abort(422, $e->getMessage());
        }
        $response = PublicApiResponse::success($request, $data);

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

        $lookup = $this->resolveCurrent($request, $carts);
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
        $lookup = $this->resolveCurrent($request, $carts);
        if ($lookup['cart'] === null) {
            $response = $this->notFound($request);

            return $lookup['invalid'] ? $this->clearToken($response) : $response;
        }
        if ($lookup['merged']) {
            return $this->applyTokenOutcome($this->cartMerged($request), $lookup);
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
        $lookup = $this->resolveCurrent($request, $carts);
        if ($lookup['cart'] === null) {
            $response = $this->notFound($request);

            return $lookup['invalid'] ? $this->clearToken($response) : $response;
        }
        if ($lookup['merged']) {
            return $this->applyTokenOutcome($this->cartMerged($request), $lookup);
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

    /**
     * (Codex, PR #924, P2) The item id in this request's URL was resolved
     * against a guest cart that `resolveCurrent()` just merged into the
     * customer's own cart as a side effect of this very request — it no
     * longer identifies any row (summed into an existing line, or replaced
     * by a newly created one with no 1:1 mapping back). Never guess; the
     * merge already committed, so the client must re-fetch the cart and
     * retry against its current item ids.
     */
    private function cartMerged(Request $request): JsonResponse
    {
        return PublicApiResponse::error(
            $request, PublicApiErrorCode::CART_MERGED,
            'تغيّرت السلة بعد تسجيل الدخول — يرجى إعادة جلبها والمحاولة مجدداً.',
        );
    }

    private function notFoundAfterMutation(Request $request, CommerceCartService $carts): JsonResponse
    {
        $response = $this->notFound($request);
        $lookup = $this->resolveCurrent($request, $carts);

        return $this->applyTokenOutcome($response, $lookup);
    }

    /**
     * (Codex, PR #924, P2) `resolveCurrent()` can now throw mid-merge
     * (`CommerceCartQuantityOverflowException`, a `RuntimeException`) —
     * every caller must translate that into the same 422 the mutation
     * endpoints already give a domain failure, never an uncaught 500.
     *
     * @return array{cart: mixed, invalid: bool, rebound: ?string, merged: bool}
     */
    private function resolveCurrent(Request $request, CommerceCartService $carts): array
    {
        try {
            return $carts->resolveCurrent($this->tokenFromRequest($request));
        } catch (PDOException $e) {
            throw $e;
        } catch (RuntimeException $e) {
            abort(422, $e->getMessage());
        }
    }

    /** @param array{cart: mixed, invalid: bool, rebound: ?string, merged?: bool} $lookup */
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
