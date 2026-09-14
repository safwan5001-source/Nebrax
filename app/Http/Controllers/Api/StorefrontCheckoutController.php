<?php

namespace App\Http\Controllers\Api;

use App\Models\CommerceCheckout;
use App\Services\Commerce\CheckoutNotFoundException;
use App\Services\Commerce\CommerceCartService;
use App\Services\Commerce\CommerceCheckoutService;
use App\Support\PublicApiErrorCode;
use App\Support\PublicApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use PDOException;
use RuntimeException;

/**
 * COM-CHECKOUT-1A — لا يكتب سوى حقول Checkout الوصفية أدناه. لا إتمام، لا
 * CommerceOrder، لا سعر شحن مُختلَق — راجع CommerceCheckoutService.
 *
 * يعتمد كلّياً على نفس بوابة الثقة المستعملة لسلة AWJ: نفس كوكي
 * `CommerceCartService::COOKIE_NAME` (لا كوكي Checkout منفصل — §14 من
 * الوثيقة تمنع إضافة بوابة موازية دون مراجعة)، ونفس
 * `RequireStorefrontMutationGateway` على مسارات الكتابة (مسجَّلة في
 * routes/api_storefront.php).
 */
final class StorefrontCheckoutController extends PublicApiController
{
    public function show(Request $request, CommerceCheckoutService $checkouts): JsonResponse
    {
        $result = $checkouts->current($request->cookie(CommerceCartService::COOKIE_NAME));
        $response = PublicApiResponse::success($request, $checkouts->serialize($result['checkout'], $result['cart']));

        return $result['invalid'] ? $this->clearCartCookie($response) : $response;
    }

    public function store(Request $request, CommerceCartService $carts, CommerceCheckoutService $checkouts): JsonResponse
    {
        $this->rejectUnknown($request, []);
        $token = $request->cookie(CommerceCartService::COOKIE_NAME);

        // نفس فحص الكوكي الفاسد الذي يطبّقه StorefrontCartController::store() —
        // مصدر السلة واحد، فسلوك مسح الكوكي عند فساده يبقى متسقاً بين الاثنين.
        $lookup = $carts->findByToken($token);
        if ($lookup['invalid']) {
            return $this->clearCartCookie($this->notFound($request));
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
        // القائمة المسموحة هنا هي `method` فقط — أي حقل مبلغ/سعر مُرسَل من
        // العميل (amount, price, total, delivery_amount, ...) يُرفَض بخطأ
        // تحقّق 422 قبل بلوغ الخدمة، لا يُقبَل بصمت ولا يُستعمَل.
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

    /** يحلّ Checkout الحالي من كوكي السلة، وإلا 404 (مع مسح الكوكي إن كان فاسداً)، ثم ينفّذ التحوير. */
    private function withCurrentCheckout(Request $request, CommerceCheckoutService $checkouts, callable $mutate): JsonResponse
    {
        $lookup = $checkouts->current($request->cookie(CommerceCartService::COOKIE_NAME));
        if ($lookup['checkout'] === null) {
            $response = $this->notFound($request);

            return $lookup['invalid'] ? $this->clearCartCookie($response) : $response;
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

    /** يشارك كوكي AWJ Cart نفسه — لا كوكي Checkout مستقل (§14). */
    private function clearCartCookie(JsonResponse $response): JsonResponse
    {
        $response->headers->setCookie(cookie()->forget(CommerceCartService::COOKIE_NAME, '/', null));

        return $response;
    }
}
