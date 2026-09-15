<?php

namespace App\Services;

use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\ProductWarehouseStock;
use App\Support\DocumentLineVariantResolver;
use App\Support\Money;
use App\Support\SpreadsheetWriter;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Response;
use Illuminate\Support\Collection;
use RuntimeException;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * ═══════════════════════════════════════════════════════════════
 *  تصدير أرصدة المخزون — من الخادم لا من صفوف الجدول المحمَّلة
 * ═══════════════════════════════════════════════════════════════
 *  **قراءةٌ محضة.** لا كتابة في `products` ولا في `product_warehouse_stock`
 *  ولا `stock_movements`، ولا قيد محاسبي. يبني الاستعلام نفسه الذي تبنيه
 *  الشاشة (`InventoryBalanceFilters`) ثم يتجاهل التقسيم — فتتطابق دلالة
 *  «النتائج الحالية» مع ما تعرضه الشاشة حرفياً، لا مع صفحتها المرئية.
 *
 *  المصدر منتجٌ عالميّ **لمنتجٍ بسيط فقط**: `avg_cost` حقلٌ على `products`
 *  يبقى متوسطاً واحداً للمنشأة بلا تغيير — PR-ACL-INVENTORY-CATALOG-EXPORT-SCOPE
 *  لا يخترع تكلفة لكل مخزن (انظر AWJ_INVENTORY_VALUATION_SEMANTICS.md).
 *  **الكمية وحدها** تصبح نطاق المخزن الفعّال للمستخدم المقيَّد: مجموع
 *  `product_warehouse_stock` ضمن مخازنه المسموحة، بدل `products.quantity_on_hand`
 *  العالمي. غير المقيَّد (`allowedWarehouseIds() === null`) يستمر بالعمود
 *  العالمي حرفياً — لا خسارة لكمية مرحلة ما قبل المخازن (حركات بلا
 *  `warehouse_id`، انظر §10 من مستند الدلالات) لأن التوافق الرجعي الكامل
 *  يبقيها في `quantity_on_hand` وحده.
 *
 *  **منتجٌ متعدد الخيارات (VAR-FU-3/GAP-04):** لا صفّ للأب إطلاقاً — صفٌّ لكل
 *  `ProductVariant` فعّالٍ بعينه، وكميته ومتوسط تكلفته من `InventoryState`
 *  الخاصّة بهذا المتغيّر وحده. يطابق دلالة
 *  `InventoryReportService::inventoryValue()` (VAR-REPORT-1) حرفياً — لا سلطة
 *  هويّة مخزونٍ موازية جديدة هنا.
 */
class InventoryBalanceExportService
{
    public const SCOPE_FILTERED = 'filtered';
    public const SCOPE_ALL = 'all';

    public const FORMAT_CSV = 'csv';
    public const FORMAT_XLSX = 'xlsx';

    /**
     * سقف صفوف التصدير في طلب متزامن — كتصدير المنتجات. لا عامل خلفية في
     * الإنتاج، فالسقف صريح بدل مهلة طلب مقطوعة على ملف نصف مكتوب. CSV يُبثّ
     * على دفعات، وXLSX يُبنى في ملف مؤقت ثم يُبثّ ويُحذف.
     */
    public const MAX_ROWS = 50000;

    /** حجم الدفعة في المرور بالإزاحة — يوازن بين عدد الاستعلامات والذاكرة. */
    private const CHUNK = 500;

