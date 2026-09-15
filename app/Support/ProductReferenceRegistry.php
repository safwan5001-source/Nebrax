<?php

namespace App\Support;

use App\Models\BarcodeRegistryEntry;
use App\Models\CommerceCartItem;
use App\Models\CommerceListing;
use App\Models\CommerceOrderLine;
use App\Models\CreditNoteLine;
use App\Models\DeliveryNoteLine;
use App\Models\FuelProduct;
use App\Models\FuelSale;
use App\Models\InventoryOpeningLine;
use App\Models\InventoryReservation;
use App\Models\InventoryState;
use App\Models\InventoryStockAlert;
use App\Models\InvoiceLine;
use App\Models\PriceListItem;
use App\Models\ProcurementLine;
use App\Models\ProductActivity;
use App\Models\ProductBarcode;
use App\Models\ProductMedia;
use App\Models\ProductOption;
use App\Models\ProductUnitPrice;
use App\Models\ProductVariant;
use App\Models\ProductWarehouseStock;
use App\Models\PurchaseLine;
use App\Models\QuoteLine;
use App\Models\RecurringInvoiceLine;
use App\Models\ReturnLine;
use App\Models\SkuRegistryEntry;
use App\Models\StockMovement;
use App\Models\StockPermitLine;
use App\Models\StocktakeLine;

/**
 * ═══════════════════════════════════════════════════════════════
 *  سجلّ مراجع المنتج — مصدر الحقيقة الوحيد لتصنيف كل ما يشير إلى منتج
 * ═══════════════════════════════════════════════════════════════
 *  العلّة المؤكَّدة (عقد PR-PROD-LIFE-1): حماية دورة حياة المنتج كانت **قائمةً
 *  مُعدَّدة يدوياً** داخل `ProductLifecycleService` — فأغفلت `DeliveryNoteLine`
 *  و`InventoryOpeningLine`، وأغفل حارس هوية المخزون `InventoryOpeningLine`
 *  فصار رصيدٌ افتتاحي بحالة مسودة لا يمنع تغيير `type`/`track_inventory`.
 *  القائمة المُعدَّدة يدوياً تُغفل حتماً؛ الحلّ ليس إضافة السطرين الناقصين بل
 *  نقل التصنيف إلى مرجعٍ مركزيٍّ واحد يحرسه اختبارٌ معماري.
 *
 *  **هذا السجلّ تصنيفٌ فقط.** لا يستعلم ولا يقرّر ولا يحذف — تلك مسؤولية
 *  `ProductLifecycleService` وحدها. الفصل متعمَّد: التصنيف بيانٌ ثابتٌ يُراجَع
 *  بالعين، والتنفيذ سلوكٌ يُختبر.
 *
 *  **فئات المراجع**:
 *
 *  1. `BUSINESS_HISTORICAL` — سطر مستندٍ تجاري/تاريخي. حجّة قائمة: حذف المنتج
 *     يترك المستند يشير إلى بطاقةٍ مُحرَّرة، ويحرّر SKU/باركوداً قد يُعاد
 *     استعماله فيضلّل قارئ المستند القديم. **يمنع الحذف.**
 *  2. `INVENTORY_SEMANTIC` — أثرٌ مخزني حقيقي. **يمنع الحذف**، و**يمنع كذلك**
 *     تغيير `type`/`track_inventory` لأن ذلك يعيد تفسير كميةٍ مسجَّلة سلفاً.
 *  3. `COMMERCIAL_LIVE` — مرجع تجاري حيّ (تسعير/تهيئة). ليس تاريخاً ولا هوية
 *     مخزون، لكن حذفه صامتاً يكسر تهيئةً قائمة. **يمنع الحذف** بالسياسة الحالية.
 *  4. `OWNED_CHILD` — تابعٌ مملوك بالكامل للمنتج، بلا معنى مستقلّ عنه.
 *     **لا يمنع الحذف أبداً**، ويُنظَّف ضمن الحذف الحقيقي وحده.
 *  5. `AUDIT_HISTORY` — سجلّ تدقيق. **لا يمنع الحذف أبداً**: صفّ «أُنشئ» موجود
 *     لكل منتج بلا استثناء، فجعله مانعاً كان سيجعل كل منتج غير قابل للحذف.
 *     يُحتفظ به بعد الحذف عمداً — الحذف نفسه حدثٌ يجب أن يبقى مدوَّناً.
 *  6. `EPHEMERAL_REFERENCE` — مرجعٌ مؤقت غير تاريخي، مثل سطر سلة مجهولة.
 *     **لا يمنع الحذف أبداً**؛ يبقى الصفّ بلقطة اسمٍ آمنة بعد تصفير مرجع المنتج.
 *
 *  نموذجٌ واحد قد يحمل أكثر من فئة: `InventoryOpeningLine` تاريخيٌّ **و**
 *  مخزنيّ الدلالة معاً — وهو بالضبط ما أغفلته القائمة القديمة في الموضعين.
 *
 *  @see docs/plans/products-inventory/phase-1-hardening/PR-PROD-LIFE-1.md
 *  المستهلك الوحيد لهذا القرار هو `App\Services\ProductLifecycleService`.
 */
