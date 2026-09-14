<?php

namespace App\Services\Commerce;

use App\Models\CommerceCart;
use App\Models\CommerceCheckout;
use App\Tenancy\StorefrontContext;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * COM-CHECKOUT-1A — أساس Checkout فقط. لا revalidation نهائي، لا idempotency
 * إتمام، لا CommerceOrder — تلك CHECKOUT-1B (راجع
 * docs/plans/commerce/AWJ_CHECKOUT_V1_ARCHITECTURE.md §9/§10).
 *
 * يعيد استعمال `CommerceCartService` مباشرةً لحلّ رمز السلة وتسلسل حالتها —
 * لا منطق سلة أو تسعير مكرَّر هنا (§7: "Checkout V1 does not introduce a
 * second pricing engine"). الأساليب الخاصة أدناه (`lockActiveCart`,
 * `lockUsableCheckout`) تكرّر عمداً نمط قفل قصير من `CommerceCartService`
 * بدل توسيع واجهته العامة — Checkout لا يغيّر قواعد Cart ولا يُدخلها في
 * التزامٍ جديد.
 */
final class CommerceCheckoutService
{
    /** جلسة دفع قصيرة العمر عمداً — أقصر بكثير من عمر السلة (30 يوماً). */
    public const LIFETIME_MINUTES = 60;

    /**
     * §5: لا محرك تسعير شحن حقيقي بعد في هذا المستودع (لا جدول تهيئة، لا
     * FulfillmentPolicy سعرياً). قائمة ثابتة في الكود — لا جدول جديد يُنشأ
     * هنا (تفادي بناء Shipping Engine) — يمثّل "الاختيارات المهيّأة من
     * الخادم صراحةً" التي تسمح بها §5 كحدّ أدنى. المبلغ صفر دائماً بصرف
     * النظر عن الطريقة المختارة إلى أن يوجد محرك تسعير شحن حقيقي (مهمّة
     * Shipping منفصلة) — لا يُخترَع سعر، ولا يُقبل من العميل مطلقاً.
     */
    public const DELIVERY_METHODS = ['pickup', 'standard'];

    public function __construct(private readonly CommerceCartService $carts) {}

    /**
     * Checkout الحالي الصالح لسلة رمز الكوكي المعطى، إن وُجد. لا ينشئ شيئاً.
     * مطابقٌ لعقد "GET يجلب فقط Checkout الحالي الصالح" — Checkout منتهي
     * الصلاحية يُنقَل حالته كسولاً ثم يُعامَل كغيابٍ تام، بنفس نمط
     * `CommerceCartService::findByToken()` حرفياً.
     *
     * @return array{checkout: ?CommerceCheckout, cart: ?CommerceCart, invalid: bool}
     */
    public function current(?string $cartToken): array
    {
        $cartLookup = $this->carts->findByToken($cartToken);
        if ($cartLookup['cart'] === null) {
            return ['checkout' => null, 'cart' => null, 'invalid' => $cartLookup['invalid']];
        }

        $cart = $cartLookup['cart'];
        $context = $this->context();

        $checkout = CommerceCheckout::query()
            ->where('cart_id', $cart->id)
            ->where('storefront_id', $context->storefrontId())
            ->where('sales_channel_id', $context->salesChannelId())
            ->whereIn('status', CommerceCheckout::OPEN_STATUSES)
            ->orderByDesc('created_at')
            ->first();

        if ($checkout === null) {
            return ['checkout' => null, 'cart' => $cart, 'invalid' => false];
        }

        if ($checkout->expires_at->isPast()) {
            return DB::transaction(function () use ($checkout, $cart, $context): array {
                $current = CommerceCheckout::query()
                    ->whereKey($checkout->id)
                    ->where('storefront_id', $context->storefrontId())
                    ->where('sales_channel_id', $context->salesChannelId())
                    ->lockForUpdate()
                    ->first();

                if ($current === null || ! $current->isOpen()) {
                    return ['checkout' => null, 'cart' => $cart, 'invalid' => false];
                }

                if (! $current->expires_at->isPast()) {
                    return ['checkout' => $current, 'cart' => $cart, 'invalid' => false];
                }

                $current->update(['status' => CommerceCheckout::STATUS_EXPIRED]);

                return ['checkout' => null, 'cart' => $cart, 'invalid' => false];
            });
        }

        return ['checkout' => $checkout, 'cart' => $cart, 'invalid' => false];
    }

