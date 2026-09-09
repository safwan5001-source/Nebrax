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
 * الطلب. هذا تكاملٌ سياقي حصراً (COM-6A) لا تفويضَ ملكية موارد كامل
 * (COM-6B لاحقاً).
 *
 * **P1 hardening — لا ثقة ضمنية بمجرد غياب السياق**: غياب `CustomerContext`
 * لا يعني «طاقم/داخلي موثوق» — فمسار ضيف/عام مستقبلي (COM-7A) لن يمرّ
 * بـ`EstablishCustomerContext` أبداً، فسيصل بلا سياق تماماً كالطاقم اليوم.
 * الثقة الآن **علامةٌ صريحة منفصلة**: `$trustedPartnerSelection = true` عبر
 * `create()`، لا اشتقاقٌ من غياب أي شيء. حين لا يوجد سياقٌ **ولا** علامة
 * ثقة صريحة (الافتراض — أي طالبٍ لم يُثبت ثقته، بما فيه ضيفٌ عامٌّ مستقبلي)
 * لا يُقرَأ `$data['partner_id']` إطلاقاً؛ `partner_id` يبقى `null` دوماً.
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
     * @param  array{sales_channel_id: string, partner_id?: ?string, number?: ?string}  $data
     * @param  array<int, array{product_id: string, quantity: int, unit_name?: ?string}>  $items
     *
     * @throws RuntimeException المستأجر/القناة/العميل/المنتج غير موجودين، أو
     *                          كمية غير موجبة، أو وحدة غير معرَّفة.
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

        $partnerId = $this->resolveOrderPartnerId($tenantId, $data, $trustedPartnerSelection);

        return DB::transaction(function () use ($salesChannelId, $partnerId, $data, $items) {
            $order = CommerceOrder::create([
                'sales_channel_id' => $salesChannelId,
                'partner_id' => $partnerId,
                'number' => $data['number'] ?? $this->nextNumber(),
            ]);

            $total = 0;
            foreach ($items as $item) {
                $total += $this->createLine($order, $salesChannelId, $partnerId, $item)->line_total;
            }

            $order->update(['total' => $total]);

            return $order->fresh('lines');
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
     * PR-COM-6A: `CustomerContext` — حين مُؤسَّساً — هو المصدر الوحيد
     * لملكية `partner_id`؛ لا قراءة لـ`$data['partner_id']` في هذه الحالة
     * إطلاقاً (لا حتى كمرشّح)، فلا يملك الطالب أي وسيلة لتجاوزه. الرابط
     * نفسه للقراءة فقط هنا — `hasPartnerLink()`/`linkedPartnerId()` يعكسان
     * تحقُّق `EstablishCustomerContext` القائم (هوية/رابط/Partner نشطون)؛
     * لا تكرار للتحقّق ولا إنشاء/تعديل رابطٍ من Commerce أبداً.
     *
     * **P1 hardening**: غياب السياق **لا** يعني ثقةً — ذاك كان الخلل. حين
     * لا يوجد سياقٌ مُؤسَّس، `$data['partner_id']` لا يُقرَأ إطلاقاً (ولا
     * يُفحَص وجوده حتى) إلا حين يحمل الطالب علامة الثقة الصريحة
     * `$trustedPartnerSelection === true` — وهي وحدها القناة المتبقية
     * لسلوك COM-5A الأصلي (تحقّق الوجود داخل المستأجر ثم الإرجاع). أي طالبٍ
     * آخر — بما فيه أيّ مسار عام/ضيف لا يمرّ بـ`EstablishCustomerContext`
     * ولا يحمل هذه العلامة — يحصل على `null` دوماً، بصرف النظر عمّا يحمله
     * `$data`.
     */
    private function resolveOrderPartnerId(string $tenantId, array $data, bool $trustedPartnerSelection): ?string
    {
        $customerContext = app(CustomerContext::class);

        if ($customerContext->isEstablished()) {
            if ($customerContext->tenantId() !== $tenantId) {
                throw new RuntimeException('سياق العميل لا يطابق المستأجر النشط.');
            }

            return $customerContext->hasPartnerLink() ? $customerContext->linkedPartnerId() : null;
        }

        if (! $trustedPartnerSelection) {
            return null;
        }

        $partnerId = $data['partner_id'] ?? null;
        if ($partnerId !== null
            && ! Partner::query()->withoutGlobalScope(BranchScope::class)->whereKey($partnerId)->exists()
        ) {
            throw new RuntimeException('العميل غير موجود.');
        }

        return $partnerId;
    }
}
