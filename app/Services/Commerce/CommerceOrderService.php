<?php

namespace App\Services\Commerce;

use App\Models\CommerceOrder;
use App\Models\CommerceOrderLine;
use App\Models\Partner;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Services\Accounting\UnitConversion;
use App\Tenancy\BranchScope;
use App\Tenancy\CustomerContext;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  CommerceOrderService — سجلّ التزام تجاري مستقل، لا محاسبي (PR-COM-5A)
 * ═══════════════════════════════════════════════════════════════
 *
 * **الحدّ المطلق (ADR-01 §2/§6 + `CommerceBoundary`)**: `create()`/`confirm()`
 * لا يستدعيان `InvoiceService`/`LedgerService`/`InventoryReservationService`/
 * `PaymentService`/`ZatcaService` إطلاقاً. التأكيد التزامٌ تجاريٌّ فقط —
 * حجز المخزون مسؤولية PR-COM-5B اللاحقة حصراً.
 *
 * **التسعير**: كل سطر يُسعَّر عبر `CommercePriceResolver` (COM-4A) حصراً —
 * لا قراءة مباشرة لـ`PriceList` ولا نسخ لمنطق أسبقية العميل/الوحدة. سعرٌ
 * غير محسوم (`resolved === false`) يرفض إنشاء السطر بالكامل؛ **لا يُفترَض
 * له صفر أبداً** — صفرٌ حقيقي (`amount === 0`) حالةٌ مختلفة تماماً ومقبولة.
 *
 * **الوحدة**: `UnitConversion::resolve()` تُستدعى مباشرةً هنا (لا عبر
 * `CommercePriceResolver`) للحصول على معامل التحويل اللازم للقطة السطر؛
 * نفس السلطة الوحيدة، ونفس المدخلات، فلا افتراقٌ ممكنٌ بين الاسم المحسوم
 * هنا والمحسوم داخل حلّ السعر.
 *
 * **بلا ضريبة/خصم/شحن**: `CommercePriceResolver` نفسه لا يحسم ضريبة، ولا
 * يوجد محرّك خصم (COM-4B لم يُبنَ) ولا شحن (Phase 9B). `line_total` =
 * `quantity × unit_price` فقط — لا حقل آخر يُشتقّ أو يُخترَع.
 *
 * **بلا idempotency هنا**: لا سطح استدعاء خارجي قابل لإعادة المحاولة بعد
 * (لا API/Checkout بعد — Master Plan §25 يخصّص ذلك لـ PR-COM-7A صراحةً).
 *
 * **PR-COM-6A — سياق العميل المشترك**: حين يتأسّس `CustomerContext` (طلبٌ من
 * هوية عميل موثَّقة) يصبح **المصدر الوحيد**: `partner_id` من `$data` يُتجاهل
 * كلياً ولا يُقرَأ حتى كمرشّح — لا يجوز أن يُغيّر مُدخَلٌ من الطالب ملكية
 * الطلب.
 *
 * **P1 hardening — لا ثقة ضمنية بمجرد غياب السياق**: غياب `CustomerContext`
 * لا يعني «طاقم/داخلي موثوق» — فمسار ضيف/عام مستقبلي (COM-7A) لن يمرّ
 * بـ`EstablishCustomerContext` أبداً، فسيصل بلا سياق تماماً كالطاقم اليوم.
 * الثقة الآن **علامةٌ صريحة منفصلة**: `$trustedPartnerSelection = true` عبر
 * `create()`، لا اشتقاقٌ من غياب أي شيء. حين لا يوجد سياقٌ **ولا** علامة
 * ثقة صريحة (الافتراض — أي طالبٍ لم يُثبت ثقته، بما فيه ضيفٌ عامٌّ مستقبلي)
 * لا يُقرَأ `$data['partner_id']` إطلاقاً؛ `partner_id` يبقى `null` دوماً.
 * `$trustedPartnerSelection` **علامةٌ داخليةٌ خادميّة بحتة** — لا يجوز
 * اشتقاقها أو تمريرها من أي مُدخَل HTTP (نص طلب/معامل استعلام/رأس/كوكي)
 * إطلاقاً؛ راجع
 * `docs/plans/store/COMMERCE_TRUSTED_PARTNER_SELECTION_SECURITY_NOTE.md`.
 *
 * **PR-COM-6B — ملكية العميل الرقمية والتفويض**: `customer_identity_id`
 * (عمود إضافي على `commerce_orders`) مصدره الوحيد `CustomerContext::
 * customerIdentityId()` حين مُؤسَّساً، و`null` دوماً للضيف/الطاقم — لا علاقة
 * له بـ`trustedPartnerSelection` ولا بـ`$data` إطلاقاً؛ لا مسار طاقمٍ
 * «موثوق» يمكنه تعيين ملكية طلبٍ لهوية عميل بديلة (خلافاً لـ`partner_id`
 * الذي يبقى قابلاً للتحديد اليدوي عبر المسار الموثوق فقط). `ownedOrders()`/
 * `findOwnedOrder()` أدناه هما الحد التفويضي القابل لإعادة الاستخدام لأي
 * مسار Commerce عميلٍ مستقبلي (سلة/دفع/سجل طلبات) — مطابقان لنمط
 * `NotificationController::ownNotifications()` القائم: الاستعلام نفسه
 * مُصفّى بالمالك المُستمَدّ خادمياً، لا تحميل عامّ ثم تفويضٌ بمعرّفٍ من الطالب.
 * `Partner` يبقى علاقةً تجاريةً وصفية فقط — لا يمنح وصولاً لموردٍ بذاته.
 *
 * **PR-COM-6C — لقطة العميل/الاتصال/الشحن/الفوترة**: `$data['customer_snapshot']`/
 * `shipping_snapshot`/`billing_snapshot` (كلها اختيارية) بيانات وصفية بحتة —
 * لا سلطة تفويض إطلاقاً، ولا علاقة لها بـ`resolveOwnership()`/
 * `trustedPartnerSelection` أعلاه (تُقرأ بمعزل تامٍ عن حسم الملكية). القيم
 * تُنسخ حرفياً كما مرَّرها الطالب — لا قراءة حيّة من `Partner`/`CustomerIdentity`
 * هنا؛ COM-7 لاحقاً قرارٌ منفصل تماماً بشأن ما إذا كان يملأ هذه الحقول من
 * عنوان Partner الحالي أم من إدخال العميل المباشر. الجمود: مسودة قابلة
 * للتعديل عبر `updateSnapshot()`، ومؤكَّدة مجمَّدة تماماً — يرفضها كلٌّ من
 * هذه الطبقة و`CommerceOrderSnapshot::booted()` مركزياً.
 */
