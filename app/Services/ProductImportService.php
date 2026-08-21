<?php

namespace App\Services;

use App\Models\Product;
use App\Tenancy\BranchScope;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * استيراد منتجات CSV بشكل متزامن وآمن.
 *
 * لا يستورد هذا المسار أرصدة أو متوسط تكلفة أو حركات مخزون. تلك حقائق مشتقة
 * من المستندات وحركات المخزون، ولذلك لا تُقبل من ملف كتالوج.
 */
class ProductImportService
{
    public const MODE_CREATE = 'create';
    public const MODE_UPDATE = 'update';

    /** ترتيب ثابت يطابق القالب والتعليمات في الواجهة. */
    public const HEADERS = [
        'sku', 'name', 'name_en', 'type', 'unit', 'sale_price_sar',
        'purchase_price_sar', 'tax_rate', 'track_inventory', 'reorder_level',
        'category', 'brand', 'barcode', 'description', 'is_active',
    ];

    /** حجم عملي لمعالجة طلب واحد؛ الاستيراد الضخم يحتاج مهمة خلفية مستقلة. */
    private const MAX_ROWS = 2000;

    public function template(): string
    {
        $example = [
            'SKU-1001', 'قهوة عربية', 'Arabic Coffee', 'good', 'قطعة', '35.00',
            '20.00', '15', '0', '5', 'مشروبات', 'نبراكس', '6281234567890',
            'عبوة قهوة 250 جرام', '1',
        ];
        $service = [
            'SVC-2001', 'صيانة دورية', 'Periodic Maintenance', 'service', 'خدمة', '150.00',
            '', '15', '0', '', 'خدمات', '', '6281234567906', 'زيارة صيانة واحدة', '1',
        ];

        $stream = fopen('php://temp', 'r+');
        fputcsv($stream, self::HEADERS);
        fputcsv($stream, $example);
        fputcsv($stream, $service);
        rewind($stream);
        $csv = stream_get_contents($stream);
        fclose($stream);

        // يفتح Excel العربي الملف كنص UTF-8 صحيحاً بدلاً من أحرف مشوهة.
        return "\xEF\xBB\xBF".$csv;
    }

    /**
     * @return array{mode: string, total_rows: int, valid_rows: int, invalid_rows: int, rows: array<int, array<string, mixed>>, errors: array<int, array{row: int, messages: array<int, string>}>}
     */
    public function preview(UploadedFile $file, string $mode): array
    {
        $this->assertMode($mode);
        $preview = $this->parse($file, $mode);

        return [
            'mode'         => $preview['mode'],
            'total_rows'   => $preview['total_rows'],
            'valid_rows'   => $preview['valid_rows'],
            'invalid_rows' => $preview['invalid_rows'],
            'rows'         => array_map(static fn (array $row): array => [
                'row'     => $row['row'],
                'valid'   => $row['valid'],
                'action'  => $row['existing'] ? 'update' : 'create',
                'sku'     => $row['data']['sku'],
                'name'    => $row['data']['name'],
                'type'    => $row['data']['type'],
                'barcode' => $row['data']['barcode'],
            ], array_slice($preview['rows'], 0, 50)),
            'errors'       => $preview['errors'],
        ];
    }

    /**
     * يكرر التحليل قبل الكتابة كي لا تصبح معاينة سابقة تفويضاً لتجاوز تحقق حي.
     *
     * @return array{mode: string, created: int, updated: int, total_rows: int}
     */
    public function apply(UploadedFile $file, string $mode): array
    {
        $this->assertMode($mode);
        $preview = $this->parse($file, $mode);
        if ($preview['invalid_rows'] > 0) {
            throw new RuntimeException('لا يمكن تطبيق الاستيراد قبل معالجة الأخطاء الظاهرة في المعاينة.');
        }

        return DB::transaction(function () use ($preview, $mode): array {
            $created = 0;
            $updated = 0;

            foreach ($preview['rows'] as $row) {
                /** @var array<string, mixed> $data */
                $data = $row['data'];
                /** @var Product|null $existing */
                $existing = $row['existing'];

                if ($mode === self::MODE_UPDATE) {
                    if (! $existing) {
                        throw new RuntimeException("تعذر العثور على المنتج ذو SKU «{$data['sku']}» أثناء التطبيق.");
                    }

                    $this->assertNoLiveBarcodeConflict((string) ($data['barcode'] ?? ''), $existing->id);
                    $existing->update($this->updateData($data));
                    $updated++;
                    continue;
                }

                $this->assertNoLiveSkuConflict((string) ($data['sku'] ?? ''));
                $this->assertNoLiveBarcodeConflict((string) ($data['barcode'] ?? ''));
                Product::create($this->createData($data));
                $created++;
            }

            return [
                'mode'       => $mode,
                'created'    => $created,
                'updated'    => $updated,
                'total_rows' => $preview['total_rows'],
            ];
        });
    }

