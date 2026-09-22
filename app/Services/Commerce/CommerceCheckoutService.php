<?php

namespace App\Services\Commerce;

use App\Models\CommerceCart;
use App\Models\CommerceCartItem;
use App\Models\CommerceCheckout;
use App\Models\CommerceListing;
use App\Models\CommerceOrder;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\SalesChannel;
use App\Models\UnitTemplateUnit;
use App\Services\Accounting\UnitConversion;
use App\Support\DocumentLineVariantResolver;
use App\Tenancy\BranchScope;
use App\Tenancy\CustomerContext;
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
 *
 * ═══════════════════════════════════════════════════════════════
 *  عقد فحص التوفّر (Post-Review P1) — قراءةٌ لحظية، لا تخصيص
 * ═══════════════════════════════════════════════════════════════
 * `complete()` يتحقّق من توفّر مخزونٍ **كافٍ وقت الإتمام** فقط. هو **ليس**
 * ضماناً ضد البيع الزائد (overselling): لا يستهلك الكمية ولا يحجزها (لا
 * `InventoryReservation`، لا `StockMovement` — ممنوعان صراحةً في 1B). فور
 * التزام (commit) معاملة الإتمام، الكمية «المتاحة» تعود كما كانت — أي
 * Checkout آخر لنفس المنتج يرى نفس الرصيد ويمكنه إنشاء طلبٍ آخر عليه أيضاً.
 * منع البيع الزائد فعلياً يتطلّب سياسة تخصيص/حجز (`ADR-02 §5`، ما زالت غير
 * محسومة عمداً) — خارج نطاق 1B تماماً. `lockForUpdate()` على صفّ
 * `ProductWarehouseStock` (انظر `revalidateAndPrice()`) قيمته الحقيقية
 * الوحيدة: قراءة الرصيد **بعد** أي كاتبٍ حقيقي آخر يقفل نفس الصفّ فعلاً
 * (مثل `InventoryService::adjustWarehouseStock()` من بيعٍ حقيقي في مكانٍ
 * آخر من النظام) بدل قيمةٍ قديمة — لا لأنه يحمي من إتمامَي Checkout
 * متنافسين، فكلاهما قارئٌ فقط لا يكتب شيئاً يُسلسِل الآخر ضده.
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
     * (Codex, PR #924, P1, seventh round) يستعمل `resolveCurrent()` لا
     * `findByToken()`: الأخيرة تُرجع سلة الضيف المطابقة للرمز مباشرةً بلا أي
     * دمج، فعميلٌ مُصادَقٌ له سلةٌ قائمة فعلاً كان يرى Checkout سلة الضيف
     * الخام — سلته الحقيقية تُتجاهَل بصمت. لا تغيير لمسار الويب/الضيف: حين
     * لا `CustomerContext` مؤسَّس، `resolveCurrent()` هي `findByToken()`
     * حرفياً (راجع تعريفها).
     *
     * @return array{checkout: ?CommerceCheckout, cart: ?CommerceCart, invalid: bool, rebound: ?string}
     */
    /**
     * (Codex, PR #924, P1, tenth round) النسخة المُقفَلة من إعادة تحقّق
     * الملكية قبل التسليم — نفس `CommerceCartService::serializeForOwnedRead()`
     * حرفياً، لكن تُسلسِل أيضاً `serialize()` الخاص بـCheckout (يقرأ حقول
     * Checkout نفسها: جهة الاتصال والعنوان، لا سلته فقط) داخل نفس المعاملة
     * والقفل. `show()` و`complete()`'s الفرع المتعلّق بـreview-required
     * يستدعيانها بدل `serialize()` العام مباشرة.
     *
     * @return array{data: array<string, mixed>, owned: bool}
     */
    public function serializeForOwnedRead(?CommerceCheckout $checkout, ?CommerceCart $cart): array
    {
        if ($cart === null) {
            return ['data' => $this->serialize($checkout, null), 'owned' => true];
        }

        return DB::transaction(function () use ($checkout, $cart): array {
            $context = $this->context();
            $lockedCart = $this->scopeToContext(CommerceCart::query(), $context)
                ->whereKey($cart->id)
                ->lockForUpdate()
                ->first();

            if ($lockedCart === null || ! $this->carts->cartModelOwnedByCurrentBearer($lockedCart)) {
                return ['data' => [], 'owned' => false];
            }

            $lockedCheckout = $checkout !== null
                ? $this->scopeToContext(CommerceCheckout::query(), $context)->whereKey($checkout->id)->lockForUpdate()->first()
                : null;

            return ['data' => $this->serialize($lockedCheckout, $lockedCart), 'owned' => true];
        }, 3);
    }

    public function current(?string $cartToken): array
    {
        $cartLookup = $this->carts->resolveCurrent($cartToken);
        if ($cartLookup['cart'] === null) {
            return ['checkout' => null, 'cart' => null, 'invalid' => $cartLookup['invalid'], 'rebound' => null];
        }

        $cart = $cartLookup['cart'];
        $rebound = $cartLookup['rebound'];
        $context = $this->context();

        $checkout = $this->scopeToContext(CommerceCheckout::query(), $context)
            ->where('cart_id', $cart->id)
            ->whereIn('status', CommerceCheckout::OPEN_STATUSES)
            ->orderByDesc('created_at')
            ->first();

        if ($checkout === null) {
            return ['checkout' => null, 'cart' => $cart, 'invalid' => false, 'rebound' => $rebound];
        }

        if ($checkout->expires_at->isPast()) {
            return DB::transaction(function () use ($checkout, $cart, $context, $rebound): array {
                $current = $this->scopeToContext(CommerceCheckout::query(), $context)
                    ->whereKey($checkout->id)
                    ->lockForUpdate()
                    ->first();

                if ($current === null || ! $current->isOpen()) {
                    return ['checkout' => null, 'cart' => $cart, 'invalid' => false, 'rebound' => $rebound];
                }

                if (! $current->expires_at->isPast()) {
                    return ['checkout' => $current, 'cart' => $cart, 'invalid' => false, 'rebound' => $rebound];
                }

                $current->update(['status' => CommerceCheckout::STATUS_EXPIRED]);

                return ['checkout' => null, 'cart' => $cart, 'invalid' => false, 'rebound' => $rebound];
            });
        }

        return ['checkout' => $checkout, 'cart' => $cart, 'invalid' => false, 'rebound' => $rebound];
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
     * **`allowConsumed: true` (Cart One-Shot Lifecycle)**: أول إتمامٍ ناجح
     * ينقل السلة إلى `consumed` في نفس معاملة `complete()` — فإعادة تشغيل
     * نفس مفتاح Idempotency-Key بعد ذلك يجب أن تصل لهذا Checkout رغم أن
     * سلته لم تعد `active`. هذا لا يفتح باباً لإنشاء Checkout/Order جديد:
     * `complete()` نفسها ترى `status === STATUS_COMPLETED` فتذهب مباشرةً
     * إلى `replayOrConflict()` بلا أي قفلٍ جديدٍ على السلة، ومسارا
     * `current()`/`createOrResume()` أدناه يبقيان بلا `allowConsumed` عمداً
     * فيرفضان سلةً مُستهلَكة كأي سلةٍ غير `active`.
     *
     * **سلةٌ `consumed`**: القرار أعلاه (أحدث Checkout ضمن حالاتٍ مقبولة)
     * يفترض ضمناً أن السلة لا تحمل إلا Checkout واحداً ذا صلة — صحيحٌ دائماً
     * لسلةٍ استُهلكت عبر `complete()` الحالية (تستهلك السلة وتُنشئ الطلب في
     * نفس المعاملة، فلا Checkout آخر ذو صلة يمكن أن ينشأ بعدها). لكنه **غير
     * مضمون لبيانات تاريخية** استُهلكت عبر migration الـbackfill: سلةٌ من
     * قبل Cart One-Shot Lifecycle قد تحمل Checkout مكتملاً حقيقياً (ومرتبطاً
     * بـ`CommerceOrder` فعلياً) **و** Checkout أحدث فُتح لاحقاً (من علّة
     * `createOrResume()` الأصلية قبل إصلاحها) وبقي مفتوحاً بلا إتمام. أحدثُ-
     * أولاً بين `{مفتوح، مكتمل}` كان يختار حينها الـCheckout المفتوح الخاطئ
     * — لا صلة له بالطلب الفعلي — فتفشل إعادة تشغيل مفتاح Idempotency-Key
     * الأصلي مغلقاً (404) بدل إعادة الطلب الحقيقي.
     * لذلك: لسلةٍ `consumed`، السلطة هي وجود `CommerceOrder` مرتبط
     * (`CommerceCheckout::order()`) — دليلٌ مباشر لا `status` وحده، ونفس
     * الدليل الذي اعتمده backfill نفسه — لا "الأحدث من أي حالةٍ مقبولة".
     * `whereHas('order')` يمرّ عبر نفس `TenantScope`/`scopeToContext()`
     * أعلاه فلا تسرّب مستأجرَ آخر. لا تغيير على القرار الطبيعي (سلةٌ لا تزال
     * `active` وقت الاستدعاء) إطلاقاً.
     *
     * @return array{checkout: ?CommerceCheckout, invalid: bool}
     */
    public function resolveForCompletion(?string $cartToken): array
    {
        $cartLookup = $this->carts->findByToken($cartToken, allowConsumed: true);
        if ($cartLookup['cart'] === null) {
            return ['checkout' => null, 'invalid' => $cartLookup['invalid']];
        }

        $cart = $cartLookup['cart'];
        $context = $this->context();

        if ($cart->status === CommerceCart::STATUS_CONSUMED) {
            $checkout = $this->scopeToContext(CommerceCheckout::query(), $context)
                ->where('cart_id', $cart->id)
                ->whereHas('order')
                ->orderByDesc('created_at')
                ->first();

            return ['checkout' => $checkout, 'invalid' => false];
        }

        $checkout = $this->scopeToContext(CommerceCheckout::query(), $context)
            ->where('cart_id', $cart->id)
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
     * **حارس عدم التكرار (Post-Review P1، PR-4) — تراجعيٌّ الآن (Cart
     * One-Shot Lifecycle)**: كان هذا الحارس أساسياً حين تبقى السلة
     * `status=active` بعد `complete()`. بعد أن أصبح `complete()` ينقل السلة
     * إلى `CommerceCart::STATUS_CONSUMED` في نفس معاملة الإتمام (راجع
     * توثيقها)، `lockActiveCart()` أدناه — الذي يشترط `status=active` — يرفض
     * أي `POST checkout` على سلةٍ استُهلكت **قبل** الوصول لهذا الفرع أصلاً؛
     * فلا مسارٍ حيٍّ يبلغه بعد اليوم لسلةٍ استُهلكت عبر هذا الإصلاح نفسه.
     * يبقى **دفاعاً احتياطياً** لبيانات تاريخية من قبل هذا الإصلاح (سلةٌ
     * `active` قديمة تحمل Checkout `completed` بالفعل من النسخة السابقة) —
     * إن وُجد، يُستأنَف هو نفسه ولا يُنشأ Checkout جديد أبداً، فيُعاد كل
     * إتمامٍ لاحق إلى `complete()`/`replayOrConflict()` الموجودتين أصلاً
     * وآمنتين تماماً (نفس المفتاح ⇐ إعادة نفس الطلب، مفتاحٌ مختلف ⇐ 409
     * تعارض) — لا آلية idempotency موازية جديدة، ولا عمود/جدول جديد، ولا
     * تغيير على عقد `POST checkout` (لا يزال بلا Idempotency-Key، مطابقاً
     * لعقد `AWJ_CHECKOUT_V1_ARCHITECTURE.md` §9 حرفياً). ويب وجوال كلاهما
     * محميان معاً لأن الإصلاح في هذه الخدمة المشتركة، لا في متحكّمٍ واحد.
     *
     * (Codex, PR #924, P1, seventh round) يستعمل `resolveCurrent()` — نفس
     * سبب `current()` أعلاه حرفياً: بلا هذا، عميلٌ مُصادَقٌ يقدّم رمز سلة
     * ضيفٍ مباشرةً لهذا المسار كان يبدأ Checkout على سلة الضيف الخام بلا
     * أي دمج، متجاوزاً سلته الحالية بصمت.
     *
     * @return array{checkout: CommerceCheckout, cart: CommerceCart, created: bool, rebound: ?string}
     */
    public function createOrResume(?string $cartToken): array
    {
        $cartLookup = $this->carts->resolveCurrent($cartToken);
        if ($cartLookup['cart'] === null) {
            throw new CheckoutNotFoundException('السلة غير متاحة لبدء الدفع.');
        }
        $context = $this->context();
        $rebound = $cartLookup['rebound'];

        return DB::transaction(function () use ($cartLookup, $context, $rebound): array {
            $cart = $this->lockActiveCart($cartLookup['cart']->id, $context);

            $existing = $this->scopeToContext(CommerceCheckout::query(), $context)
                ->where('cart_id', $cart->id)
                ->whereIn('status', [...CommerceCheckout::OPEN_STATUSES, CommerceCheckout::STATUS_COMPLETED])
                ->orderByDesc('created_at')
                ->lockForUpdate()
                ->first();

            if ($existing !== null && $existing->status === CommerceCheckout::STATUS_COMPLETED) {
                return ['checkout' => $existing, 'cart' => $cart, 'created' => false, 'rebound' => $rebound];
            }

            if ($existing !== null && ! $existing->expires_at->isPast()) {
                return ['checkout' => $existing, 'cart' => $cart, 'created' => false, 'rebound' => $rebound];
            }

            if ($existing !== null) {
                $existing->update(['status' => CommerceCheckout::STATUS_EXPIRED]);
            }

            $checkout = CommerceCheckout::create([
                'storefront_id' => $context->hasStorefront() ? $context->storefrontId() : null,
                'sales_channel_id' => $context->salesChannelId(),
                'cart_id' => $cart->id,
                'expires_at' => now()->addMinutes(self::LIFETIME_MINUTES),
            ]);

            return ['checkout' => $checkout, 'cart' => $cart, 'created' => true, 'rebound' => $rebound];
        }, 3);
    }

    /** @param array<string, string|null> $fields مفاتيحها أعمدة contact_* جاهزة من المتحكّم. */
    public function updateContact(CommerceCheckout $knownCheckout, array $fields): array
    {
        return DB::transaction(function () use ($knownCheckout, $fields): array {
            $checkout = $this->lockUsableCheckout($knownCheckout);
            $checkout->update($fields + ['expires_at' => now()->addMinutes(self::LIFETIME_MINUTES)]);

            return $this->serialize($checkout, $this->cartFor($checkout));
        }, 3);
    }

    /** @param array<string, string|null> $fields مفاتيحها أعمدة delivery_* (عنوان) جاهزة من المتحكّم. */
    public function updateAddress(CommerceCheckout $knownCheckout, array $fields): array
    {
        return DB::transaction(function () use ($knownCheckout, $fields): array {
            $checkout = $this->lockUsableCheckout($knownCheckout);
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
            $checkout = $this->lockUsableCheckout($knownCheckout);
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
     * **فحص المخزون هنا لحظيٌّ لا تخصيصي** (راجع توثيق رأس الصنف): نجاح هذه
     * الدالة يعني أن كل سطر كان كافياً **وقت** استدعائها، لا أنه محجوزٌ لهذا
     * الطلب. Checkout آخر منافس على نفس المنتج قد ينجح أيضاً بعد التزام هذه
     * المعاملة مباشرة — منع البيع الزائد فعلياً مؤجَّلٌ لسياسة تخصيص/حجز لم
     * تُقرَّر بعد (`ADR-02 §5`)، خارج نطاق 1B.
     *
     * **محاولات = 3 (Post-Review P2)** — بنفس نمط `createOrResume()`/
     * `updateContact()`/`updateAddress()`/`updateDelivery()` أعلاه حرفياً،
     * لا استثناءً جديداً. `lockForUpdate()` متسلسلة (checkout ثم cart) تحت
     * حمل PostgreSQL حقيقي قابلة نادراً لـ`40P01 deadlock_detected` عابر —
     * ليس بسبب ترتيب أقفالٍ متعارض بنيوياً هنا، بل تفاعل قفل الصفّ مع فحص
     * قيد FK عند إدراج `commerce_orders` المرتبط، تحت جدولة نظامٍ محمَّل
     * (راجع commit الإصلاح لتفصيل الفحص). `handleTransactionException()` في
     * Laravel **لا** يعيد المحاولة إلا لاستثناء تزامنٍ فعلي (`40P01`/`40001`/
     * رسائل deadlock معروفة) — أي استثناء عملٍ آخر يُرمى فوراً بلا انتظار
     * (`CheckoutReviewRequiredException`، `CheckoutNotFoundException`،
     * `CheckoutIdempotencyConflictException` تبقى فورية كما هي). معاملة
     * متعارضة تُلغى بالكامل قبل إعادة المحاولة — لا طلب جزئي، لا تكرار،
     * ونفس منطق Idempotency-Key يُعاد تنفيذه بأمان لأن لا شيء التزم فعلياً.
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
            // (Codex, PR #924, P2, eleventh round) Cart locked before
            // checkout — `cart_id` is already known from `$knownCheckout`,
            // so no lookup is needed to discover it first. Matches
            // `createOrResume()`/`lockActiveCart()` and the read path's
            // `serializeForOwnedRead()`, both of which must lock the cart
            // first (their own cart id is the only one known in advance);
            // `lockUsableCheckout()` below now follows the same order,
            // closing a deadlock risk this method and it used to disagree on
            // under concurrent access.
            $cart = $this->scopeToContext(CommerceCart::query(), $context)
                ->whereKey($knownCheckout->cart_id)
                ->where('tenant_id', $context->tenantId())
                ->lockForUpdate()
                ->first();

            $checkout = $this->scopeToContext(CommerceCheckout::query(), $context)
                ->whereKey($knownCheckout->id)
                ->where('tenant_id', $context->tenantId())
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
            // (tenant/storefront أو null الجوّال/channel) الذي تفرضه
            // CHECKOUT-1A، لا ثقة بحالة `cart_id` المخزَّنة وحدها. القفل تمّ
            // أعلاه قبل معرفة إن كانت هذه إعادة تشغيل أصلاً (لا Checkout
            // معروفاً بعد) — الفحص هنا بعد التحميل، لا ضمن استعلام القفل.
            if ($cart === null || $cart->status !== CommerceCart::STATUS_ACTIVE || $cart->expires_at->isPast()) {
                throw new CheckoutNotFoundException('السلة غير متاحة لإتمام الدفع.');
            }

            $this->assertOwnedByCurrentBearer($cart);

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
                'storefront_id' => $context->hasStorefront() ? $context->storefrontId() : null,
                'commerce_checkout_id' => $checkout->id,
                'delivery_method' => $checkout->delivery_method,
                'contact_name' => $checkout->contact_name,
                'contact_phone' => $checkout->contact_phone,
                'contact_email' => $checkout->contact_email,
                'delivery_country' => $checkout->delivery_country,
                'delivery_region' => $checkout->delivery_region,
                'delivery_city' => $checkout->delivery_city,
                'delivery_district' => $checkout->delivery_district,
                'delivery_street' => $checkout->delivery_street,
                'delivery_building_no' => $checkout->delivery_building_no,
                'delivery_additional_number' => $checkout->delivery_additional_number,
                'delivery_postal_code' => $checkout->delivery_postal_code,
                'delivery_notes' => $checkout->delivery_notes,
            ], $lines);

            $checkout->update([
                'status' => CommerceCheckout::STATUS_COMPLETED,
                'completion_idempotency_key_hash' => $idempotencyKeyHash,
                'completion_idempotency_fingerprint' => $idempotencyFingerprint,
            ]);

            // Cart One-Shot Lifecycle: نفس المعاملة، نفس الصفّ المُقفَل أعلاه —
            // Order + Checkout مكتمل + Cart مُستهلَكة يلتزمون معاً أو لا شيء
            // منهم. سلةٌ واحدة تدعم طلباً ناجحاً واحداً على الأكثر؛ شراءٌ
            // تالٍ يبدأ سلةً ورمزاً جديدين دوماً (لا إعادة فتح `consumed`).
            $cart->update(['status' => CommerceCart::STATUS_CONSUMED]);

            return ['order' => $order, 'replayed' => false];
        }, 3);
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
     * محسوم) بالإضافة لفحص توفّرٍ **لحظي** (قراءة فقط، **لا** `InventoryReservationService
     * ::acquire()` — لا حجز في 1B، ولا تخصيصٌ فعلي للكمية؛ راجع "عقد فحص
     * التوفّر" في توثيق رأس الصنف — النجاح هنا لا يمنع Checkout آخر من رؤية
     * نفس الكمية «المتاحة» ونجاح إتمامه هو أيضاً). فشل أي سطر لا يوقف الحلقة:
     * كل الأسباب تُجمَع لتُعرَض معاً في استجابة review-required واحدة.
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

            // إعادة تحقّقٍ نهائية من هويّة المتغيّر — قد يكون تعطَّل أو انتمى
            // لمنتجٍ آخر بين الإضافة للسلة والإتمام؛ لا إعادة تفسيرٍ إلى شقيقٍ
            // أبداً، فشلٌ مغلَقٌ صريح (VAR-DOC-1/VAR-POS-1 السلطة نفسها).
            try {
                $variant = DocumentLineVariantResolver::resolve($product, $item->product_variant_id, $context->tenantId());
            } catch (RuntimeException) {
                $failures[] = ['item_id' => $item->id, 'reason' => 'unavailable'];

                continue;
            }

            try {
                [, , $resolverUnit] = $this->resolveUnit($product, $item->unit_key);
            } catch (RuntimeException) {
                $failures[] = ['item_id' => $item->id, 'reason' => 'uom_invalid'];

                continue;
            }

            $price = $this->prices->resolve($product->id, $context->salesChannelId(), null, $resolverUnit, true, $variant?->id);
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

                // lockForUpdate() هنا يضمن قراءة الرصيد بعد أي كاتبٍ حقيقي
                // آخر يقفل نفس الصفّ (بيعٌ فعلي في مكانٍ آخر من النظام)، لا
                // أنه يمنع إتمامَي Checkout متنافسين من كليهما رؤية نفس
                // الكمية والنجاح معاً — لا كتابة هنا تُسلسِلهما ضد بعضهما
                // (راجع "عقد فحص التوفّر" في توثيق رأس الصنف).
                // VAR-COM-1: مخزون المتغيّر الفعلي مستقلٌّ عن شقيقه — نفس صفّ
                // `product_warehouse_stock` الذي وسمته VAR-INV-1 بعمود
                // `product_variant_id` اختياري؛ `null` صريحاً لمنتجٍ بسيط.
                $stockRow = ProductWarehouseStock::query()
                    ->where('product_id', $product->id)
                    ->where('product_variant_id', $variant?->id)
                    ->where('warehouse_id', $warehouse->id)
                    ->lockForUpdate()
                    ->first();
                $onHand = (int) ($stockRow->quantity ?? 0);
                $activeReserved = $this->reservations->activeReservedQuantity($product->id, $warehouse->id, $variant?->id);
                $available = max(0, $onHand - $activeReserved);
                $baseQuantity = $item->quantity * max(1, $unitFactor);

                if ($available < $baseQuantity) {
                    $failures[] = ['item_id' => $item->id, 'reason' => 'insufficient_stock'];

                    continue;
                }
            }

            $lines[] = [
                'product_id' => $product->id,
                'product_variant_id' => $variant?->id,
                'variant_descriptor_snapshot' => $variant !== null ? DocumentLineVariantResolver::descriptor($variant) : null,
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
                    'building_no' => $checkout->delivery_building_no,
                    'additional_number' => $checkout->delivery_additional_number,
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
        $cart = $this->scopeToContext(CommerceCart::query(), $context)
            ->whereKey($cartId)
            ->where('tenant_id', $context->tenantId())
            ->where('status', CommerceCart::STATUS_ACTIVE)
            ->where('expires_at', '>', now())
            ->lockForUpdate()
            ->first();

        if ($cart === null) {
            throw new CheckoutNotFoundException('السلة غير متاحة لبدء الدفع.');
        }

        $this->assertOwnedByCurrentBearer($cart);

        return $cart;
    }

    /**
     * (Codex, PR #924, P1, seventh round) هذا Checkout نفسه لا يحمل هوية
     * مالكٍ مباشرة — ملكيته موروثة بالكامل من سلته عبر `cart_id`. قفلٌ على
     * Checkout وحده كان يترك نفس ثغرة السباق التي أُصلحت في
     * `lockUsableCart()`/`lockActiveCart()`: طلبٌ ضيفٌ يحلّ هذا الـCheckout
     * قبل أن تُطالِب به مصادقةٌ متزامنة، ثم يستمر بتعديل جهة الاتصال أو
     * العنوان بعد أن تغيّرت ملكية سلته فعلاً.
     *
     * (Codex, PR #924, P2, eleventh round) يأخذ نموذج Checkout الكامل لا
     * مجرّد معرّفه — `cart_id` معروفٌ منه مسبقاً فلا حاجة لاستعلامٍ يكتشفه
     * أولاً — كي يُقفَل السلة قبل الـCheckout، مطابقاً `complete()`/
     * `createOrResume()`/`serializeForOwnedRead()`: كانت هذه الدالة تقفل
     * بالترتيب المعاكس (Checkout ثم سلة)، وهو تعارضٌ حقيقي يفتح باب توقّفٍ
     * متبادل (deadlock) مع أي من تلك الثلاث تحت تزامنٍ حقيقي.
     */
    private function lockUsableCheckout(CommerceCheckout $knownCheckout): CommerceCheckout
    {
        $context = $this->context();

        $cart = $this->scopeToContext(CommerceCart::query(), $context)
            ->whereKey($knownCheckout->cart_id)
            ->lockForUpdate()
            ->first();

        $checkout = $this->scopeToContext(CommerceCheckout::query(), $context)
            ->whereKey($knownCheckout->id)
            ->where('tenant_id', $context->tenantId())
            ->whereIn('status', CommerceCheckout::OPEN_STATUSES)
            ->where('expires_at', '>', now())
            ->lockForUpdate()
            ->first();

        if ($checkout === null) {
            throw new CheckoutNotFoundException('جلسة الدفع غير متاحة.');
        }

        if ($cart === null) {
            throw new CheckoutNotFoundException('جلسة الدفع غير متاحة.');
        }

        $this->assertOwnedByCurrentBearer($cart);

        return $checkout;
    }

    /**
     * (Codex, PR #924, P1, seventh round) يعيد التحقق من ملكية السلة تحت
     * قفلها مباشرة — نفس مبدأ `CommerceCartService::lockUsableCart()`
     * حرفياً، مكرَّرٌ عمداً هنا بدل توسيع واجهة تلك الخدمة العامة (نفس سبب
     * تكرار `resolveUnit()`/`scopeToContext()` الموثَّق في رأس هذا الصنف).
     * سلةٌ حُلَّت قبل هذا القفل (عبر `resolveCurrent()`/`findByToken()`) قد
     * تكون طالبَتها مصادقةٌ متزامنة بين الحلّ وهذا القفل بالذات — المطالبة
     * تُعدِّل `customer_identity_id` فقط، لا `status`، فلا يكفي فحصا الحالة
     * والانتهاء وحدهما.
     */
    private function assertOwnedByCurrentBearer(CommerceCart $cart): void
    {
        $customerContext = app(CustomerContext::class);
        $ownedByOther = $cart->customer_identity_id !== null
            && (! $customerContext->isEstablished() || $customerContext->customerIdentityId() !== $cart->customer_identity_id);

        if ($ownedByOther) {
            throw new CheckoutNotFoundException('جلسة الدفع غير متاحة.');
        }
    }

    private function cartFor(CommerceCheckout $checkout): ?CommerceCart
    {
        return CommerceCart::find($checkout->cart_id);
    }

    /**
     * يقيّد استعلام Checkout أو Cart (كلاهما بنفس عمودي `sales_channel_id`/
     * `storefront_id`) إلى السياق الموثوق الحالي — نفس منطق
     * `CommerceCartService::scopeToContext()` حرفياً (مطابقة صريحة لمسار
     * الويب، `whereNull('storefront_id')` صراحةً لمسار الجوال) مكرَّرٌ هنا
     * عمداً بدل توسيع واجهة `CommerceCartService` العامة — نفس سبب تكرار
     * `resolveUnit()`/`lockActiveCart()` الموثَّق في رأس هذا الصنف: Checkout
     * لا يغيّر قواعد Cart ولا يُدخلها في التزامٍ جديد.
     *
     * @template TModel of CommerceCheckout|CommerceCart
     * @param  \Illuminate\Database\Eloquent\Builder<TModel>  $query
     * @return \Illuminate\Database\Eloquent\Builder<TModel>
     */
    private function scopeToContext($query, StorefrontContext $context)
    {
        $query->where('sales_channel_id', $context->salesChannelId());

        if ($context->hasStorefront()) {
            $query->where('storefront_id', $context->storefrontId());
        } else {
            $query->whereNull('storefront_id');
        }

        return $query;
    }

    /**
     * السياق الموثوق الحالي — يقبل شكلين حصراً، مطابقٌ حرفياً لـ
     * `CommerceCartService::context()` (راجع توثيقها الكامل):
     *  - سياق ويب: `hasStorefront() === true` (كما كان دائماً، بلا تغيير).
     *  - سياق جوّال: `hasStorefront() === false` **و** القناة المحلولة فعلياً
     *    من نوع `mobile` — تحقّقٌ إيجابي صريح، لا قبولاً ضمنياً لغياب Storefront
     *    كحالة عامة ناقصة (المسار المتوارَث `ResolveStorefrontTenant` ينتج
     *    أيضاً `hasStorefront() === false` لكن لقناة `web`).
     */
    private function context(): StorefrontContext
    {
        $context = app(StorefrontContext::class);
        if (! $context->isEstablished()
            || app(TenantContext::class)->id() !== $context->tenantId()
        ) {
            throw new RuntimeException('لا يوجد سياق متجر موثوق.');
        }

        if (! $context->hasStorefront()) {
            $channel = SalesChannel::query()->find($context->salesChannelId());
            if ($channel === null || $channel->type !== SalesChannel::TYPE_MOBILE) {
                throw new RuntimeException('لا يوجد سياق متجر موثوق.');
            }
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