    /**
     * أعمدة الملف بترتيبها ونوعها.
     *  - المعرّفات (الرمز، الباركود) نصّاً: تحفظ الأصفار البادئة ولا تتحوّل
     *    إلى صيغة علمية في Excel.
     *  - الكمية ومتوسط التكلفة وقيمة المخزون أرقاماً: تُجمَع وتُفرَز كأرقام.
     *
     * @return array<string, array{ar: string, en: string, type: string}>
     */
    private const COLUMNS = [
        'sku'         => ['ar' => 'رمز الصنف', 'en' => 'SKU', 'type' => SpreadsheetWriter::TYPE_TEXT],
        'barcode'     => ['ar' => 'الباركود', 'en' => 'Barcode', 'type' => SpreadsheetWriter::TYPE_TEXT],
        'name'        => ['ar' => 'اسم الصنف', 'en' => 'Product name', 'type' => SpreadsheetWriter::TYPE_TEXT],
        'unit'        => ['ar' => 'الوحدة', 'en' => 'Unit', 'type' => SpreadsheetWriter::TYPE_TEXT],
        'quantity'    => ['ar' => 'الكمية', 'en' => 'Quantity', 'type' => SpreadsheetWriter::TYPE_NUMBER],
        'avg_cost'    => ['ar' => 'متوسط التكلفة', 'en' => 'Average cost', 'type' => SpreadsheetWriter::TYPE_NUMBER],
        'stock_value' => ['ar' => 'قيمة المخزون', 'en' => 'Inventory value', 'type' => SpreadsheetWriter::TYPE_NUMBER],
        // VAR-FU-3/GAP-04: هويّةٌ صريحة إضافية — المستلم يميّز صفوف متغيّرات
        // نفس المنتج بلا الاعتماد على `name` وحده (قد يتكرّر حرفياً بين صفوف
        // متغيّرات نفس المنتج). أعمدةٌ إضافيّة في نهاية الترتيب القائم فقط —
        // العقد القديم (سبعة أعمدة، منتجٌ بسيط = صفٌّ واحد) يبقى بلا تغيير.
        'product_id'          => ['ar' => 'معرّف الصنف', 'en' => 'Product ID', 'type' => SpreadsheetWriter::TYPE_TEXT],
        'product_variant_id'  => ['ar' => 'معرّف المتغيّر', 'en' => 'Variant ID', 'type' => SpreadsheetWriter::TYPE_TEXT],
        'variant_descriptor'  => ['ar' => 'وصف المتغيّر', 'en' => 'Variant', 'type' => SpreadsheetWriter::TYPE_TEXT],
    ];

    /** @return array<int, string> */
    public function headers(string $locale): array
    {
        $key = str_starts_with($locale, 'en') ? 'en' : 'ar';

        return array_map(static fn (array $column): string => $column[$key], array_values(self::COLUMNS));
    }

    /** @return array<int, string> */
    public function columnTypes(): array
    {
        return array_map(static fn (array $column): string => $column['type'], array_values(self::COLUMNS));
    }