    /**
     * @return array{mode: string, total_rows: int, valid_rows: int, invalid_rows: int, rows: array<int, array<string, mixed>>, errors: array<int, array{row: int, messages: array<int, string>}>}
     */
    private function parse(UploadedFile $file, string $mode): array
    {
        $handle = fopen($file->getRealPath(), 'r');
        if ($handle === false) {
            throw new RuntimeException('تعذر قراءة ملف الاستيراد.');
        }

        try {
            $headers = fgetcsv($handle);
            if ($headers === false) {
                throw new RuntimeException('ملف الاستيراد فارغ.');
            }

            $headers = array_map(static function ($header): string {
                return trim((string) $header, "\xEF\xBB\xBF \t\n\r\0\x0B");
            }, $headers);
            $this->assertHeaders($headers);

            $rows = [];
            $errors = [];
            $seenSkus = [];
            $seenBarcodes = [];
            $rowNumber = 1;

            while (($values = fgetcsv($handle)) !== false) {
                $rowNumber++;
                if ($this->isBlankRow($values)) {
                    continue;
                }
                if (count($rows) >= self::MAX_ROWS) {
                    throw new RuntimeException('يتجاوز الملف الحد الأقصى البالغ 2000 صف. قسّم الملف إلى دفعات أصغر.');
                }

                $messages = [];
                if (count($values) !== count($headers)) {
                    $messages[] = 'عدد الأعمدة لا يطابق صف العناوين في القالب.';
                    $errors[] = ['row' => $rowNumber, 'messages' => $messages];
                    continue;
                }

                /** @var array<string, string> $raw */
                $raw = array_combine($headers, array_map(static fn ($value): string => trim((string) $value), $values));
                [$data, $messages] = $this->normalize($raw, $mode);

                $sku = $data['sku'] ?? null;
                if ($sku !== null && $sku !== '') {
                    if (isset($seenSkus[$sku])) {
                        $messages[] = "رمز SKU مكرر داخل الملف (أول ظهور في الصف {$seenSkus[$sku]}).";
                    }
                    $seenSkus[$sku] = $rowNumber;
                }

                $barcode = $data['barcode'] ?? null;
                if ($barcode !== null && $barcode !== '') {
                    if (isset($seenBarcodes[$barcode])) {
                        $messages[] = "الباركود مكرر داخل الملف (أول ظهور في الصف {$seenBarcodes[$barcode]}).";
                    }
                    $seenBarcodes[$barcode] = $rowNumber;
                }

                $existing = null;
                if ($mode === self::MODE_UPDATE && $sku !== null && $sku !== '') {
                    $existing = Product::query()->where('sku', $sku)->first();
                    if (! $existing) {
                        $messages[] = 'لا يوجد منتج متاح في نطاق الكتالوج الحالي يطابق SKU للتحديث.';
                    } elseif (($data['type'] ?? null) !== $existing->type) {
                        $messages[] = 'لا يغير الاستيراد نوع المنتج الموجود؛ أنشئ منتجاً جديداً بدلاً من إعادة تصنيفه.';
                    } elseif ((bool) ($data['track_inventory'] ?? false) !== (bool) $existing->track_inventory) {
                        $messages[] = 'لا يغير الاستيراد تتبع المخزون للمنتج الموجود؛ فهذا يؤثر في دورة الحركات والتكلفة.';
                    }
                }

                if ($mode === self::MODE_CREATE && $sku !== null && $sku !== '' && $this->hasLiveSkuConflict($sku)) {
                    $messages[] = 'رمز SKU مستخدم بالفعل في نطاق الكتالوج الحالي.';
                }

                if ($barcode !== null && $barcode !== '' && $this->hasLiveBarcodeConflict($barcode, $existing?->id)) {
                    $messages[] = 'الباركود مستخدم بالفعل لمنتج آخر في المؤسسة.';
                }

                if ($messages !== []) {
                    $errors[] = ['row' => $rowNumber, 'messages' => array_values(array_unique($messages))];
                }

                $rows[] = [
                    'row'      => $rowNumber,
                    'data'     => $data,
                    'existing' => $existing,
                    'valid'    => $messages === [],
                ];
            }

            $validRows = count(array_filter($rows, static fn (array $row): bool => $row['valid']));

            return [
                'mode'         => $mode,
                'total_rows'   => count($rows),
                'valid_rows'   => $validRows,
                'invalid_rows' => count($errors),
                'rows'         => $rows,
                'errors'       => $errors,
            ];
        } finally {
            fclose($handle);
        }
    }

