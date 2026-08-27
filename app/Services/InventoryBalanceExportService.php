<?php

namespace App\Services;

use App\Models\Product;
use App\Support\Money;
use App\Support\SpreadsheetWriter;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Response;
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
 *  المصدر منتجٌ عالميّ: `quantity_on_hand` و`avg_cost` حقلان على `products`،
 *  وقيمة المخزون مشتقّة منهما. لا بُعد مخزن ولا فرع — كما هو حال الشاشة.
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
    public function download(Builder $query, string $format, string $filename, string $locale, bool $includeZero): StreamedResponse|Response
    {
        if (! $includeZero) {
            $query->where('quantity_on_hand', '!=', 0);
        }

        $total = (clone $query)->toBase()->getCountForPagination();
        if ($total > self::MAX_ROWS) {
            throw new RuntimeException(
                'عدد الأصناف المطلوب تصديره ('.$total.') يتجاوز الحد الأقصى البالغ '.self::MAX_ROWS
                .' صفاً في طلب واحد. ضيّق الفلاتر ثم أعد التصدير.'
            );
        }

        $headers = $this->headers($locale);

        return $format === self::FORMAT_XLSX
            ? $this->xlsxResponse($query, $headers, $filename)
            : $this->csvResponse($query, $headers, $filename);
    }

    /** @param array<int, string> $headers */
    private function csvResponse(Builder $query, array $headers, string $filename): StreamedResponse
    {
        return response()->streamDownload(function () use ($query, $headers): void {
            SpreadsheetWriter::streamCsv($headers, $this->rows($query));
        }, "{$filename}.csv", [
            'Content-Type' => 'text/csv; charset=UTF-8',
        ]);
    }

    /** @param array<int, string> $headers */
    private function xlsxResponse(Builder $query, array $headers, string $filename): Response
    {
        $path = tempnam(sys_get_temp_dir(), 'nebrax-inventory-');
        if ($path === false) {
            throw new RuntimeException('تعذر تجهيز ملف التصدير المؤقت.');
        }

        try {
            SpreadsheetWriter::xlsx($path, $headers, $this->rows($query), $this->columnTypes(), 'Inventory');
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
     * مرور على دفعات يحترم ترتيب الشاشة. لا `lazyById` (تفرض ترتيباً بالمفتاح
     * فتُسقط الفرزَ المطلوب صامتةً)؛ المتحكّم يضمن ترتيباً حتمياً (عمود الفرز
     * ثم `id`) فالتقسيم بالإزاحة مستقرّ.
     *
     * @return \Generator<int, array<int, string|null>>
     */
    private function rows(Builder $query): \Generator
    {
        $page = 1;

        do {
            $batch = (clone $query)->forPage($page, self::CHUNK)->get();

            foreach ($batch as $product) {
                yield $this->row($product);
            }

            $page++;
        } while ($batch->count() === self::CHUNK);
    }

    /**
     * صفٌّ واحد. القيمة تُشتقّ هنا كما تُشتقّ في الشاشة والـAPI تماماً:
     * `quantity_on_hand × avg_cost` بالهللات ثم تُعرَض ريالاً — فما يجده
     * المستخدم في الملف هو ما يراه في الجدول.
     *
     * @return array<int, string|null>
     */
    private function row(Product $product): array
    {
        return [
            $product->sku,
            $product->barcode,
            $product->name,
            $product->unit,
            (string) $product->quantity_on_hand,
            Money::toRiyal($product->avg_cost),
            Money::toRiyal($product->quantity_on_hand * $product->avg_cost),
        ];
    }
}