final class ProductReferenceRegistry
{
    public const BUSINESS_HISTORICAL = 'business_historical';

    public const INVENTORY_SEMANTIC = 'inventory_semantic';

    public const COMMERCIAL_LIVE = 'commercial_live';

    public const OWNED_CHILD = 'owned_child';

    public const AUDIT_HISTORY = 'audit_history';

    public const EPHEMERAL_REFERENCE = 'ephemeral_reference';

    /**
     * التصنيف الكامل: صنف النموذج ⇐ [مفتاح التقرير، الفئات].
     *
     * مفتاح التقرير هو المفتاح الظاهر في `referenceCounts()` — أُبقيت مفاتيح
     * النماذج القائمة على صيغتها السابقة حرفياً حفاظاً على التوافق الرجعي لأي
     * مستهلك قائم لتلك المصفوفة.
     *
     * @var array<class-string, array{key: string, classes: list<string>}>
     */
    private const CLASSIFICATION = [
        // ── ١) تجاري/تاريخي ────────────────────────────────────────────
        InvoiceLine::class => ['key' => 'invoice_lines', 'classes' => [self::BUSINESS_HISTORICAL]],
        PurchaseLine::class => ['key' => 'purchase_lines', 'classes' => [self::BUSINESS_HISTORICAL]],
        ReturnLine::class => ['key' => 'return_lines', 'classes' => [self::BUSINESS_HISTORICAL]],
        CreditNoteLine::class => ['key' => 'credit_note_lines', 'classes' => [self::BUSINESS_HISTORICAL]],
        QuoteLine::class => ['key' => 'quote_lines', 'classes' => [self::BUSINESS_HISTORICAL]],
        RecurringInvoiceLine::class => ['key' => 'recurring_invoice_lines', 'classes' => [self::BUSINESS_HISTORICAL]],
        ProcurementLine::class => ['key' => 'procurement_lines', 'classes' => [self::BUSINESS_HISTORICAL]],
        // الفجوة الأولى المعروفة في العقد — سند تسليم مؤكَّد حجّة تسليمٍ قائمة.
        DeliveryNoteLine::class => ['key' => 'delivery_note_lines', 'classes' => [self::BUSINESS_HISTORICAL]],
        // PR-COM-5A: سطر التزامٍ تجاري — بنفس منطق QuoteLine حرفياً (حجّة
        // قائمة غير محاسبية، لا أثر مخزني). CommerceOrder != Invoice
        // (ADR-01 §2)، لكنه يبقى مستنداً تاريخياً يجب ألّا يُمحى مرجعه صامتاً.
        CommerceOrderLine::class => ['key' => 'commerce_order_lines', 'classes' => [self::BUSINESS_HISTORICAL]],

        // ── ٢) تاريخي **و** مخزنيّ الدلالة معاً ────────────────────────
        // الفجوة الثانية المعروفة في العقد، وكانت مزدوجة: غائبة عن منع الحذف
        // **وعن** حارس هوية المخزون. مستند رصيدٍ افتتاحي بحالة مسودة يعلن
        // كميةً وتكلفةً لهذا المنتج بعينه؛ تغيير `type`/`track_inventory`
        // بعده يعيد تفسير ما سيُرحَّل، لا ما رُحِّل فقط.
        InventoryOpeningLine::class => [
            'key' => 'inventory_opening_lines',
            'classes' => [self::BUSINESS_HISTORICAL, self::INVENTORY_SEMANTIC],
        ],

        // ── ٣) مخزنيّ الدلالة ──────────────────────────────────────────
        StockMovement::class => ['key' => 'stock_movements', 'classes' => [self::INVENTORY_SEMANTIC]],
        StockPermitLine::class => ['key' => 'stock_permit_lines', 'classes' => [self::INVENTORY_SEMANTIC]],
        StocktakeLine::class => ['key' => 'stocktake_lines', 'classes' => [self::INVENTORY_SEMANTIC]],
        ProductWarehouseStock::class => ['key' => 'warehouse_stocks', 'classes' => [self::INVENTORY_SEMANTIC]],
        // PR-COM-1B: حجزٌ تشغيلي لا حركة مخزون، لكنه أثرٌ مخزنيّ الدلالة تماماً
        // مثل `StockMovement`: منتجٌ له حجزٌ (أي حالة — نشط أو منتهٍ) لا يجوز
        // حذفه، ولا تغيير `type`/`track_inventory` عليه، لأن ذلك يعيد تفسير
        // كميةٍ محجوزة سلفاً (ADR-02 §9: غير المتتبَّع لا يُحجز أصلاً).
        InventoryReservation::class => ['key' => 'inventory_reservations', 'classes' => [self::INVENTORY_SEMANTIC]],
        // VAR-INV-1: هويّة المخزون والتقييم الموحّدة. إنشاؤها **كسول** (أول
        // عملية تمسّ الهويّة فعلاً — @see App\Models\InventoryState)، فوجود
        // الصفّ نفسه دليل أثرٍ حقيقي بالضبط مثل StockMovement/ProductWarehouseStock
        // أعلاه، لا صفّاً فارغاً يُنشأ تلقائياً لكل منتج فيُسقط هذا الحارس دائماً.
        InventoryState::class => ['key' => 'inventory_states', 'classes' => [self::INVENTORY_SEMANTIC]],

        // ── ٤) تجاري حيّ ───────────────────────────────────────────────
        PriceListItem::class => ['key' => 'price_list_items', 'classes' => [self::COMMERCIAL_LIVE]],
        // VAR-CORE-1: متغيّرٌ فعلي هويةٌ قابلة للبيع حيّة — ليس تاريخاً بعدُ
        // (لا مستند/حركة تشير إليه اليوم، ذلك VAR-DOC-1/VAR-INV-1)، لكن حذف
        // المنتج صامتاً بينما له متغيّرات يفقد تركيبات/SKU حيّة بلا تراجع.
        // يمنع الحذف حتى يُزال كل متغيّر صراحةً أولاً (تحويلٌ صريح إلى بسيط).
        ProductVariant::class => ['key' => 'product_variants', 'classes' => [self::COMMERCIAL_LIVE]],
        // PR-COM-3: عرضٌ تجاري حيّ لمنتج على قناة — بنفس منطق PriceListItem
        // حرفياً: ليس تاريخاً ولا هوية مخزون، لكن حذف المنتج صامتاً بينما هو
        // معروضٌ فعلياً على قناة يكسر تهيئة نشر حيّة (restrictOnDelete في
        // الترحيل نفسه يعكس هذا القرار على مستوى القاعدة أيضاً).
        CommerceListing::class => ['key' => 'commerce_listings', 'classes' => [self::COMMERCIAL_LIVE]],

        // ── ٥) توابع مملوكة ────────────────────────────────────────────
        ProductBarcode::class => ['key' => 'alternate_barcodes', 'classes' => [self::OWNED_CHILD]],
        ProductMedia::class => ['key' => 'media', 'classes' => [self::OWNED_CHILD]],
        // PR-UOM-1: فضاء الباركود الموحّد. تابعٌ مملوك لا مانع — وجود سجلٍّ
        // لباركود المنتج حالةٌ طبيعية لكل منتجٍ له باركود، لا مرجعٌ تاريخي.
        // تحريره يقع داخل الحذف الحقيقي وحده، وهو مسارٌ لا يكتمل إلا بلا
        // مراجع تاريخية — فلا تُعاد هوية باركودٍ ما زال لها تاريخ.
        BarcodeRegistryEntry::class => ['key' => 'barcode_registry_entries', 'classes' => [self::OWNED_CHILD]],
        // حالة تنبيهٍ مشتقّة من الكمية لحظةَ رصدها، لا حدث ولا مستند. جعلها
        // مانعاً كان سيجعل منتجاً «منخفض المخزون» غير قابلٍ للحذف أبداً بسبب
        // حالةٍ مشتقّة يعيد النظام حسابها بنفسه.
        InventoryStockAlert::class => ['key' => 'stock_alerts', 'classes' => [self::OWNED_CHILD]],
        // VAR-CORE-1: خيارات المتغيّرات (اللون/المقاس) تابعةٌ بالكامل للمنتج —
        // بلا معنى مستقلّ، وتُنظَّف مع الحذف الحقيقي وحده. حماية قيمها من
        // الحذف وهي مستعملة في متغيّرٍ قائم مسؤولية الخدمة، لا هذا التصنيف.
        ProductOption::class => ['key' => 'product_options', 'classes' => [self::OWNED_CHILD]],
        // فضاء SKU الموحّد (VAR-CORE-1) — تابعٌ مملوكٌ تماماً كـ
        // `BarcodeRegistryEntry` حرفياً، ولنفس السبب: وجود سجلٍّ لرمز المنتج
        // حالةٌ طبيعية لا مرجعٌ تاريخي، ويُحرَّر ضمن الحذف الحقيقي وحده.
        SkuRegistryEntry::class => ['key' => 'sku_registry_entries', 'classes' => [self::OWNED_CHILD]],
        // VAR-PRICE-1: السعر الأساسي الصريح (منتج/أب أو متغيّر × وحدة). صفّ
        // المنتج ذاته ليس مرجعاً مستقلاً بل جزءٌ من بطاقته (يُنشأ إلزامياً مع
        // كل منتج لأن `sale_price` إلزاميٌّ عند الإنشاء) — تصنيفه `COMMERCIAL_LIVE`
        // كان سيمنع حذف **كل** منتجٍ للأبد. حماية سعر متغيّرٍ قائمٍ فعلياً
        // مسؤولية `ProductVariantService::deleteVariant()` الصريحة (تحقّقٌ
        // مباشر لا هذا التصنيف)، لا هذا السجلّ — الموازي هنا تماماً حالة
        // `ProductOption` نفسها أعلاه.
        ProductUnitPrice::class => ['key' => 'product_unit_prices', 'classes' => [self::OWNED_CHILD]],

        // COM-CART-2: السلة المجهولة حالة مؤقتة وليست دليلاً تاريخياً ولا
        // تهيئةً تجارية حية. حذف المنتج لا تمنعه سلة مهجورة؛ يبقى السطر
        // بلقطة الاسم ويصبح غير متاح وفق عقد Cart V1.
        CommerceCartItem::class => ['key' => 'commerce_cart_items', 'classes' => [self::EPHEMERAL_REFERENCE]],

        // ── ٧) تدقيق ───────────────────────────────────────────────────
        ProductActivity::class => ['key' => 'activity', 'classes' => [self::AUDIT_HISTORY]],

        // ── مراجع نطاق الوقود ──────────────────────────────────────────
        // مكتشفة أثناء التنفيذ، ليست في تعداد العقد. تصنيفها هنا **لازم**
        // لأن الحارس المعماري يرفض أي نموذج `product_id` بلا تصنيف؛ وقد صُنِّفت
        // بتطبيق قواعد العقد نفسها لا بسياسة جديدة: بيع وقودٍ مسجَّل مستندٌ
        // تجاري قائم كسطر الفاتورة، وربط منتج الوقود تهيئةٌ حيّة كبند قائمة
        // الأسعار. لا يندمج السجلّان (خارج النطاق صراحةً) — يُصنَّف المرجع فقط.
        FuelSale::class => ['key' => 'fuel_sales', 'classes' => [self::BUSINESS_HISTORICAL]],
        FuelProduct::class => ['key' => 'fuel_products', 'classes' => [self::COMMERCIAL_LIVE]],
    ];