    /**
     * يبني استجابة تنزيل من استعلام مُعدّ مسبقاً (مصفّى ومُرتَّب في المتحكّم).
     *
     * `$includeZero=false` يُسقط الأصناف ذات الرصيد صفر — خيار **تصدير** لا
     * يمسّ الشاشة. يُطبَّق هنا لا في المتحكّم كي يشمل عدّ الصفوف نفسه فلا
     * يتجاوز ملفٌ مصفّى السقفَ بأصفارٍ لن تُكتب.
     */
    /**
     * `$costAuthorized=false` يفرغ `avg_cost`/`stock_value` دون حذف عمودَيهما —
     * PR-INV-1: تصدير آمن لمن لا يملك `products.view_cost` بدل حجب التقرير كله.
     *
     * `$warehouseIds` نطاق المخزن الفعّال (`ReportWarehouseScope::resolve()`):
     * `null` = غير مقيَّد، الكمية تبقى `products.quantity_on_hand` كما كانت.
     * مصفوفة = مقيَّد؛ الكمية تُعاد حسابها لكل دفعة من `product_warehouse_stock`
     * ضمن هذه المخازن وحدها (`rows()`).
     */
    public function download(Builder $query, string $format, string $filename, string $locale, bool $includeZero, bool $costAuthorized = true, ?array $warehouseIds = null): StreamedResponse|Response
    {
        // فلترة SQL على `quantity_on_hand` العالمي صحيحة لغير المقيَّد فقط —
        // الكمية المعروضة له هي العمود نفسه. المقيَّد يُستبعد صفره أثناء البث
        // في rows() على الكمية المحدودة النطاق الفعلية، لا هذا العمود.
        //
        // VAR-FU-3: منتجٌ `variant_managed` **لا هويّة مخزونٍ بسيطة خاصة به**
        // — الانضمام في `InventoryBalanceFilters::query()` مقيَّدٌ بـ
        // `product_variant_id IS NULL`، فيعود NULL له دائماً بلا علاقة بمخزونه
        // الفعلي عبر متغيّراته. استبعاده هنا بنفس الشرط كان يُسقط كل منتجٍ
        // متعدد الخيارات من تصديرٍ يستبعد الصفر — فيُستثنى صراحةً من فلترة SQL
        // هذه، ويُطبَّق استبعاد الصفر لكل متغيّرٍ بعينه في rows() بدلاً منه.
        if (! $includeZero && $warehouseIds === null) {
            // VAR-INV-1: `products.quantity_on_hand` مجمَّد — القراءة من الهويّة
            // البسيطة المضمومة في `InventoryBalanceFilters::query()`.
            $query->where(function (Builder $scope): void {
                $scope->where('products.variant_state', 'variant_managed')
                    ->orWhereRaw('COALESCE(inventory_states.quantity_on_hand, 0) != 0');
            });
        }

        // السقف يبقى على العدّ العالمي حتى للمقيَّد: تصفية أدق حسب المخزن كانت
        // تحتاج استعلام تجميع إضافي هنا، والعدّ العالمي حدٌّ أعلى آمن — لا يقل
        // أبداً عمّا سيُصدَّر فعلاً، فلا يفلت تصديرٌ كان يجب حجبه.
        //
        // VAR-FU-3: عدد الصفوف الفعلي لم يعد يساوي عدد المنتجات — منتجٌ متعدد
        // الخيارات يصدّر صفاً لكل متغيّرٍ فعّال، لا صفاً واحداً. الحدّ الأعلى
        // يُحسَب من عدد المنتجات البسيطة + عدد المتغيّرات الفعّالة للمنتجات
        // متعددة الخيارات، فيبقى حداً أعلى آمناً حقيقياً لا مجرد عدّ منتجات.
        $total = $this->estimatedRowCount($query);
        if ($total > self::MAX_ROWS) {
            throw new RuntimeException(
                'عدد الأصناف المطلوب تصديره ('.$total.') يتجاوز الحد الأقصى البالغ '.self::MAX_ROWS
                .' صفاً في طلب واحد. ضيّق الفلاتر ثم أعد التصدير.'
            );
        }

        $headers = $this->headers($locale);

        return $format === self::FORMAT_XLSX
            ? $this->xlsxResponse($query, $headers, $filename, $costAuthorized, $warehouseIds, $includeZero)
            : $this->csvResponse($query, $headers, $filename, $costAuthorized, $warehouseIds, $includeZero);
    }

    /** @param array<int, string> $headers */
    private function csvResponse(Builder $query, array $headers, string $filename, bool $costAuthorized, ?array $warehouseIds, bool $includeZero): StreamedResponse
    {
        return response()->streamDownload(function () use ($query, $headers, $costAuthorized, $warehouseIds, $includeZero): void {
            SpreadsheetWriter::streamCsv($headers, $this->rows($query, $costAuthorized, $warehouseIds, $includeZero));
        }, "{$filename}.csv", [
            'Content-Type' => 'text/csv; charset=UTF-8',
        ]);
    }

