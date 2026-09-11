<?php

namespace App\Services;

use App\Models\BarcodeRegistryEntry;
use App\Models\PriceList;
use App\Models\PriceListItem;
use App\Models\Product;
use App\Models\ProductBarcode;
use App\Services\Accounting\UnitConversion;
use App\Support\BarcodeImportFields;
use App\Support\Money;
use App\Support\ProductImportFields;
use App\Support\SpreadsheetReader;
use App\Support\SpreadsheetWriter;
use App\Support\UnitPriceImportFields;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Response;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PR-UOM2-4 — مصنّف تبادل بثلاث أوراق: Products / Barcodes / Unit Prices
 * ═══════════════════════════════════════════════════════════════
 *  **ورقة Products لا تُعاد كتابتها هنا.** تُستخرَج صفوفها من المصنّف وتُغلَّف
 *  في ملف CSV مؤقّت يمرّ حرفياً عبر `ProductImportService` القائمة — نفس
 *  التحقق ونفس الاختبارات ونفس السلوك بالضبط، لا نسخة موازية منه.
 *
 *  ورقتا Barcodes وUnit Prices جديدتان تماماً؛ الأولى تُنشئ `ProductBarcode`
 *  عبر نفس مسار `POST /products/{id}/barcodes` (تحقّق الوحدة، فضاء الباركود
 *  الذرّي)، والثانية تكتب عبر `PriceListService::upsertItem()` القائمة ضد
 *  قائمة سعرٍ واحدة **يحدّدها المستخدم صراحة قبل كل تشغيل** (القرار D-F) —
 *  لا قائمة افتراضية، ولا تخمين، وفشلٌ مغلقٌ إن غابت.
 *
 *  `apply()` يُشغِّل الأوراق الثلاث داخل معاملة واحدة، بعد أن يتحقّق أن لا
 *  خطأ في أيٍّ منها — تماماً كقاعدة «لا كتابة قبل ملفٍّ نظيف» في المسار
 *  أحادي الورقة، مُطبَّقةً على المصنّف كلّه.
 */
class ProductWorkbookService
{
    public const SHEET_PRODUCTS = 'Products';

    public const SHEET_BARCODES = 'Barcodes';

    public const SHEET_UNIT_PRICES = 'Unit Prices';

    /**
     * PR-DUR-HARDEN-1 — قيمةٌ صريحة مستقلّة الآن، لا مستعارة من
     * `ProductImportService::MAX_ROWS` كما كانت. المصنّف ذرّيٌّ بطبيعته
     * (`apply()` يطبّق أوراقه الثلاث معاً داخل معاملةٍ واحدة، بلا
     * `batch_offset`/`batch_size` أصلاً — PR-DUR-3)، فسقفه يخضع لنفس منطق
     * `apply()` المتزامن غير المجزَّأ الذي أبقى `ProductImportService::MAX_ROWS`
     * عند ٢٠٠٠: التحقّق والكتابة كلاهما لكامل الملف في طلبٍ واحد. رفع سقف
     * `product_catalog` الدائم المجزَّأ (`DURABLE_MAX_ROWS`) لا يمسّ هذا
     * المجال، فالاستعارة القديمة كانت ستربطهما سهواً بقيمةٍ واحدة تتغيّر معاً.
     */
    public const MAX_ROWS = 2000;

    public const MAX_COLUMNS = ProductImportService::MAX_COLUMNS;

    public function __construct(
        protected ProductImportService $productImports,
        protected ProductExportService $productExports,
        protected PriceListService $priceLists,
        protected UnitConversion $units,
    ) {}

    // ═══════════════════════════════════════════════════════════════
    //  القالب وعقد الحقول
    // ═══════════════════════════════════════════════════════════════