    /**
     * ينشئ Checkout جديداً لسلة رمز الكوكي، أو يستأنف الحالي الصالح لها.
     * لا ينشئ سلةً أبداً (§ ممنوع صراحةً) — سلة غير موجودة/غير صالحة تفشل
     * مغلقاً بـ CheckoutNotFoundException.
     *
     * @return array{checkout: CommerceCheckout, cart: CommerceCart, created: bool}
     */
    public function createOrResume(?string $cartToken): array
    {
        $cartLookup = $this->carts->findByToken($cartToken);
        if ($cartLookup['cart'] === null) {
            throw new CheckoutNotFoundException('السلة غير متاحة لبدء الدفع.');
        }
        $context = $this->context();

        return DB::transaction(function () use ($cartLookup, $context): array {
            $cart = $this->lockActiveCart($cartLookup['cart']->id, $context);

            $existing = CommerceCheckout::query()
                ->where('cart_id', $cart->id)
                ->where('storefront_id', $context->storefrontId())
                ->where('sales_channel_id', $context->salesChannelId())
                ->whereIn('status', CommerceCheckout::OPEN_STATUSES)
                ->lockForUpdate()
                ->first();

            if ($existing !== null && ! $existing->expires_at->isPast()) {
                return ['checkout' => $existing, 'cart' => $cart, 'created' => false];
            }

            if ($existing !== null) {
                $existing->update(['status' => CommerceCheckout::STATUS_EXPIRED]);
            }

            $checkout = CommerceCheckout::create([
                'storefront_id' => $context->storefrontId(),
                'sales_channel_id' => $context->salesChannelId(),
                'cart_id' => $cart->id,
                'expires_at' => now()->addMinutes(self::LIFETIME_MINUTES),
            ]);

            return ['checkout' => $checkout, 'cart' => $cart, 'created' => true];
        }, 3);
    }

    /** @param array<string, string|null> $fields مفاتيحها أعمدة contact_* جاهزة من المتحكّم. */
    public function updateContact(CommerceCheckout $knownCheckout, array $fields): array
    {
        return DB::transaction(function () use ($knownCheckout, $fields): array {
            $checkout = $this->lockUsableCheckout($knownCheckout->id);
            $checkout->update($fields + ['expires_at' => now()->addMinutes(self::LIFETIME_MINUTES)]);

            return $this->serialize($checkout, $this->cartFor($checkout));
        }, 3);
    }

    /** @param array<string, string|null> $fields مفاتيحها أعمدة delivery_* (عنوان) جاهزة من المتحكّم. */
    public function updateAddress(CommerceCheckout $knownCheckout, array $fields): array
    {
        return DB::transaction(function () use ($knownCheckout, $fields): array {
            $checkout = $this->lockUsableCheckout($knownCheckout->id);
            $checkout->update($fields + ['expires_at' => now()->addMinutes(self::LIFETIME_MINUTES)]);

            return $this->serialize($checkout, $this->cartFor($checkout));
        }, 3);
    }

    /**
     * يختار طريقة توصيل من `DELIVERY_METHODS` الثابتة فقط. لا بارامتر مبلغ
     * إطلاقاً في هذا التوقيع — بنيوياً يستحيل تمرير مبلغٍ من العميل عبره؛
     * `delivery_amount_minor` يبقى صفراً دائماً (سلطة خادم، §5).
     */
    public function updateDelivery(CommerceCheckout $knownCheckout, string $method): array
    {
        if (! in_array($method, self::DELIVERY_METHODS, true)) {
            throw new RuntimeException('طريقة توصيل غير معروفة.');
        }

        return DB::transaction(function () use ($knownCheckout, $method): array {
            $checkout = $this->lockUsableCheckout($knownCheckout->id);
            $checkout->update([
                'delivery_method' => $method,
                'delivery_amount_minor' => 0,
                'expires_at' => now()->addMinutes(self::LIFETIME_MINUTES),
            ]);

            return $this->serialize($checkout, $this->cartFor($checkout));
        }, 3);
    }

