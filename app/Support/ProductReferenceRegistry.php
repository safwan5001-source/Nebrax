<?php

namespace App\Support;

use App\Models\BarcodeRegistryEntry;
use App\Models\CreditNoteLine;
use App\Models\DeliveryNoteLine;
use App\Models\FuelProduct;
use App\Models\FuelSale;
use App\Models\InventoryOpeningLine;
use App\Models\InventoryStockAlert;
use App\Models\InvoiceLine;
use App\Models\PriceListItem;
use App\Models\ProcurementLine;
use App\Models\ProductActivity;
use App\Models\ProductBarcode;
use App\Models\ProductMedia;
use App\Models\ProductWarehouseStock;
use App\Models\PurchaseLine;
use App\Models\QuoteLine;
use App\Models\RecurringInvoiceLine;
use App\Models\ReturnLine;
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
 *  **الفئات الخمس** (بنصّ العقد):
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

        // ── ٤) تجاري حيّ ───────────────────────────────────────────────
        PriceListItem::class => ['key' => 'price_list_items', 'classes' => [self::COMMERCIAL_LIVE]],

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

        // ── ٦) تدقيق ───────────────────────────────────────────────────
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
}