    /** @param array<int, string> $headers */
    private function xlsxResponse(Builder $query, array $headers, string $filename, bool $costAuthorized, ?array $warehouseIds, bool $includeZero): Response
    {
        $path = tempnam(sys_get_temp_dir(), 'nebrax-inventory-');
        if ($path === false) {
            throw new RuntimeException('تعذر تجهيز ملف التصدير المؤقت.');
        }

        try {
            SpreadsheetWriter::xlsx($path, $headers, $this->rows($query, $costAuthorized, $warehouseIds, $includeZero), $this->columnTypes(), 'Inventory');
            $contents = file_get_contents($path);
            if ($contents === false) {
                throw new RuntimeException('تعذر قراءة ملف التصدير بعد بنائه.');
            }

            return response($contents, 200, [
                'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition' => 'attachment; filename="'.$filename.'.xlsx"',
                'Content-Length' => (string) strlen($contents),
            ]);
        } finally {
            @unlink($path);
        }
    }

    /**
     * حدٌّ أعلى آمن على **صفوف** الملف، لا على عدد المنتجات — كل منتجٍ متعدد
     * الخيارات يصدّر صفاً لكل متغيّرٍ فعّال، لا صفاً واحداً (VAR-FU-3). يُحسب
     * كـ«عدد المنتجات البسيطة» + «عدد المتغيّرات الفعّالة للمنتجات متعددة
     * الخيارات المطابقة» — استعلامان إضافيّان خفيفان مرّة واحدة فقط لكل طلب
     * تصدير، لا لكل صفّ.
     */
    private function estimatedRowCount(Builder $query): int
    {
        $productTotal = (clone $query)->toBase()->getCountForPagination();

        $variantManagedIds = (clone $query)->toBase()
            ->where('products.variant_state', 'variant_managed')
            ->pluck('products.id');

        if ($variantManagedIds->isEmpty()) {
            return $productTotal;
        }

        $variantRowCount = ProductVariant::query()
            ->whereIn('product_id', $variantManagedIds)
            ->where('is_active', true)
            ->count();

        return $productTotal - $variantManagedIds->count() + $variantRowCount;
    }

    /**
     * مرور على دفعات يحترم ترتيب الشاشة. لا `lazyById` (تفرض ترتيباً بالمفتاح
     * فتُسقط الفرزَ المطلوب صامتةً)؛ المتحكّم يضمن ترتيباً حتمياً (عمود الفرز
     * ثم `id`) فالتقسيم بالإزاحة مستقرّ.
     *
     * لكل دفعة، إن كان المستخدم مقيَّداً بمخازن: استعلام تجميع واحد إضافي على
     * `product_warehouse_stock` لمنتجات الدفعة نفسها فقط — يحافظ على نمط
     * الذاكرة المحدودة (لا تحميل الكتالوج كله لحساب خريطة عالمية). التجميع
     * بـ(product_id, product_variant_id) معاً منذ VAR-FU-3 — لا جمع أرصدة
     * متغيّرات إخوة في دلوٍ واحد كما كان قبلها.
     *
     * منتجٌ متعدد الخيارات (VAR-FU-3): لا صفّ للأب إطلاقاً — صفٌّ لكل متغيّرٍ
     * فعّالٍ بعينه، كميته ومتوسط تكلفته من `InventoryState` الخاصّة به وحده
     * (`ProductVariant::quantity_on_hand`/`avg_cost`) — لا مجموع الأب المشتقّ
     * ولا 0 الأب المتحفّظ. يطابق دلالة `InventoryReportService::inventoryValue()`
     * حرفياً (VAR-REPORT-1) بلا سلطةٍ موازية جديدة.
     *
     * @return \Generator<int, array<int, string|null>>
     */
    private function rows(Builder $query, bool $costAuthorized, ?array $warehouseIds, bool $includeZero): \Generator
    {
        $page = 1;

        do {
            $batch = (clone $query)->forPage($page, self::CHUNK)->get();

            $variantManagedProducts = $batch->filter(fn (Product $p) => $p->isVariantManaged());
            $variantsByProduct = $variantManagedProducts->isEmpty() ? collect() : ProductVariant::query()
                ->whereIn('product_id', $variantManagedProducts->pluck('id'))
                ->where('is_active', true)
                ->with('inventoryState')
                ->orderBy('sku')
                ->get()
                ->groupBy('product_id');

            $scopedQuantities = $warehouseIds === null ? null : ProductWarehouseStock::query()
                ->whereIn('product_id', $batch->pluck('id'))
                ->whereIn('warehouse_id', $warehouseIds)
                ->selectRaw('product_id, product_variant_id, SUM(quantity) as qty')
                ->groupBy('product_id', 'product_variant_id')
                ->get()
                ->groupBy('product_id')
                ->map(fn (Collection $rows) => $rows->keyBy(fn ($row) => $row->product_variant_id ?? ''));

            foreach ($batch as $product) {
                if ($product->isVariantManaged()) {
                    foreach ($variantsByProduct->get($product->id, collect()) as $variant) {
                        $quantity = $warehouseIds === null
                            ? (int) $variant->quantity_on_hand
                            : (int) ($scopedQuantities?->get($product->id)?->get($variant->id)?->qty ?? 0);

                        // لا استبعاد بـWHERE على منتجٍ متعدد الخيارات (download()
                        // يسمح بمروره كاملاً) — الصفر يُستبعد هنا لكل متغيّرٍ بعينه.
                        if (! $includeZero && $quantity === 0) {
                            continue;
                        }

                        yield $this->row($product, $variant, $costAuthorized, $quantity);
                    }

                    continue;
                }

                $quantity = $warehouseIds === null
                    ? (int) $product->quantity_on_hand
                    : (int) ($scopedQuantities?->get($product->id)?->get('')?->qty ?? 0);

                // استبعاد الصفر هنا لا في WHERE: الكمية المرجعية للمقيَّد هي
                // المجموع المحدود النطاق، لا `quantity_on_hand` العالمي.
                if (! $includeZero && $warehouseIds !== null && $quantity === 0) {
                    continue;
                }

                yield $this->row($product, null, $costAuthorized, $quantity);
            }

            $page++;
        } while ($batch->count() === self::CHUNK);
    }