    /** @param array<string, string> $raw
     *  @return array{0: array<string, mixed>, 1: array<int, string>}
     */
    private function normalize(array $raw, string $mode): array
    {
        $messages = [];
        $name = $this->nullableText($raw['name'] ?? null);
        $sku = $this->nullableText($raw['sku'] ?? null);
        $type = strtolower((string) ($raw['type'] ?? ''));
        $trackInventory = $this->parseBoolean($raw['track_inventory'] ?? '', 'track_inventory', $messages, false);
        $isActive = $this->parseBoolean($raw['is_active'] ?? '', 'is_active', $messages, true);

        if ($name === null) {
            $messages[] = 'الاسم مطلوب.';
        }
        if (! in_array($type, ['good', 'service'], true)) {
            $messages[] = 'النوع يجب أن يكون good أو service.';
        }
        if ($mode === self::MODE_UPDATE && $sku === null) {
            $messages[] = 'SKU مطلوب في وضع تحديث المنتجات.';
        }
        if ($type === 'service' && $trackInventory) {
            $messages[] = 'الخدمة لا تتبع مخزوناً.';
        }

        $salePrice = $this->parseSar($raw['sale_price_sar'] ?? '', 'سعر البيع', $messages, true);
        $purchasePrice = $this->parseSar($raw['purchase_price_sar'] ?? '', 'سعر الشراء', $messages, false);
        $taxRate = $this->parseInteger($raw['tax_rate'] ?? '', 'نسبة الضريبة', $messages, 0, 100, 15);
        $reorderLevel = $this->parseInteger($raw['reorder_level'] ?? '', 'حد إعادة الطلب', $messages, 0, PHP_INT_MAX, null);

        foreach (['sku' => 255, 'name_en' => 255, 'unit' => 255, 'category' => 255, 'brand' => 255, 'barcode' => 255, 'name' => 255, 'description' => 2000] as $field => $max) {
            if (mb_strlen((string) ($raw[$field] ?? '')) > $max) {
                $messages[] = "الحقل {$field} يتجاوز الحد الأقصى ({$max}) حرفاً.";
            }
        }

        return [[
            'sku'             => $sku,
            'name'            => $name,
            'name_en'         => $this->nullableText($raw['name_en'] ?? null),
            'type'            => $type,
            'unit'            => $this->nullableText($raw['unit'] ?? null),
            'sale_price'      => $salePrice,
            'purchase_price'  => $purchasePrice,
            'tax_rate'        => $taxRate,
            'track_inventory' => $trackInventory,
            'reorder_level'   => $reorderLevel,
            'category'        => $this->nullableText($raw['category'] ?? null),
            'brand'           => $this->nullableText($raw['brand'] ?? null),
            'barcode'         => $this->nullableText($raw['barcode'] ?? null),
            'description'     => $this->nullableText($raw['description'] ?? null),
            'is_active'       => $isActive,
        ], $messages];
    }

    /** @param array<string, mixed> $data
     *  @return array<string, mixed>
     */
    private function createData(array $data): array
    {
        // العمود اختياري في القالب، لكن العمود المخزّن غير قابل لـ NULL ويملك
        // صفراً افتراضياً في البطاقة. تمرير null صراحةً يلغي الافتراضي ويكسر الإدراج.
        $data['purchase_price'] = $data['purchase_price'] ?? 0;

        return $data;
    }