class CommerceOrderService
{
    public function __construct(
        private readonly CommercePriceResolver $prices,
        private readonly UnitConversion $units,
    ) {}

    /**
     * إنشاء طلب Commerce بحالة `draft` مع سطوره ذرّياً — فشل أي سطر يُسقط
     * الطلب كاملاً (لا مسودة جزئية تنجو من معاملة فاشلة).
     *
     * `$trustedPartnerSelection`: علامة ثقة **صريحة** يضبطها الطالب فقط —
     * لا تُشتقّ من غياب `CustomerContext`. مُخصّصةٌ حصراً لمسارٍ طاقمٍ/داخليٍّ
     * صريح خارج Commerce نفسها (مثال: متحكّم طاقمٍ محروسٌ بصلاحية RBAC —
     * لا يوجد اليوم؛ اختبارات COM-5A التي تمرّر `partner_id` تُمثّل هذا
     * المسار حتى يوجد). أي طالبٍ لا يُثبتها (الافتراض `false` — يشمل أي
     * مسار عام/ضيف مستقبلي) لا يملك أي وسيلة لجعل `partner_id` سلطةً على
     * الطلب، مهما كانت قيمته في `$data`.
     *
     * @param  array{sales_channel_id: string, partner_id?: ?string, number?: ?string, customer_snapshot?: array<string, mixed>, shipping_snapshot?: array<string, mixed>, billing_snapshot?: array<string, mixed>}  $data
     * @param  array<int, array{product_id: string, quantity: int, unit_name?: ?string}>  $items
     *
     * @throws RuntimeException المستأجر/القناة/العميل/المنتج غير موجودين، أو
     *                          كمية غير موجبة، أو وحدة غير معرَّفة، أو حمولة
     *                          لقطة غير صالحة بنيوياً.
     * @throws CommerceOrderPriceUnresolvedException سطرٌ بلا سعر قابل للحسم.
     */
    public function create(array $data, array $items, bool $trustedPartnerSelection = false): CommerceOrder
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا سياق مستأجر نشط.');
        }

        if (empty($items)) {
            throw new RuntimeException('طلب Commerce يجب أن يحتوي على سطر واحد على الأقل.');
        }

        $salesChannelId = $data['sales_channel_id'] ?? null;
        if (! is_string($salesChannelId) || ! SalesChannel::query()->whereKey($salesChannelId)->exists()) {
            throw new RuntimeException('قناة البيع غير موجودة.');
        }

        [$customerIdentityId, $partnerId] = $this->resolveOwnership($tenantId, $data, $trustedPartnerSelection);

        // يُبنى/يُتحقَّق قبل فتح المعاملة — بنفس منطق فحوصات القناة/الملكية
        // أعلاه: حمولة لقطة غير صالحة بنيوياً يجب أن تُسقط الطلب كاملاً قبل
        // أي كتابة، لا أن تُترك لتفشل منتصف المعاملة.
        $snapshot = $this->normalizeSnapshotInput($data, customerNameRequired: true);

        return DB::transaction(function () use ($salesChannelId, $customerIdentityId, $partnerId, $data, $items, $snapshot) {
            $order = CommerceOrder::create([
                'sales_channel_id' => $salesChannelId,
                'customer_identity_id' => $customerIdentityId,
                'partner_id' => $partnerId,
                'number' => $data['number'] ?? $this->nextNumber(),
            ]);

            $total = 0;
            foreach ($items as $item) {
                $total += $this->createLine($order, $salesChannelId, $partnerId, $item)->line_total;
            }

            $order->update(['total' => $total]);

            if ($snapshot !== null) {
                $order->snapshot()->create($snapshot);
            }

            return $order->fresh(['lines', 'snapshot']);
        });
    }

    /**
     * تحديث/إنشاء لقطة طلبٍ قائم — القناة الوحيدة لتعديل لقطةٍ بعد الإنشاء
     * (مثلاً: عميلٌ يبدّل عنوان الشحن أثناء مراجعة السلة قبل COM-7). مسودة
     * فقط: طلبٌ مؤكَّد يُرفض مركزياً هنا **وكذلك** في
     * `CommerceOrderSnapshot::booted()` — طبقتا حراسة مستقلتان، لا انضباط
     * واجهة وحده. تحديثٌ جزئي: أجزاءٌ غير مُرسَلة من `$data` تبقى كما هي في
     * سطرٍ قائم؛ سطرٌ جديدٌ كليّاً ما زال يتطلّب `customer_snapshot.
     * customer_name` (نفس قيد قاعدة البيانات `NOT NULL`).
     *
     * @param  array{customer_snapshot?: array<string, mixed>, shipping_snapshot?: array<string, mixed>, billing_snapshot?: array<string, mixed>}  $data
     *
     * @throws RuntimeException الطلب ليس مسودة، أو حمولة لقطة غير صالحة بنيوياً.
     */
    public function updateSnapshot(CommerceOrder $order, array $data): CommerceOrder
    {
        return DB::transaction(function () use ($order, $data) {
            $order = CommerceOrder::query()->lockForUpdate()->findOrFail($order->id);

            if (! $order->isDraft()) {
                throw new RuntimeException('لا يمكن تعديل لقطة طلبٍ ليس بحالة مسودة — اللقطة تجمَّدت نهائياً عند التأكيد.');
            }

            $existing = $order->snapshot()->first();
            $attributes = $this->normalizeSnapshotInput($data, customerNameRequired: $existing === null);

            if ($attributes === null) {
                return $order->fresh(['lines', 'snapshot']);
            }

            if ($existing === null) {
                $order->snapshot()->create($attributes);
            } else {
                $existing->update($attributes);
            }

            return $order->fresh(['lines', 'snapshot']);
        });
    }

    /**
     * تأكيد طلب مسودة — التزامٌ تجاريٌّ فقط (§16). لا حجز، لا دفعة، لا فاتورة،
     * لا قيد. اللقطات المخزَّنة على السطور تبقى كما أُنشئت؛ لا إعادة حسم سعرٍ هنا.
     */
    public function confirm(CommerceOrder $order): CommerceOrder
    {
        return DB::transaction(function () use ($order) {
            $order = CommerceOrder::query()->lockForUpdate()->findOrFail($order->id);

            if (! $order->isDraft()) {
                throw new RuntimeException('لا يمكن تأكيد طلبٍ ليس بحالة مسودة.');
            }

            $order->update([
                'status' => CommerceOrder::STATUS_CONFIRMED,
                'confirmed_at' => now(),
            ]);

            return $order->fresh('lines');
        });
    }

    private function createLine(CommerceOrder $order, string $salesChannelId, ?string $partnerId, array $item): CommerceOrderLine
    {
        $productId = $item['product_id'] ?? null;
        if (! is_string($productId)) {
            throw new RuntimeException('كل سطر يجب أن يشير إلى منتج.');
        }

        $product = Product::query()->withoutGlobalScope(BranchScope::class)->whereKey($productId)->first();
        if ($product === null) {
            throw new RuntimeException('المنتج غير موجود.');
        }

        $quantity = (int) ($item['quantity'] ?? 0);
        if ($quantity <= 0) {
            throw new RuntimeException('الكمية يجب أن تكون أكبر من صفر.');
        }

        $unitName = $item['unit_name'] ?? null;

        // نفس السلطة الوحيدة (UnitConversion) بنفس المدخلات التي يستقبلها
        // CommercePriceResolver أدناه — لا افتراق ممكن بين الاسم المحسوم هنا
        // والمحسوم داخل حلّ السعر.
        [$resolvedUnitName, $unitFactor] = $this->units->resolve($product, $unitName);

        $resolved = $this->prices->resolve($productId, $salesChannelId, $partnerId, $unitName);
        if (! $resolved->resolved) {
            throw new CommerceOrderPriceUnresolvedException(
                "لا سعر قابل للحسم للمنتج «{$product->name}» بالوحدة المطلوبة."
            );
        }

        $lineTotal = $quantity * $resolved->amount;

        return $order->lines()->create([
            'product_id' => $product->id,
            'product_name_snapshot' => $product->name,
            'quantity' => $quantity,
            'unit_name' => $resolvedUnitName,
            'unit_factor' => $unitFactor,
            'unit_price' => $resolved->amount,
            'line_total' => $lineTotal,
        ]);
    }

    private function nextNumber(): string
    {
        return CommerceOrder::nextDocumentNumber('CORD', now()->toDateString());
    }

    /**
     * PR-COM-6C — يبني سمات `CommerceOrderSnapshot` من مُدخَل الطالب، أو
     * `null` إن لم يُطلَب أي جزءٍ من اللقطة إطلاقاً (لا سطر يُنشأ حينها —
     * التوافق الرجعي الافتراضي لكل طلبٍ لا يمرّر أي مفتاح لقطة).
     *
     * تحقّقٌ بنيويٌّ بحت هنا — لا تطبيع هوية (لا `CustomerIdentity::
     * normalizeEmail`): القيم حجّةٌ تاريخية معروضة، لا معرّف دخول، فتُحفَظ
     * كما أدخلها الطالب بعد `trim()` فقط (§ Validation — لا إفراط في التطبيع).
     *
     * @param  array<string, mixed>  $data
     *
     * @throws RuntimeException بنية غير صالحة (ليست مصفوفة، قيمة غير قابلة
     *                          للتحويل نصياً)، أو غياب اسم العميل حين يكون
     *                          إلزامياً.
     */
    private function normalizeSnapshotInput(array $data, bool $customerNameRequired): ?array
    {
        $hasCustomer = array_key_exists('customer_snapshot', $data);
        $hasShipping = array_key_exists('shipping_snapshot', $data);
        $hasBilling = array_key_exists('billing_snapshot', $data);

        if (! $hasCustomer && ! $hasShipping && ! $hasBilling) {
            return null;
        }

        $attributes = [];

        $customer = $this->snapshotBlock($data['customer_snapshot'] ?? [], 'لقطة العميل');
        $customerName = $this->snapshotField($customer['customer_name'] ?? null, 'اسم العميل');
        if ($customerNameRequired && ($customerName === null)) {
            throw new RuntimeException('لقطة العميل تتطلب اسم العميل.');
        }
        if ($customerName !== null) {
            $attributes['customer_name'] = $customerName;
        }
        foreach (['contact_name', 'company_name', 'email', 'phone', 'vat_number', 'cr_number'] as $field) {
            if (array_key_exists($field, $customer)) {
                $attributes[$field] = $this->snapshotField($customer[$field], $field);
            }
        }

        foreach (['shipping' => 'shipping_snapshot', 'billing' => 'billing_snapshot'] as $prefix => $key) {
            if (! array_key_exists($key, $data)) {
                continue;
            }

            $block = $this->snapshotBlock($data[$key], $key);
            $fields = ['recipient_name', 'phone', 'country', 'city', 'district', 'street', 'building_no', 'postal_code'];
            if ($prefix === 'shipping') {
                $fields[] = 'notes';
            }

            foreach ($fields as $field) {
                if (array_key_exists($field, $block)) {
                    $attributes["{$prefix}_{$field}"] = $this->snapshotField($block[$field], "{$prefix}_{$field}");
                }
            }
        }

        return $attributes;
    }

    private function snapshotBlock(mixed $block, string $label): array
    {
        if (! is_array($block)) {
            throw new RuntimeException("«{$label}» يجب أن تكون كائناً منظَّماً.");
        }

        return $block;
    }

    private function snapshotField(mixed $value, string $label): ?string
    {
        if ($value === null) {
            return null;
        }
        if (! is_string($value) && ! is_numeric($value)) {
            throw new RuntimeException("قيمة «{$label}» في لقطة الطلب غير صالحة.");
        }

        $value = trim((string) $value);

        return $value === '' ? null : $value;
    }

    /**
     * PR-COM-6A/6B: `CustomerContext` — حين مُؤسَّساً — هو المصدر الوحيد
     * لكل من هوية العميل المالكة والرابط التجاري؛ لا قراءة لـ`$data` في هذه
     * الحالة إطلاقاً (لا حتى كمرشّح)، فلا يملك الطالب أي وسيلة لتجاوزها.
     * الرابط نفسه للقراءة فقط هنا — `hasPartnerLink()`/`linkedPartnerId()`
     * يعكسان تحقُّق `EstablishCustomerContext` القائم (هوية/رابط/Partner
     * نشطون)؛ لا تكرار للتحقّق ولا إنشاء/تعديل رابطٍ من Commerce أبداً.
     *
     * **P1 hardening (COM-6A) — لا ثقة ضمنية بمجرد غياب السياق**: غياب
     * السياق **لا** يعني ثقةً. حين لا يوجد سياقٌ مُؤسَّس، `$data['partner_id']`
     * لا يُقرَأ إطلاقاً (ولا يُفحَص وجوده حتى) إلا حين يحمل الطالب علامة
     * الثقة الصريحة `$trustedPartnerSelection === true` — وهي وحدها القناة
     * المتبقية لسلوك COM-5A الأصلي (تحقّق الوجود داخل المستأجر ثم الإرجاع).
     *
     * **COM-6B — لا مسار موثوق لملكية الهوية**: بخلاف `partner_id`،
     * `customer_identity_id` ليس له أي قناة `trustedPartnerSelection` مطلقاً
     * — مصدره الوحيد الدائم `CustomerContext`، فيبقى `null` لكل غياب سياق
     * بصرف النظر عن العلامة. لا مسار طاقمٍ يمكنه «تعيين» عميلٍ مالكاً لطلبٍ
     * بديلاً عن مصادقته الفعلية — ذلك سيكسر ركيزة الملكية نفسها.
     *
     * @return array{0: ?string, 1: ?string} [customerIdentityId, partnerId]
     */
    private function resolveOwnership(string $tenantId, array $data, bool $trustedPartnerSelection): array
    {
        $customerContext = app(CustomerContext::class);

        if ($customerContext->isEstablished()) {
            if ($customerContext->tenantId() !== $tenantId) {
                throw new RuntimeException('سياق العميل لا يطابق المستأجر النشط.');
            }

            return [
                $customerContext->customerIdentityId(),
                $customerContext->hasPartnerLink() ? $customerContext->linkedPartnerId() : null,
            ];
        }

        if (! $trustedPartnerSelection) {
            return [null, null];
        }

        $partnerId = $data['partner_id'] ?? null;
        if ($partnerId !== null
            && ! Partner::query()->withoutGlobalScope(BranchScope::class)->whereKey($partnerId)->exists()
        ) {
            throw new RuntimeException('العميل غير موجود.');
        }

        return [null, $partnerId];
    }

    /**
     * PR-COM-6B — حدّ الملكية القابل لإعادة الاستخدام: استعلامٌ **مُصفّى
     * بالمالك المُستمَدّ خادمياً من `CustomerContext`** منذ سطره الأول، لا
     * تحميلٌ عامٌّ للطلب يُتبَع بتفويضٍ بمعرّفٍ من الطالب — نفس نمط
     * `NotificationController::ownNotifications()` القائم. `TenantScope`
     * (عبر `BaseModel`) يبقى دفاعاً في العمق، ليس السلطة الوحيدة: التصفية
     * الحقيقية بـ`customer_identity_id` صراحةً، فطلب ضيفٍ (`null`) لا يُطابق
     * أي هوية مهما كانت، ولا يُعاد أبداً.
     *
     * فاشلٌ مغلقاً (`RuntimeException`) بلا سياقٍ مُؤسَّس أو بتعارض المستأجر
     * — لا استعلام غير مُصفّى يُشغَّل مطلقاً تحت أي ظرف.
     */
    public function ownedOrders(): Builder
    {
        $customerContext = app(CustomerContext::class);
        if (! $customerContext->isEstablished()) {
            throw new RuntimeException('لا سياق عميل موثَّق نشط.');
        }

        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null || $customerContext->tenantId() !== $tenantId) {
            throw new RuntimeException('سياق العميل لا يطابق المستأجر النشط.');
        }

        return CommerceOrder::query()->where('customer_identity_id', $customerContext->customerIdentityId());
    }

    /**
     * طلبٌ واحدٌ ضمن حدّ `ownedOrders()` — `null` لغير المملوك أو غير
     * الموجود بلا تمييز بينهما، مطابقةً للاتفاقية غير المُعرِّفة للوجود
     * (non-enumerating) في منصة العميل (`CUS-ARCH-0` §10.2): معرّفٌ غير
     * مملوكٍ للطالب يُعامَل تماماً كمعرّفٍ غير موجود.
     */
    public function findOwnedOrder(string $orderId): ?CommerceOrder
    {
        return $this->ownedOrders()->find($orderId);
    }
}
