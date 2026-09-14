<?php

namespace App\Services\Commerce;

use App\Models\CommerceCart;
use App\Models\CommerceCartItem;
use App\Models\CommerceCheckout;
use App\Models\CommerceListing;
use App\Models\CommerceOrder;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\UnitTemplateUnit;
use App\Services\Accounting\UnitConversion;
use App\Tenancy\BranchScope;
use App\Tenancy\StorefrontContext;
use App\Tenancy\TenantContext;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * COM-CHECKOUT-1A أساس Checkout؛ COM-CHECKOUT-1B يضيف `complete()` — إعادة
 * تحقّق نهائية + إتمامٌ idempotent ينشئ `CommerceOrder` واحداً بالضبط (راجع
 * docs/plans/commerce/AWJ_CHECKOUT_V1_ARCHITECTURE.md §9/§10).
 *
 * يعيد استعمال `CommerceCartService` مباشرةً لحلّ رمز السلة وتسلسل حالتها —
 * لا منطق سلة أو تسعير مكرَّر هنا (§7: "Checkout V1 does not introduce a
 * second pricing engine"). الأساليب الخاصة أدناه (`lockActiveCart`,
 * `lockUsableCheckout`, `resolveUnit`) تكرّر عمداً أنماطاً خاصة من
 * `CommerceCartService`/`CommerceOrderService` بدل توسيع واجهتيهما العامتين
 * — Checkout لا يغيّر قواعد Cart ولا يُدخلها في التزامٍ جديد؛ `create()`
 * القديم في `CommerceOrderService` يبقى بلا أيّ تعديل.
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

    public function __construct(
        private readonly CommerceCartService $carts,
        private readonly CommercePriceResolver $prices,
        private readonly UnitConversion $units,
        private readonly FulfillmentPolicyService $fulfillment,
        private readonly InventoryReservationService $reservations,
        private readonly CommerceOrderService $orders,
    ) {}

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
     * COM-CHECKOUT-1B — إيجاد Checkout لهذا الكوكي **مهما كانت حالته**
     * (نشط/جاهز/**مكتمل**)، على عكس `current()` التي تقصر عمداً على الحالات
     * المفتوحة (لا يجوز تعديل Checkout مكتمل). `complete()` يحتاج تحديداً
     * الوصول لصفّ **مكتمل** أيضاً — تلك بالضبط الحالة التي تُفعِّل منطق
     * إعادة التشغيل/التعارض لمفتاح Idempotency-Key؛ استعمال `current()` هنا
     * كان سيُرجع 404 دوماً لأي محاولة إتمامٍ ثانية، فيُسقط عقد Idempotency-Key
     * بالكامل بمجرد نجاح أول إتمام.
     *
     * @return array{checkout: ?CommerceCheckout, invalid: bool}
     */
    public function resolveForCompletion(?string $cartToken): array
    {
        $cartLookup = $this->carts->findByToken($cartToken);
        if ($cartLookup['cart'] === null) {
            return ['checkout' => null, 'invalid' => $cartLookup['invalid']];
        }

        $cart = $cartLookup['cart'];
        $context = $this->context();

        $checkout = CommerceCheckout::query()
            ->where('cart_id', $cart->id)
            ->where('storefront_id', $context->storefrontId())
            ->where('sales_channel_id', $context->salesChannelId())
            ->whereIn('status', [...CommerceCheckout::OPEN_STATUSES, CommerceCheckout::STATUS_COMPLETED])
            ->orderByDesc('created_at')
            ->first();

        return ['checkout' => $checkout, 'invalid' => false];
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

    /**
     * ═══════════════════════════════════════════════════════════════
     *  COM-CHECKOUT-1B — إتمامٌ idempotent
     * ═══════════════════════════════════════════════════════════════
     * `transaction -> lock checkout/cart -> verify context -> revalidate
     * lines/prices/stock -> recompute totals -> enforce idempotency ->
     * create exactly one CommerceOrder -> mark checkout completed -> commit`
     * (§9 حرفياً). لا يثق بأي إجمالي/سعر/مبلغ توصيل من العميل — كل شيء
     * يُعاد حسمه هنا من سلطاته المعتمدة فقط.
     *
     * @return array{order: CommerceOrder, replayed: bool}
     *
     * @throws CheckoutNotFoundException Checkout/Cart غير متاحين (غائب/منتهٍ/سياق مختلف).
     * @throws CheckoutIdempotencyConflictException نفس المفتاح بحمولة مختلفة،
     *                                              أو مفتاحٌ مختلف على
     *                                              Checkout مكتملٍ بالفعل.
     * @throws CheckoutReviewRequiredException سطرٌ غير متاح/سعرٌ غير محسوم/
     *                                         وحدةٌ غير صالحة/مخزونٌ غير
     *                                         كافٍ، أو بيانات تواصل/توصيل
     *                                         ناقصة — لا Order يُنشأ.
     */
    public function complete(CommerceCheckout $knownCheckout, string $idempotencyKeyHash, string $idempotencyFingerprint): array
    {
        $context = $this->context();

        return DB::transaction(function () use ($knownCheckout, $idempotencyKeyHash, $idempotencyFingerprint, $context): array {
            $checkout = CommerceCheckout::query()
                ->whereKey($knownCheckout->id)
                ->where('tenant_id', $context->tenantId())
                ->where('storefront_id', $context->storefrontId())
                ->where('sales_channel_id', $context->salesChannelId())
                ->lockForUpdate()
                ->first();

            if ($checkout === null) {
                throw new CheckoutNotFoundException('جلسة الدفع غير متاحة.');
            }

            if ($checkout->status === CommerceCheckout::STATUS_COMPLETED) {
                return $this->replayOrConflict($checkout, $idempotencyKeyHash, $idempotencyFingerprint);
            }

            if (! $checkout->isOpen() || $checkout->expires_at->isPast()) {
                throw new CheckoutNotFoundException('جلسة الدفع غير متاحة.');
            }

            // نفس سلة Checkout هذا حصراً — بنفس تحقّق السياق الكامل
            // (tenant/storefront/channel) الذي تفرضه CHECKOUT-1A، لا ثقة
            // بحالة `cart_id` المخزَّنة وحدها.
            $cart = CommerceCart::query()
                ->whereKey($checkout->cart_id)
                ->where('tenant_id', $context->tenantId())
                ->where('storefront_id', $context->storefrontId())
                ->where('sales_channel_id', $context->salesChannelId())
                ->where('status', CommerceCart::STATUS_ACTIVE)
                ->where('expires_at', '>', now())
                ->lockForUpdate()
                ->first();

            if ($cart === null) {
                throw new CheckoutNotFoundException('السلة غير متاحة لإتمام الدفع.');
            }

            if ($checkout->contact_name === null || trim($checkout->contact_name) === '') {
                throw new CheckoutReviewRequiredException(
                    'بيانات التواصل غير مكتملة.',
                    [['item_id' => 'contact', 'reason' => 'contact_incomplete']],
                );
            }

            if ($checkout->delivery_method === null) {
                throw new CheckoutReviewRequiredException(
                    'طريقة التوصيل غير مختارة.',
                    [['item_id' => 'delivery', 'reason' => 'delivery_method_missing']],
                );
            }

            $items = $cart->items()->orderBy('created_at')->orderBy('id')->get();
            if ($items->isEmpty()) {
                throw new CheckoutReviewRequiredException(
                    'السلة فارغة.',
                    [['item_id' => 'cart', 'reason' => 'empty_cart']],
                );
            }

            $lines = $this->revalidateAndPrice($items, $context);

            $order = $this->orders->createFromCheckout([
                'sales_channel_id' => $context->salesChannelId(),
                'storefront_id' => $context->storefrontId(),
                'commerce_checkout_id' => $checkout->id,
                'delivery_method' => $checkout->delivery_method,
                'contact_name' => $checkout->contact_name,
                'contact_phone' => $checkout->contact_phone,
                'contact_email' => $checkout->contact_email,
                'delivery_country' => $checkout->delivery_country,
                'delivery_city' => $checkout->delivery_city,
                'delivery_district' => $checkout->delivery_district,
                'delivery_street' => $checkout->delivery_street,
                'delivery_postal_code' => $checkout->delivery_postal_code,
                'delivery_notes' => $checkout->delivery_notes,
            ], $lines);

            $checkout->update([
                'status' => CommerceCheckout::STATUS_COMPLETED,
                'completion_idempotency_key_hash' => $idempotencyKeyHash,
                'completion_idempotency_fingerprint' => $idempotencyFingerprint,
            ]);

            return ['order' => $order, 'replayed' => false];
        });
    }

    /**
     * Checkout مكتملٌ بالفعل: نفس المفتاح+البصمة ⇐ إعادة تشغيل (نفس الطلب)؛
     * غير ذلك ⇐ تعارض — لا طلب ثانٍ لأي checkout مكتمل مهما كان المفتاح.
     *
     * @return array{order: CommerceOrder, replayed: bool}
     */
    private function replayOrConflict(CommerceCheckout $checkout, string $keyHash, string $fingerprint): array
    {
        if ($checkout->completion_idempotency_key_hash !== null
            && hash_equals($checkout->completion_idempotency_key_hash, $keyHash)
            && hash_equals((string) $checkout->completion_idempotency_fingerprint, $fingerprint)
        ) {
            $order = CommerceOrder::query()->where('commerce_checkout_id', $checkout->id)->first();
            if ($order === null) {
                // دفاعي بحت: الفريدة على commerce_checkout_id + كتابتهما معاً
                // في نفس المعاملة يضمنان استحالة هذا — لا مسار حقيقي يبلغه.
                throw new CheckoutNotFoundException('جلسة الدفع مكتملة بلا طلبٍ مرتبط.');
            }

            return ['order' => $order, 'replayed' => true];
        }

        throw new CheckoutIdempotencyConflictException('جلسة الدفع مكتملة بالفعل بمفتاحٍ أو حمولةٍ مختلفة.');
    }

    /**
     * إعادة التحقّق النهائية لكل سطر — نفس أهلية `CommerceCartService::
     * purchasable()` (منتج نشط + عرضٌ منشور على القناة + وحدة صالحة + سعرٌ
     * محسوم) بالإضافة لفحص توفّرٍ نهائي (قراءة فقط، **لا** `InventoryReservationService
     * ::acquire()` — لا حجز في 1B). فشل أي سطر لا يوقف الحلقة: كل الأسباب
     * تُجمَع لتُعرَض معاً في استجابة review-required واحدة.
     *
     * @param  Collection<int, CommerceCartItem>  $items
     * @return array<int, array{product_id: string, product_name_snapshot: string, quantity: int, unit_name: ?string, unit_factor: int, unit_price: int, line_total: int}>
     *
     * @throws CheckoutReviewRequiredException سطرٌ واحد أو أكثر غير صالح للإتمام.
     */
    private function revalidateAndPrice($items, StorefrontContext $context): array
    {
        $warehouse = null;
        $lines = [];
        $failures = [];

        foreach ($items as $item) {
            if ($item->product_id === null) {
                $failures[] = ['item_id' => $item->id, 'reason' => 'unavailable'];

                continue;
            }

            $product = Product::query()
                ->withoutGlobalScope(BranchScope::class)
                ->whereKey($item->product_id)
                ->where('is_active', true)
                ->lockForUpdate()
                ->first();
            if ($product === null) {
                $failures[] = ['item_id' => $item->id, 'reason' => 'unavailable'];

                continue;
            }

            $listing = CommerceListing::query()
                ->where('product_id', $product->id)
                ->where('sales_channel_id', $context->salesChannelId())
                ->where('is_published', true)
                ->lockForUpdate()
                ->first(['id']);
            if ($listing === null) {
                $failures[] = ['item_id' => $item->id, 'reason' => 'unavailable'];

                continue;
            }

            try {
                [, , $resolverUnit] = $this->resolveUnit($product, $item->unit_key);
            } catch (RuntimeException) {
                $failures[] = ['item_id' => $item->id, 'reason' => 'uom_invalid'];

                continue;
            }

            $price = $this->prices->resolve($product->id, $context->salesChannelId(), null, $resolverUnit, true);
            if (! $price->resolved || $price->amount === null) {
                $failures[] = ['item_id' => $item->id, 'reason' => 'price_unresolved'];

                continue;
            }

            try {
                [$snapshotUnitName, $unitFactor] = $this->units->resolve($product, $resolverUnit);
            } catch (RuntimeException) {
                $failures[] = ['item_id' => $item->id, 'reason' => 'uom_invalid'];

                continue;
            }

            // منتج/خدمة غير متتبَّعة المخزون (الافتراض الفعلي) لا فحص توفّرٍ
            // لها — نفس تخطّي CommerceOrderReservationService::reserve() حرفياً.
            if ($product->track_inventory) {
                if ($warehouse === null) {
                    try {
                        $warehouse = $this->fulfillment->resolveWarehouseFor($context->salesChannelId());
                    } catch (FulfillmentPolicyNotConfiguredException) {
                        $failures[] = ['item_id' => $item->id, 'reason' => 'fulfillment_not_configured'];

                        continue;
                    }
                }

                $stockRow = ProductWarehouseStock::query()
                    ->where('product_id', $product->id)
                    ->where('warehouse_id', $warehouse->id)
                    ->lockForUpdate()
                    ->first();
                $onHand = (int) ($stockRow->quantity ?? 0);
                $activeReserved = $this->reservations->activeReservedQuantity($product->id, $warehouse->id);
                $available = max(0, $onHand - $activeReserved);
                $baseQuantity = $item->quantity * max(1, $unitFactor);

                if ($available < $baseQuantity) {
                    $failures[] = ['item_id' => $item->id, 'reason' => 'insufficient_stock'];

                    continue;
                }
            }

            $lines[] = [
                'product_id' => $product->id,
                'product_name_snapshot' => $product->name,
                'quantity' => $item->quantity,
                'unit_name' => $snapshotUnitName,
                'unit_factor' => $unitFactor,
                'unit_price' => $price->amount,
                'line_total' => $price->amount * $item->quantity,
            ];
        }

        if ($failures !== []) {
            throw new CheckoutReviewRequiredException('بعض عناصر السلة تغيّرت — راجع السلة قبل الإتمام.', $failures);
        }

        return $lines;
    }

    /**
     * فكّ `unit_key` المخزَّن على سطر السلة (`base` أو `unit:{uuid}`) إلى
     * [مفتاحٌ قانوني، اسمٌ للعرض، اسمٌ لسلطتَي التسعير/التحويل] — نسخة طبق
     * الأصل من نظير `CommerceCartService` الخاص (لا مصدر ثانٍ رسمي، توثيق
     * الصنف أعلاه يشرح سبب التكرار المتعمَّد بدل التوسيع).
     *
     * @return array{string, string, ?string}
     */
    private function resolveUnit(Product $product, string $unitKey): array
    {
        if ($unitKey === 'base') {
            return ['base', (string) $product->unit, null];
        }

        if (! str_starts_with($unitKey, 'unit:')) {
            throw new RuntimeException('مفتاح الوحدة غير صالح.');
        }

        $unitId = substr($unitKey, 5);
        if (! Str::isUuid($unitId) || $product->unit_template_id === null) {
            throw new RuntimeException('مفتاح الوحدة غير صالح.');
        }

        $unit = UnitTemplateUnit::query()
            ->whereKey($unitId)
            ->where('unit_template_id', $product->unit_template_id)
            ->first();
        if ($unit === null) {
            throw new RuntimeException('الوحدة غير متاحة لهذا المنتج.');
        }

        return ['unit:'.$unit->id, $unit->name, $unit->name];
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