    /**
     * صفٌّ واحد. `$quantity` مُحسَبة مسبقاً في rows() — العمود العالمي مباشرة
     * لغير المقيَّد، أو مجموع نطاق المخزن الفعّال للمقيَّد. القيمة تُشتقّ من
     * نفس `$quantity × avg_cost` بالهللات ثم تُعرَض ريالاً — فما يجده المستخدم
     * في الملف هو ما يراه في الجدول، ضمن نطاقه.
     *
     * `$variant`: `null` لمنتجٍ بسيط (كما كان تماماً). لهويّة متغيّرٍ بعينه:
     * الرمز يفضّل رمز المتغيّر (يطابق `InventoryReportService::inventoryValue()`)،
     * والمتوسط والكمية من `InventoryState` الخاصّة بهذا المتغيّر وحده — أبداً
     * لا من الأب. `barcode`/`name`/`unit` تبقى من الأب حرفياً (الباركود الأساسي
     * والاسم والوحدة ليست هويّةً مخزونيّة مستقلّة للمتغيّر) — عمودا الهويّة
     * الإضافيان (`product_variant_id`/`variant_descriptor`) هما التمييز، لا
     * إعادة كتابة `name`.
     *
     * @return array<int, string|null>
     */
    private function row(Product $product, ?ProductVariant $variant, bool $costAuthorized, int $quantity): array
    {
        $avgCost = $variant !== null ? (int) $variant->avg_cost : (int) $product->avg_cost;

        return [
            $variant?->sku ?? $product->sku,
            $product->barcode,
            $product->name,
            $product->unit,
            (string) $quantity,
            $costAuthorized ? Money::toRiyal($avgCost) : null,
            $costAuthorized ? Money::toRiyal($quantity * $avgCost) : null,
            (string) $product->id,
            $variant !== null ? (string) $variant->id : null,
            $variant !== null ? DocumentLineVariantResolver::descriptor($variant) : null,
        ];
    }
}
