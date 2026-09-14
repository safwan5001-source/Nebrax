<?php

namespace App\Http\Controllers\Api;

use App\Services\Commerce\CartNotFoundException;
use App\Services\Commerce\CommerceCartService;
use App\Support\PublicApiErrorCode;
use App\Support\PublicApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use RuntimeException;

final class StorefrontCartController extends PublicApiController
{
    public function show(Request $request, CommerceCartService $carts): JsonResponse
    {
        $lookup = $carts->findByToken($request->cookie(CommerceCartService::COOKIE_NAME));
        $response = PublicApiResponse::success($request, $carts->serialize($lookup['cart']));

        return $lookup['invalid'] ? $this->clearCookie($response) : $response;
    }

    public function store(Request $request, CommerceCartService $carts): JsonResponse
    {
        $this->rejectUnknown($request, ['product_id', 'unit_key', 'quantity']);
        $data = $request->validate([
            'product_id' => ['required', 'uuid'],
            'unit_key' => ['sometimes', 'string', 'max:80'],
            'quantity' => ['required', 'integer', 'min:1', 'max:2147483647'],
        ]);

        $lookup = $carts->findByToken($request->cookie(CommerceCartService::COOKIE_NAME));
        if ($lookup['invalid']) {
            return $this->clearCookie($this->notFound($request));
        }

        try {
            $result = $carts->add(
                $lookup['cart'],
                $data['product_id'],
                $data['unit_key'] ?? 'base',
                $data['quantity'],
            );
        } catch (CartNotFoundException) {
            return $this->clearCookie($this->notFound($request));
        } catch (RuntimeException $e) {
            abort(422, $e->getMessage());
        }

        $response = PublicApiResponse::success($request, $result['data'], $result['created'] ? 201 : 200);
        $this->setCookie(
            $response,
            $result['token'] ?? (string) $request->cookie(CommerceCartService::COOKIE_NAME),
        );

        return $response;
    }

    public function update(Request $request, CommerceCartService $carts): JsonResponse
    {
        $this->rejectUnknown($request, ['quantity']);
        $data = $request->validate([
            'quantity' => ['required', 'integer', 'min:1', 'max:2147483647'],
        ]);
        $lookup = $carts->findByToken($request->cookie(CommerceCartService::COOKIE_NAME));
        if ($lookup['cart'] === null) {
            $response = $this->notFound($request);

            return $lookup['invalid'] ? $this->clearCookie($response) : $response;
        }

        try {
            $data = $carts->update($lookup['cart'], (string) $request->route('item'), $data['quantity']);
        } catch (CartNotFoundException) {
            return $this->notFound($request);
        } catch (RuntimeException $e) {
            abort(422, $e->getMessage());
        }

        $response = PublicApiResponse::success($request, $data);
        $this->setCookie($response, (string) $request->cookie(CommerceCartService::COOKIE_NAME));

        return $response;
    }

    public function destroy(Request $request, CommerceCartService $carts): JsonResponse
    {
        $this->rejectUnknown($request, []);
        $lookup = $carts->findByToken($request->cookie(CommerceCartService::COOKIE_NAME));
        if ($lookup['cart'] === null) {
            $response = $this->notFound($request);

            return $lookup['invalid'] ? $this->clearCookie($response) : $response;
        }

        try {
            $data = $carts->remove($lookup['cart'], (string) $request->route('item'));
        } catch (CartNotFoundException) {
            return $this->notFound($request);
        }

        $response = PublicApiResponse::success($request, $data);
        $this->setCookie($response, (string) $request->cookie(CommerceCartService::COOKIE_NAME));

        return $response;
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

    private function clearCookie(JsonResponse $response): JsonResponse
    {
        $response->headers->setCookie(cookie()->forget(CommerceCartService::COOKIE_NAME, '/', null));

        return $response;
    }

    private function setCookie(JsonResponse $response, string $rawToken): void
    {
        $response->headers->setCookie(cookie(
            CommerceCartService::COOKIE_NAME,
            $rawToken,
            CommerceCartService::LIFETIME_DAYS * 24 * 60,
            '/',
            null,
            app()->environment('production'),
            true,
            false,
            'lax',
        ));
    }
}