    /** @return array<class-string, array{key: string, classes: list<string>}> */
    public static function all(): array
    {
        return self::CLASSIFICATION;
    }

    /**
     * النماذج التي تحمل فئةً بعينها.
     *
     * @return array<class-string, string> صنف النموذج ⇐ مفتاح التقرير
     */
    public static function inClass(string $class): array
    {
        $models = [];
        foreach (self::CLASSIFICATION as $model => $entry) {
            if (in_array($class, $entry['classes'], true)) {
                $models[$model] = $entry['key'];
            }
        }

        return $models;
    }

    /**
     * كل ما يمنع الحذف المدمِّر: التجاري/التاريخي والمخزنيّ والتجاري الحيّ معاً.
     *
     * @return array<class-string, string> صنف النموذج ⇐ مفتاح التقرير
     */
    public static function deletionBlockers(): array
    {
        return self::inClass(self::BUSINESS_HISTORICAL)
            + self::inClass(self::INVENTORY_SEMANTIC)
            + self::inClass(self::COMMERCIAL_LIVE);
    }

    /**
     * ما يمنع تغيير هوية المخزون (`type` / `track_inventory`) — المخزنيّ وحده.
     * التجاري الحيّ ليس هويةَ مخزون بنصّ العقد، فبند تسعيرٍ لا يجمّد التصنيف.
     *
     * @return array<class-string, string>
     */
    public static function inventorySemantic(): array
    {
        return self::inClass(self::INVENTORY_SEMANTIC);
    }