    /** مصنّف قالب بشري بثلاث أوراق فارغة (ترويسات + سطر مثال واحد لكل ورقة). */
    public function template(): string
    {
        $path = tempnam(sys_get_temp_dir(), 'nebrax-workbook-template-');
        if ($path === false) {
            throw new RuntimeException('تعذر تجهيز ملف القالب المؤقت.');
        }

        try {
            SpreadsheetWriter::workbookXlsx($path, [
                [
                    'name' => self::SHEET_PRODUCTS,
                    'headers' => ProductImportFields::templateHeaders(),
                    'rows' => [$this->templateRow(ProductImportFields::templateHeaders(), [
                        'sku' => 'SKU-1001', 'name' => 'قهوة عربية', 'name_en' => 'Arabic Coffee',
                        'type' => 'good', 'unit' => 'قطعة', 'sale_price' => '35.00',
                        'purchase_price' => '20.00', 'tax_rate' => '15', 'track_inventory' => '1', 'is_active' => '1',
                    ])],
                ],
                [
                    'name' => self::SHEET_BARCODES,
                    'headers' => BarcodeImportFields::templateHeaders(),
                    'rows' => [$this->templateRow(BarcodeImportFields::templateHeaders(), [
                        'sku' => 'SKU-1001', 'code' => '6281234567890', 'unit_name' => '', 'default_quantity' => '1',
                    ])],
                ],
                [
                    'name' => self::SHEET_UNIT_PRICES,
                    'headers' => UnitPriceImportFields::templateHeaders(),
                    'rows' => [$this->templateRow(UnitPriceImportFields::templateHeaders(), [
                        'sku' => 'SKU-1001', 'unit_name' => 'قطعة', 'price' => '35.00',
                    ])],
                ],
            ]);

            $contents = file_get_contents($path);
            if ($contents === false) {
                throw new RuntimeException('تعذر قراءة ملف القالب بعد بنائه.');
            }

            return $contents;
        } finally {
            @unlink($path);
        }
    }

    /** @param array<int, string> $headers @param array<string, string> $values @return array<int, string> */
    private function templateRow(array $headers, array $values): array
    {
        return array_map(static fn (string $key): string => $values[$key] ?? '', $headers);
    }

    /** عقد الحقول الثلاثة للواجهة — بلا Products المُتاحة أصلاً عبر `products/import/fields`. */
    public function fieldContract(): array
    {
        $describe = static fn (array $fields): array => array_map(
            static fn (string $key, array $field): array => [
                'key' => $key,
                'label_ar' => $field['label_ar'],
                'label_en' => $field['label_en'],
                'required' => (bool) $field['required'],
            ],
            array_keys($fields),
            $fields,
        );

        return [
            'products' => $this->productImports->fieldContract(),
            'barcodes' => $describe(BarcodeImportFields::all()),
            'unit_prices' => $describe(UnitPriceImportFields::all()),
        ];
    }

    // ═══════════════════════════════════════════════════════════════
    //  الفحص (بلا تحقق ولا كتابة)
    // ═══════════════════════════════════════════════════════════════

    /** @return array<string, mixed> */
    public function inspect(UploadedFile $file): array
    {
        $sheets = $this->readWorkbook($file);

        $describe = function (?array $rows, callable $suggest): array {
            if ($rows === null) {
                return ['present' => false, 'columns' => [], 'total_rows' => 0];
            }

            $headers = array_map(static fn ($value): string => trim((string) $value), array_shift($rows) ?? []);
            $mapping = $suggest($headers);
            $columns = [];
            foreach ($headers as $index => $header) {
                $columns[] = ['index' => $index, 'header' => $header, 'suggested_field' => $mapping[$index] ?? null];
            }

            return [
                'present' => true,
                'columns' => $columns,
                'total_rows' => count(array_filter($rows, fn (array $row): bool => ! $this->isBlankRow($row))),
            ];
        };

        return [
            'sheets' => [
                'products' => $describe($sheets[self::SHEET_PRODUCTS] ?? null, fn (array $h) => ProductImportFields::autoMap($h)),
                'barcodes' => $describe($sheets[self::SHEET_BARCODES] ?? null, fn (array $h) => BarcodeImportFields::autoMap($h)),
                'unit_prices' => $describe($sheets[self::SHEET_UNIT_PRICES] ?? null, fn (array $h) => UnitPriceImportFields::autoMap($h)),
            ],
            'fields' => $this->fieldContract(),
        ];
    }

    // ═══════════════════════════════════════════════════════════════
    //  المعاينة (بلا كتابة)
    // ═══════════════════════════════════════════════════════════════

    /**
     * @param  array<string, mixed>  $productOptions
     * @return array<string, mixed>
     */
    public function preview(UploadedFile $file, array $productOptions, ?PriceList $priceList, bool $costAuthorized = true): array
    {
        $sheets = $this->readWorkbook($file);
        $this->assertProductsSheetPresent($sheets);

        $productsPreview = $this->productsPreview($sheets, $productOptions, $costAuthorized);
        $barcodesParsed = $this->parseBarcodesSheet($sheets[self::SHEET_BARCODES] ?? null);
        $unitPricesParsed = $this->parseUnitPricesSheet($sheets[self::SHEET_UNIT_PRICES] ?? null, $priceList);

        return [
            'products' => $productsPreview,
            'barcodes' => $this->sheetSummary($barcodesParsed),
            'unit_prices' => $this->sheetSummary($unitPricesParsed),
            'ready' => $productsPreview['error_rows'] === 0 && $barcodesParsed['error_rows'] === 0 && $unitPricesParsed['error_rows'] === 0,
        ];
    }