    /** @param array<string, mixed> $data
     *  @return array<string, mixed>
     */
    private function updateData(array $data): array
    {
        $update = [
            'name'          => $data['name'],
            'name_en'       => $data['name_en'],
            'unit'          => $data['unit'],
            'sale_price'    => $data['sale_price'],
            'tax_rate'      => $data['tax_rate'],
            'reorder_level' => $data['reorder_level'],
            'category'      => $data['category'],
            'brand'         => $data['brand'],
            'barcode'       => $data['barcode'],
            'description'   => $data['description'],
            'is_active'     => $data['is_active'],
        ];

        // الفراغ في ملف التحديث يعني «لا تغيّر سعر الشراء»؛ لا يعني تصفيره ولا
        // إرسال NULL إلى عمودٍ غير قابل له. للتصفير تُستعمل قيمة 0 صراحةً.
        if ($data['purchase_price'] !== null) {
            $update['purchase_price'] = $data['purchase_price'];
        }

        return $update;
    }

    /** @param array<int, string> $headers */
    private function assertHeaders(array $headers): void
    {
        $missing = array_values(array_diff(self::HEADERS, $headers));
        if ($missing !== []) {
            throw new RuntimeException('القالب لا يحتوي الأعمدة المطلوبة: '.implode('، ', $missing));
        }
    }

    /** @param array<int, mixed> $values */
    private function isBlankRow(array $values): bool
    {
        return array_filter($values, static fn ($value): bool => trim((string) $value) !== '') === [];
    }

    /** @param array<int, string> $messages */
    private function parseBoolean(string $value, string $label, array &$messages, bool $default): bool
    {
        $value = strtolower(trim($value));
        if ($value === '') {
            return $default;
        }
        if (in_array($value, ['1', 'true', 'yes', 'نعم'], true)) {
            return true;
        }
        if (in_array($value, ['0', 'false', 'no', 'لا'], true)) {
            return false;
        }

        $messages[] = "{$label} يقبل 1 أو 0 أو true أو false.";

        return $default;
    }

    /** @param array<int, string> $messages */
    private function parseSar(string $value, string $label, array &$messages, bool $required): ?int
    {
        $value = trim($value);
        if ($value === '') {
            if ($required) {
                $messages[] = "{$label} مطلوب.";
            }

            return $required ? 0 : null;
        }
        if (! preg_match('/^\d+(?:\.\d{1,2})?$/', $value)) {
            $messages[] = "{$label} يجب أن يكون رقماً غير سالب بصيغة 123.45.";

            return 0;
        }

        [$whole, $fraction] = array_pad(explode('.', $value, 2), 2, '');
        $fraction = str_pad($fraction, 2, '0');

        return ((int) $whole * 100) + (int) $fraction;
    }

    /** @param array<int, string> $messages */
    private function parseInteger(string $value, string $label, array &$messages, int $min, int $max, ?int $default): ?int
    {
        $value = trim($value);
        if ($value === '') {
            return $default;
        }
        if (! preg_match('/^\d+$/', $value) || (int) $value < $min || (int) $value > $max) {
            $messages[] = "{$label} يجب أن يكون عدداً صحيحاً بين {$min} و{$max}.";

            return $default;
        }

        return (int) $value;
    }

    private function nullableText(?string $value): ?string
    {
        $value = trim((string) $value);

        return $value === '' ? null : $value;
    }

    private function assertMode(string $mode): void
    {
        if (! in_array($mode, [self::MODE_CREATE, self::MODE_UPDATE], true)) {
            throw new RuntimeException('وضع الاستيراد غير صالح.');
        }
    }

    private function hasLiveSkuConflict(string $sku): bool
    {
        return $sku !== '' && Product::query()->where('sku', $sku)->exists();
    }

    private function assertNoLiveSkuConflict(string $sku): void
    {
        if ($this->hasLiveSkuConflict($sku)) {
            throw new RuntimeException('رمز SKU مستخدم بالفعل في نطاق الكتالوج الحالي.');
        }
    }

    private function hasLiveBarcodeConflict(string $barcode, ?string $exceptProductId = null): bool
    {
        if ($barcode === '') {
            return false;
        }

        return Product::withoutGlobalScope(BranchScope::class)
            ->where('barcode', $barcode)
            ->when($exceptProductId, fn ($query) => $query->where('id', '!=', $exceptProductId))
            ->exists();
    }

    private function assertNoLiveBarcodeConflict(string $barcode, ?string $exceptProductId = null): void
    {
        if ($this->hasLiveBarcodeConflict($barcode, $exceptProductId)) {
            throw new RuntimeException('الباركود مستخدم بالفعل لمنتج آخر في المؤسسة.');
        }
    }
}