    /** @return array<class-string, string> */
    public static function ownedChildren(): array
    {
        return self::inClass(self::OWNED_CHILD);
    }

    /** @return array<class-string, string> */
    public static function auditHistory(): array
    {
        return self::inClass(self::AUDIT_HISTORY);
    }

    public static function isClassified(string $model): bool
    {
        return array_key_exists($model, self::CLASSIFICATION);
    }

    /**
     * سطور المستندات التجارية التي تحمل `product_variant_id` فعلياً (VAR-DOC-1)
     * — مجموعةٌ فرعية **صريحة** من `BUSINESS_HISTORICAL`، لا كل أعضائه: بعضها
     * (`CommerceOrderLine` خارج النطاق صراحةً/VAR-COM-1، `FuelSale`،
     * `InventoryOpeningLine`) لا يحمل هذا العمود إطلاقاً، فتصفيةٌ عامة عبر
     * `inClass()` كانت ستكسر استعلاماً على عمودٍ غير موجود. يستهلكه
     * `ProductVariantService::deleteVariant()` وحده اليوم — حارس حذفٍ حقيقي
     * fail-closed لأي متغيّرٍ يحمل مرجعاً في أيٍّ من هذه الجداول.
     *
     * @return list<class-string>
     */
    public static function variantScopedBusinessDocumentLines(): array
    {
        return [
            InvoiceLine::class,
            PurchaseLine::class,
            ReturnLine::class,
            CreditNoteLine::class,
            QuoteLine::class,
            RecurringInvoiceLine::class,
            ProcurementLine::class,
            DeliveryNoteLine::class,
        ];
    }
}