    // ═══════════════════════════════════════════════════════════════
    //  التطبيق
    // ═══════════════════════════════════════════════════════════════

    /**
     * @param  array<string, mixed>  $productOptions
     * @return array<string, mixed>
     */
    public function apply(UploadedFile $file, array $productOptions, ?PriceList $priceList, ?string $userId = null, bool $costAuthorized = true): array
    {
        $sheets = $this->readWorkbook($file);
        $this->assertProductsSheetPresent($sheets);

        // فحصٌ كاملٌ للأوراق الثلاث **قبل** أي كتابة: صفٌّ خاطئ في أي ورقة
        // يوقف المصنّف كلّه — نفس قاعدة «لا كتابة قبل ملفٍّ نظيف» الحالية،
        // مطبَّقةً على المصنّف بدل ورقة واحدة.
        $productsPreview = $this->productsPreview($sheets, $productOptions, $costAuthorized);
        $barcodesParsed = $this->parseBarcodesSheet($sheets[self::SHEET_BARCODES] ?? null);
        $unitPricesParsed = $this->parseUnitPricesSheet($sheets[self::SHEET_UNIT_PRICES] ?? null, $priceList);

        if ($productsPreview['error_rows'] > 0 || $barcodesParsed['error_rows'] > 0 || $unitPricesParsed['error_rows'] > 0) {
            throw new RuntimeException('لا يمكن تطبيق المصنّف قبل معالجة الأخطاء الظاهرة في معاينة أوراقه الثلاث.');
        }
        if ($productsPreview['total_rows'] === 0 && $barcodesParsed['total_rows'] === 0 && $unitPricesParsed['total_rows'] === 0) {
            throw new RuntimeException('لا يحتوي المصنّف صفوف بيانات قابلة للتطبيق في أي ورقة.');
        }

        return DB::transaction(function () use ($sheets, $productOptions, $priceList, $userId, $costAuthorized): array {
            // ترتيبٌ مقصود: Products أولاً — منتجٌ جديدٌ بهذا الملف نفسه (برمز
            // صنفٍ صريح) يصبح مرئياً لسطور Barcodes/Unit Prices بعده مباشرة،
            // لأن الكل يعمل داخل نفس المعاملة (نقطة استعادة لا معاملة مستقلة).
            $productsResult = null;
            if (($sheets[self::SHEET_PRODUCTS] ?? null) !== null && count($sheets[self::SHEET_PRODUCTS]) > 1) {
                $productsResult = $this->productImports->apply($this->productsCsv($sheets), $productOptions, $userId, $costAuthorized);
            }

            $barcodesResult = $this->applyBarcodesSheet($sheets[self::SHEET_BARCODES] ?? null, $userId);
            $unitPricesResult = $this->applyUnitPricesSheet($sheets[self::SHEET_UNIT_PRICES] ?? null, $priceList);

            return [
                'products' => $productsResult,
                'barcodes' => $barcodesResult,
                'unit_prices' => $unitPricesResult,
            ];
        });
    }

    // ═══════════════════════════════════════════════════════════════
    //  قائمة السعر — القرار D-F: لا تخمين، فشلٌ مغلقٌ إن غابت/خرجت عن النطاق/كانت معطّلة
    // ═══════════════════════════════════════════════════════════════

    /**
     * مصدر الحقيقة الوحيد لتحليل `price_list_id` — يستهلكه `ProductWorkbookController`
     * (عبر `abort(422,...)` كما كان حرفياً) و`ImportJobService::applyNextChunk()`
     * (عبر `RuntimeException` تلتقطها `ApiController::domain()` فتنتج 422 مطابقاً).
     * `PriceList::query()` يُطبَّق عليه عزل المستأجر تلقائياً (`BaseModel`/`TenantScope`)
     * فلا حاجة لفحصٍ يدويّ — معرّفٌ من مؤسسة أخرى لا يُحلّ أصلاً.
     */
    public function resolveActivePriceList(?string $priceListId): PriceList
    {
        $priceList = $priceListId !== null ? PriceList::query()->find($priceListId) : null;
        if ($priceList === null) {
            throw new RuntimeException('قائمة السعر المحدَّدة غير موجودة في نطاق المؤسسة.');
        }
        if (! $priceList->is_active) {
            throw new RuntimeException('قائمة السعر المحدَّدة غير نشطة.');
        }

        return $priceList;
    }