    /** @return array<string, mixed> */
    public function serialize(?CommerceCheckout $checkout, ?CommerceCart $cart): array
    {
        $cartData = $this->carts->serialize($cart);

        if ($checkout === null) {
            return $this->emptyResponse($cartData);
        }

        return [
            'status' => $checkout->status,
            'contact' => [
                'name' => $checkout->contact_name,
                'phone' => $checkout->contact_phone,
                'email' => $checkout->contact_email,
            ],
            'delivery' => [
                'method' => $checkout->delivery_method,
                'amount' => [
                    'amount_minor' => $checkout->delivery_amount_minor,
                    'currency' => $cartData['currency'],
                ],
                'address' => [
                    'country' => $checkout->delivery_country,
                    'region' => $checkout->delivery_region,
                    'city' => $checkout->delivery_city,
                    'district' => $checkout->delivery_district,
                    'street' => $checkout->delivery_street,
                    'postal_code' => $checkout->delivery_postal_code,
                    'notes' => $checkout->delivery_notes,
                ],
            ],
            'cart' => $cartData,
        ];
    }

    /**
     * إعادة تحقّق قصيرة العمر لسلة صالحة تحت قفل — تكرّر عمداً نمط
     * `CommerceCartService::lockUsableCart()` الخاص بدل توسيع واجهته
     * العامة أو تعديل Cart. سلة غير صالحة (منتهية/مؤسّسة لسياقٍ آخر) تفشل
     * مغلقاً.
     */
    private function lockActiveCart(string $cartId, StorefrontContext $context): CommerceCart
    {
        $cart = CommerceCart::query()
            ->whereKey($cartId)
            ->where('tenant_id', $context->tenantId())
            ->where('storefront_id', $context->storefrontId())
            ->where('sales_channel_id', $context->salesChannelId())
            ->where('status', CommerceCart::STATUS_ACTIVE)
            ->where('expires_at', '>', now())
            ->lockForUpdate()
            ->first();

        if ($cart === null) {
            throw new CheckoutNotFoundException('السلة غير متاحة لبدء الدفع.');
        }

        return $cart;
    }

    private function lockUsableCheckout(string $checkoutId): CommerceCheckout
    {
        $context = $this->context();
        $checkout = CommerceCheckout::query()
            ->whereKey($checkoutId)
            ->where('tenant_id', $context->tenantId())
            ->where('storefront_id', $context->storefrontId())
            ->where('sales_channel_id', $context->salesChannelId())
            ->whereIn('status', CommerceCheckout::OPEN_STATUSES)
            ->where('expires_at', '>', now())
            ->lockForUpdate()
            ->first();

        if ($checkout === null) {
            throw new CheckoutNotFoundException('جلسة الدفع غير متاحة.');
        }

        return $checkout;
    }

    private function cartFor(CommerceCheckout $checkout): ?CommerceCart
    {
        return CommerceCart::find($checkout->cart_id);
    }

    private function context(): StorefrontContext
    {
        $context = app(StorefrontContext::class);
        if (! $context->isEstablished()
            || ! $context->hasStorefront()
            || app(TenantContext::class)->id() !== $context->tenantId()
        ) {
            throw new RuntimeException('لا يوجد سياق متجر موثوق.');
        }

        return $context;
    }

    /** @return array<string, mixed> */
    private function emptyResponse(array $cartData): array
    {
        return [
            'status' => null,
            'contact' => ['name' => null, 'phone' => null, 'email' => null],
            'delivery' => [
                'method' => null,
                'amount' => ['amount_minor' => 0, 'currency' => $cartData['currency']],
                'address' => [
                    'country' => null, 'region' => null, 'city' => null, 'district' => null,
                    'street' => null, 'postal_code' => null, 'notes' => null,
                ],
            ],
            'cart' => $cartData,
        ];
    }
}