    // ═══════════════════════════════════════════════════════════════
    //  التصدير
    // ═══════════════════════════════════════════════════════════════

    public function export(Builder $productsQuery, PriceList $priceList, string $filename, bool $costAuthorized = true): StreamedResponse|Response
    {
        $total = (clone $productsQuery)->toBase()->getCountForPagination();
        if ($total > ProductExportService::MAX_ROWS) {
            throw new RuntimeException(
                'عدد المنتجات المطلوب تصديرها ('.$total.') يتجاوز الحد الأقصى البالغ '
                .ProductExportService::MAX_ROWS.' صفاً في طلب واحد. ضيّق الفلاتر ثم أعد التصدير.'
            );
        }

        $products = (clone $productsQuery)->with(['productCategory', 'productBrand', 'unitTemplate', 'alternateBarcodes'])->get();
        $productHeaders = ProductImportFields::roundTripHeaders();
        $productRows = $products->map(fn (Product $product): array => $this->productExports->row($product, $productHeaders, $costAuthorized))->all();

        $barcodeHeaders = BarcodeImportFields::roundTripHeaders();
        $barcodeRows = [];
        foreach ($products as $product) {
            foreach ($product->alternateBarcodes as $barcode) {
                $barcodeRows[] = [
                    (string) $product->id, (string) $product->sku, (string) $barcode->code,
                    $barcode->unit_name, (string) $barcode->default_quantity, $barcode->label,
                ];
            }
        }

        $priceHeaders = UnitPriceImportFields::roundTripHeaders();
        $priceRows = [];
        $ids = $products->pluck('id')->all();
        if ($ids !== []) {
            $items = PriceListItem::query()
                ->where('price_list_id', $priceList->id)
                ->whereIn('product_id', $ids)
                ->get();
            $bySkuProduct = $products->keyBy('id');
            foreach ($items as $item) {
                $product = $bySkuProduct->get($item->product_id);
                if ($product === null) {
                    continue;
                }
                // فراغٌ لا اسم الوحدة الأساسية حرفياً: `UnitConversion::resolve()`
                // يرفض أي وحدةٍ مُسمّاةٍ لمنتجٍ بلا قالب — حتى لو كانت الاسم
                // نفسه لوحدته الأساسية — فكتابة الاسم هنا كانت ستكسر round-trip
                // بالضبط لمنتجٍ كهذا. الفراغ يعني «وحدة الأساس» عند إعادة
                // الاستيراد، تماماً كما تعني عند الإنشاء المباشر.
                $unitName = $item->unit_name === $product->unit ? '' : $item->unit_name;
                $priceRows[] = [
                    (string) $product->id, (string) $product->sku, $unitName,
                    Money::toRiyal($item->price),
                ];
            }
        }

        $path = tempnam(sys_get_temp_dir(), 'nebrax-products-workbook-');
        if ($path === false) {
            throw new RuntimeException('تعذر تجهيز ملف التصدير المؤقت.');
        }

        try {
            SpreadsheetWriter::workbookXlsx($path, [
                ['name' => self::SHEET_PRODUCTS, 'headers' => $productHeaders, 'rows' => $productRows, 'types' => $this->productExports->columnTypes($productHeaders)],
                ['name' => self::SHEET_BARCODES, 'headers' => $barcodeHeaders, 'rows' => $barcodeRows, 'types' => [null, null, null, null, SpreadsheetWriter::TYPE_NUMBER, null]],
                ['name' => self::SHEET_UNIT_PRICES, 'headers' => $priceHeaders, 'rows' => $priceRows, 'types' => [null, null, null, SpreadsheetWriter::TYPE_NUMBER]],
            ]);

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

    // ═══════════════════════════════════════════════════════════════
    //  Barcodes — تحليل وتطبيق
    // ═══════════════════════════════════════════════════════════════

    /**
     * @param  array<int, array<int, string>>|null  $rows
     * @return array<string, mixed>
     */
    private function parseBarcodesSheet(?array $rows): array
    {
        if ($rows === null) {
            return ['total_rows' => 0, 'error_rows' => 0, 'rows' => [], 'errors' => []];
        }

        $headers = array_map(static fn ($value): string => trim((string) $value), array_shift($rows) ?? []);
        $mapping = BarcodeImportFields::autoMap($headers);

        $parsed = [];
        $errors = [];
        $seenCodes = [];
        $errorCount = 0;

        foreach ($rows as $offset => $values) {
            if ($this->isBlankRow($values)) {
                continue;
            }
            $rowNumber = $offset + 2;
            $cells = $this->cells($values, $mapping);
            $messages = [];

            $product = $this->resolveProduct($cells, $messages);
            $code = trim((string) ($cells['code'] ?? ''));
            $alreadyOwnedByProduct = false;
            if ($code === '') {
                $messages[] = 'الباركود مطلوب.';
            } elseif (isset($seenCodes[mb_strtolower($code, 'UTF-8')])) {
                $messages[] = "الباركود مكرر داخل الملف (أول ظهور في الصف {$seenCodes[mb_strtolower($code, 'UTF-8')]}).";
            } else {
                $seenCodes[mb_strtolower($code, 'UTF-8')] = $rowNumber;
                $existingBarcode = ProductBarcode::query()->where('code', $code)->first();
                if ($existingBarcode !== null) {
                    // مصنّفٌ صُدِّر ثم أُعيد استيراده بلا تعديل يحمل باركوداتٍ
                    // موجودةً بالفعل لنفس المنتج — round-trip حقيقيٌّ لا تعارض:
                    // لا كتابة ثانية، ولا خطأ. أمّا الانتماء لمنتجٍ آخر فتعارضٌ
                    // فعليٌّ كما كان.
                    if ($product !== null && $existingBarcode->product_id === $product->id) {
                        $alreadyOwnedByProduct = true;
                    } else {
                        $messages[] = 'الباركود مستخدم بالفعل في منتج آخر أو كوحدة أخرى.';
                    }
                } elseif (BarcodeRegistryEntry::isTaken($code)) {
                    // مأخوذٌ في السجل الموحّد لكن ليس عبر `ProductBarcode` (مثلاً
                    // باركودٌ أساسيٌّ لمنتجٍ آخر) — تعارضٌ حقيقيٌّ أيضاً.
                    $messages[] = 'الباركود مستخدم بالفعل في منتج آخر أو كوحدة أخرى.';
                }
            }

            $unitName = null;
            if ($product !== null && $messages === [] && ! $alreadyOwnedByProduct) {
                $unitName = $this->resolveBarcodeUnit($product, trim((string) ($cells['unit_name'] ?? '')), $messages);
            }

            $quantityRaw = trim((string) ($cells['default_quantity'] ?? ''));
            $quantity = 1;
            if ($quantityRaw !== '') {
                if (! preg_match('/^\d+$/', $quantityRaw) || (int) $quantityRaw < 1 || (int) $quantityRaw > 1000000) {
                    $messages[] = 'كمية المسح يجب أن تكون عدداً صحيحاً من 1 إلى 1,000,000.';
                } else {
                    $quantity = (int) $quantityRaw;
                }
            }

            $status = $messages === [] ? 'ok' : 'error';
            if ($status === 'error') {
                $errorCount++;
                $errors[] = ['row' => $rowNumber, 'messages' => array_values(array_unique($messages))];
            }

            $parsed[] = [
                'row' => $rowNumber,
                'status' => $status,
                'valid' => $status === 'ok',
                'messages' => array_values(array_unique($messages)),
                'product_id' => $product?->id,
                'code' => $code,
                'unit_name' => $unitName,
                'default_quantity' => $quantity,
                'label' => trim((string) ($cells['label'] ?? '')) ?: null,
                'skip' => $alreadyOwnedByProduct,
            ];
        }

        return ['total_rows' => count($parsed), 'error_rows' => $errorCount, 'rows' => $parsed, 'errors' => $errors];
    }

    /** @param string|null $userId @return array<string, mixed> */
    private function applyBarcodesSheet(?array $rows, ?string $userId): array
    {
        $parsed = $this->parseBarcodesSheet($rows);
        if ($parsed['error_rows'] > 0) {
            throw new RuntimeException('لا يمكن تطبيق ورقة الباركودات قبل معالجة أخطائها.');
        }

        $created = 0;
        $skipped = 0;
        foreach ($parsed['rows'] as $row) {
            if ($row['skip']) {
                // موجودٌ بالفعل لنفس المنتج — round-trip بلا تغيير، لا كتابة.
                $skipped++;

                continue;
            }

            $product = Product::query()->find($row['product_id']);
            if ($product === null) {
                throw new RuntimeException("تعذر العثور على المنتج المستهدف في الصف {$row['row']} أثناء التطبيق.");
            }
            // إعادة تحقّق حيّة: ما ثبت وقت التحليل قد يكون تغيّر بطلبٍ متزامن.
            if (BarcodeRegistryEntry::isTaken($row['code'])) {
                throw new RuntimeException("الباركود «{$row['code']}» في الصف {$row['row']} صار مستخدَماً قبل التطبيق.");
            }

            $product->alternateBarcodes()->create([
                'code' => $row['code'],
                'unit_name' => $row['unit_name'],
                'default_quantity' => $row['default_quantity'],
                'label' => $row['label'],
                'created_by' => $userId,
            ]);
            $created++;
        }

        return ['total_rows' => $parsed['total_rows'], 'created' => $created, 'skipped' => $skipped];
    }

    /** @param array<int, string> $messages */
    private function resolveBarcodeUnit(Product $product, string $unitName, array &$messages): ?string
    {
        $template = $product->unitTemplate;
        $allowed = $template
            ? collect([$template->base_unit])->concat($template->units->pluck('name'))->all()
            : [$product->unit];

        if ($unitName === '') {
            return $product->unit;
        }
        if (! in_array($unitName, $allowed, true)) {
            $messages[] = "وحدة الباركود «{$unitName}» يجب أن تكون وحدة الأساس أو وحدة بديلة معرّفة في قالب المنتج.";

            return null;
        }

        return $unitName;
    }

    // ═══════════════════════════════════════════════════════════════
    //  Unit Prices — تحليل وتطبيق
    // ═══════════════════════════════════════════════════════════════

    /**
     * @param  array<int, array<int, string>>|null  $rows
     * @return array<string, mixed>
     */
    private function parseUnitPricesSheet(?array $rows, ?PriceList $priceList): array
    {
        if ($rows === null || $rows === []) {
            return ['total_rows' => 0, 'error_rows' => 0, 'rows' => [], 'errors' => []];
        }

        $headers = array_map(static fn ($value): string => trim((string) $value), array_shift($rows) ?? []);
        $mapping = UnitPriceImportFields::autoMap($headers);

        $parsed = [];
        $errors = [];
        $errorCount = 0;

        foreach ($rows as $offset => $values) {
            if ($this->isBlankRow($values)) {
                continue;
            }
            $rowNumber = $offset + 2;
            $cells = $this->cells($values, $mapping);
            $messages = [];

            if ($priceList === null) {
                $messages[] = 'لم تُحدَّد قائمة سعر لهذا التشغيل.';
            }

            $product = $this->resolveProduct($cells, $messages);

            // نمرّر الطلب الخام (قد يكون `null`) لا الاسم المُحلَّل: تمرير اسم
            // الوحدة الأساسية المُشتقّ هنا إلى `PriceListService::upsertItem()`
            // لاحقاً — التي تستدعي `resolve()` ثانيةً بنفسها — يجعلها تُعامَل
            // كوحدةٍ مُسمّاةٍ تحتاج قالباً، فيُرفض منتجٌ بلا قالبٍ رغم أن اسمها
            // يطابق وحدته الأساسية حرفياً. التحقّق هنا يبقى كما هو (فشلٌ
            // مغلقٌ على وحدةٍ غير معروفة)، فقط القيمة المخزَّنة للتطبيق تتغيّر.
            $requested = null;
            if ($product !== null && $priceList !== null) {
                $requested = trim((string) ($cells['unit_name'] ?? '')) ?: null;
                try {
                    $this->units->resolve($product, $requested);
                } catch (RuntimeException $exception) {
                    $messages[] = $exception->getMessage();
                }
            }

            if ($product !== null && ! $product->is_active) {
                $messages[] = 'لا يمكن إضافة منتج غير نشط إلى قائمة الأسعار.';
            }
            if ($priceList !== null && ! $priceList->is_active) {
                $messages[] = 'قائمة الأسعار المحددة غير نشطة.';
            }

            $priceRaw = trim((string) ($cells['price'] ?? ''));
            $price = null;
            if ($priceRaw === '') {
                $messages[] = 'السعر مطلوب.';
            } else {
                $price = $this->parseMoney($priceRaw, $messages);
            }

            $status = $messages === [] ? 'ok' : 'error';
            if ($status === 'error') {
                $errorCount++;
                $errors[] = ['row' => $rowNumber, 'messages' => array_values(array_unique($messages))];
            }

            $parsed[] = [
                'row' => $rowNumber,
                'status' => $status,
                'valid' => $status === 'ok',
                'messages' => array_values(array_unique($messages)),
                'product_id' => $product?->id,
                'unit_name' => $requested,
                'price' => $price,
            ];
        }

        return ['total_rows' => count($parsed), 'error_rows' => $errorCount, 'rows' => $parsed, 'errors' => $errors];
    }

    /** @return array<string, mixed> */
    private function applyUnitPricesSheet(?array $rows, ?PriceList $priceList): array
    {
        $parsed = $this->parseUnitPricesSheet($rows, $priceList);
        if ($parsed['error_rows'] > 0) {
            throw new RuntimeException('لا يمكن تطبيق ورقة أسعار الوحدات قبل معالجة أخطائها.');
        }
        if ($parsed['total_rows'] === 0) {
            return ['total_rows' => 0, 'written' => 0];
        }

        $written = 0;
        foreach ($parsed['rows'] as $row) {
            $product = Product::query()->find($row['product_id']);
            if ($product === null || $priceList === null) {
                throw new RuntimeException("تعذر العثور على المنتج أو قائمة السعر المستهدفة في الصف {$row['row']} أثناء التطبيق.");
            }

            $this->priceLists->upsertItem($priceList, $product, [
                'unit_name' => $row['unit_name'],
                'price' => $row['price'],
            ]);
            $written++;
        }

        return ['total_rows' => $parsed['total_rows'], 'written' => $written];
    }

    /**
     * ريال بشري → هللات صحيحة، بلا `float` في أي خطوة — مطابقٌ لمنطق
     * `ProductImportService::parseMoney` عمداً بلا مشاركة كودٍ مباشرة: تكرارٌ
     * صغيرٌ ومقصود بدل توسيع رؤية دوالّ خاصّة في خدمة استيراد المنتجات
     * الحرجة والمُختبَرة بكثافة.
     *
     * @param  array<int, string>  $messages
     */
    private function parseMoney(string $value, array &$messages): ?int
    {
        $normalized = strtr($value, [
            '٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4',
            '٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9',
        ]);
        $normalized = str_replace(['٫', '،'], ['.', ''], $normalized);
        $normalized = preg_replace('/[,\s\x{00A0}]/u', '', $normalized) ?? $normalized;

        if (! preg_match('/^\d+(?:\.\d{1,2})?$/', $normalized)) {
            $messages[] = 'السعر يجب أن يكون رقماً غير سالب بصيغة 123.45 وبمنزلتين عشريتين على الأكثر.';

            return null;
        }
        if (strlen(explode('.', $normalized)[0]) > 13) {
            $messages[] = 'السعر يتجاوز النطاق المالي الآمن.';

            return null;
        }

        [$whole, $fraction] = array_pad(explode('.', $normalized, 2), 2, '');

        return ((int) $whole * 100) + (int) str_pad($fraction, 2, '0');
    }

    // ═══════════════════════════════════════════════════════════════
    //  مشترك
    // ═══════════════════════════════════════════════════════════════

    /**
     * أولوية المطابقة: معرّف نبراكس ثم رمز الصنف — نفس قاعدة ورقة Products
     * حرفياً. الاسم ليس معرّفاً هنا أيضاً.
     *
     * @param  array<string, string>  $cells
     * @param  array<int, string>  $messages
     */
    private function resolveProduct(array $cells, array &$messages): ?Product
    {
        $nebraxId = trim((string) ($cells['nebrax_id'] ?? ''));
        $sku = trim((string) ($cells['sku'] ?? ''));

        if ($nebraxId !== '') {
            if (! preg_match('/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/', $nebraxId)) {
                $messages[] = 'معرّف نبراكس غير صالح.';

                return null;
            }
            $product = Product::query()->whereKey($nebraxId)->first();
            if ($product === null) {
                $messages[] = 'معرّف نبراكس لا يطابق أي منتج في نطاقك.';
            }

            return $product;
        }

        if ($sku !== '') {
            $product = Product::query()->where('sku', $sku)->first();
            if ($product === null) {
                $messages[] = 'رمز الصنف لا يطابق أي منتج في نطاقك.';
            }

            return $product;
        }

        $messages[] = 'الصف يحتاج معرّف نبراكس أو رمز الصنف لتحديد المنتج المستهدف.';

        return null;
    }

    /** @param array<int, string> $values @param array<int, string|null> $mapping @return array<string, string> */
    private function cells(array $values, array $mapping): array
    {
        $cells = [];
        foreach ($mapping as $index => $key) {
            if ($key === null) {
                continue;
            }
            $cells[$key] = trim((string) ($values[$index] ?? ''));
        }

        return $cells;
    }

    /** @param array<string, mixed> $parsed @return array<string, mixed> */
    private function sheetSummary(array $parsed): array
    {
        return [
            'total_rows' => $parsed['total_rows'],
            'error_rows' => $parsed['error_rows'],
            'errors' => $parsed['errors'],
        ];
    }

    /** @param array<int, string> $values */
    private function isBlankRow(array $values): bool
    {
        foreach ($values as $value) {
            if (trim((string) $value) !== '') {
                return false;
            }
        }

        return true;
    }

    /** @return array<string, array<int, array<int, string>>> */
    private function readWorkbook(UploadedFile $file): array
    {
        $extension = strtolower((string) ($file->getClientOriginalExtension() ?: $file->extension()));
        if ($extension !== 'xlsx') {
            throw new RuntimeException('مصنّف المنتجات ثلاثي الأوراق يجب أن يكون بصيغة XLSX. الاستيراد أحادي الورقة (CSV) لا يزال متاحاً في مساره القائم.');
        }

        $path = $file->getRealPath();
        if ($path === false || ! is_readable($path)) {
            throw new RuntimeException('تعذر قراءة ملف الاستيراد.');
        }

        return SpreadsheetReader::readWorkbookXlsx($path, self::MAX_ROWS, self::MAX_COLUMNS);
    }

    /** @param array<string, array<int, array<int, string>>> $sheets */
    private function assertProductsSheetPresent(array $sheets): void
    {
        if (! isset($sheets[self::SHEET_PRODUCTS])) {
            throw new RuntimeException('المصنّف لا يحتوي ورقة «'.self::SHEET_PRODUCTS.'» — هي الورقة الإلزامية الوحيدة.');
        }
    }

    /**
     * ورقة Products بلا صفوف بيانات (ترويسة فقط، أو أعمدة جزئية لا تخصّ
     * Products إطلاقاً في مصنّفٍ همّه الباركودات/الأسعار فقط) لا تستحقّ تحقّق
     * تغطية الأعمدة المطلوبة في `ProductImportService::preview()` — ذاك
     * التحقّق يفترض ملفّاً يُراد تطبيقه فعلاً. صفرُ صفوفٍ يعني ببساطة «لا شيء
     * لفعله في هذه الورقة»، بلا حاجة لعمود `name`/`type`/`sale_price` أصلاً.
     *
     * @param  array<string, array<int, array<int, string>>>  $sheets
     * @param  array<string, mixed>  $productOptions
     * @return array<string, mixed>
     */
    private function productsPreview(array $sheets, array $productOptions, bool $costAuthorized): array
    {
        if (! isset($sheets[self::SHEET_PRODUCTS]) || count($sheets[self::SHEET_PRODUCTS]) <= 1) {
            return [
                'mode' => $productOptions['mode'] ?? ProductImportService::MODE_CREATE,
                'total_rows' => 0, 'create_rows' => 0, 'update_rows' => 0,
                'skipped_rows' => 0, 'warning_rows' => 0, 'error_rows' => 0,
                'valid_rows' => 0, 'invalid_rows' => 0, 'rows' => [], 'rows_shown' => 0,
                'rows_truncated' => false, 'errors' => [],
            ];
        }

        return $this->productImports->preview($this->productsCsv($sheets), $productOptions, $costAuthorized);
    }

    /** يغلّف صفوف ورقة Products في ملف CSV مؤقّت يمرّ حرفياً عبر `ProductImportService`. */
    private function productsCsv(array $sheets): UploadedFile
    {
        $rows = $sheets[self::SHEET_PRODUCTS];
        $headers = array_shift($rows) ?? [];

        $path = tempnam(sys_get_temp_dir(), 'nebrax-workbook-products-');
        if ($path === false) {
            throw new RuntimeException('تعذر تجهيز ملف ورقة المنتجات المؤقت.');
        }
        file_put_contents($path, SpreadsheetWriter::csv($headers, $rows));

        return new UploadedFile($path, 'products.csv', 'text/csv', null, true);
    }
}
