<?php

namespace App\Services;

use App\Models\Product;
use App\Support\Money;
use App\Support\ProductImportFields;
use App\Support\SpreadsheetWriter;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Response;
use RuntimeException;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * ═══════════════════════════════════════════════════════════════
 *  تصدير المنتجات V2 — من الخادم لا من صفوف الجدول المحمَّلة
 * ═══════════════════════════════════════════════════════════════
 *  صفحة المنتجات مقسَّمة خادمياً، فتصديرٌ يُبنى من `rows` المحمَّلة في المتصفح
 *  يصدّر **الصفحة الحالية** ويسمّيها «كل النتائج». هذا المسار يبني الاستعلام
 *  نفسه الذي تبنيه القائمة (`ProductController::listQuery`) ثم يتجاهل
 *  `page`/`per_page` وحدهما — فتتطابق دلالة «النتائج المفلترة» حرفياً.
 *
 *  ═══ قالبان ═══
 *  `catalog`     لقطة كتالوج للقراءة: تضيف الكمية ومتوسط التكلفة، وتُسقط
 *                المعرّف التقني والملاحظات الداخلية. **ليست ملف إعادة استيراد.**
 *  `round_trip`  ترويسات مطابقة تماماً لمفاتيح الاستيراد، يتصدّرها
 *                `nebrax_id`، فيُعدَّل في Excel ويُعاد استيراده تحديثاً بلا تكرار.
 */
class ProductExportService
{
    public const SCOPE_SELECTED = 'selected';
    public const SCOPE_FILTERED = 'filtered';
    public const SCOPE_ALL = 'all';

    public const FORMAT_CSV = 'csv';
    public const FORMAT_XLSX = 'xlsx';

    public const TEMPLATE_CATALOG = 'catalog';
    public const TEMPLATE_ROUND_TRIP = 'round_trip';

    /**
     * سقف صفوف التصدير في طلب متزامن.
     *
     * كـ`MAX_ROWS` في الاستيراد: لا عامل خلفية في الإنتاج، فالسقف صريح بدل
     * مهلة طلب مقطوعة على ملف نصف مكتوب. CSV يُبثّ على دفعات فلا تتراكم
     * الصفوف في الذاكرة؛ وXLSX يُبنى في ملف مؤقت ثم يُبثّ ويُحذف.
     */
    public const MAX_ROWS = 50000;

    /** حجم الدفعة في المرور بالمفتاح — يوازن بين عدد الاستعلامات والذاكرة. */
    private const CHUNK = 500;

    /** أقصى عدد معرّفات في تصدير «المحدد» — يحدّ طول الاستعلام. */
    public const MAX_SELECTED_IDS = 1000;

    /**
     * أعمدة القالب البشري: حقول الاستيراد القابلة للكتابة، بلا الملاحظات
     * الداخلية، مضافاً إليها قراءتان مخزنيتان لا تُستورَدان أبداً.
     *
     * @return array<int, string>
     */
    public function catalogHeaders(): array
    {
        $headers = array_values(array_diff(ProductImportFields::templateHeaders(), ['internal_notes']));

        return array_merge($headers, ['quantity_on_hand', 'avg_cost']);
    }

    /** @return array<int, string> */
    public function roundTripHeaders(): array
    {
        return ProductImportFields::roundTripHeaders();
    }

    /** @return array<int, string> */
    public function headers(string $template): array
    {
        return $template === self::TEMPLATE_ROUND_TRIP ? $this->roundTripHeaders() : $this->catalogHeaders();
    }

    /**
     * أنواع الأعمدة لـXLSX: المعرّفات نصّاً (تحفظ الأصفار البادئة والطول)،
     * والمبالغ والكميات أرقاماً (تُجمَع وتُفرَز في Excel كأرقام).
     *
     * @param  array<int, string>  $headers
     * @return array<int, string>
     */
    public function columnTypes(array $headers): array
    {
        $numeric = ['sale_price', 'purchase_price', 'min_sale_price', 'tax_rate', 'reorder_level', 'quantity_on_hand', 'avg_cost'];

        return array_map(
            static fn (string $header): string => in_array($header, $numeric, true)
                ? SpreadsheetWriter::TYPE_NUMBER
                : SpreadsheetWriter::TYPE_TEXT,
            $headers
        );
    }

    /**
     * يبني استجابة تنزيل من استعلام مُعدّ مسبقاً (مصفّى ومُرتَّب في المتحكّم).
     */
    public function download(Builder $query, string $template, string $format, string $filename): StreamedResponse|Response
    {
        $total = (clone $query)->toBase()->getCountForPagination();
        if ($total > self::MAX_ROWS) {
            throw new RuntimeException(
                'عدد المنتجات المطلوب تصديره ('.$total.') يتجاوز الحد الأقصى البالغ '.self::MAX_ROWS
                .' صفاً في طلب واحد. ضيّق الفلاتر ثم أعد التصدير.'
            );
        }

        $headers = $this->headers($template);

        return $format === self::FORMAT_XLSX
            ? $this->xlsxResponse($query, $template, $headers, $filename)
            : $this->csvResponse($query, $template, $headers, $filename);
    }

    /** @param array<int, string> $headers */
    private function csvResponse(Builder $query, string $template, array $headers, string $filename): StreamedResponse
    {
        return response()->streamDownload(function () use ($query, $template, $headers): void {
            SpreadsheetWriter::streamCsv($headers, $this->rows($query, $template));
        }, "{$filename}.csv", [
            'Content-Type' => 'text/csv; charset=UTF-8',
        ]);
    }

    /** @param array<int, string> $headers */
    private function xlsxResponse(Builder $query, string $template, array $headers, string $filename): Response
    {
        $path = tempnam(sys_get_temp_dir(), 'nebrax-products-');
        if ($path === false) {
            throw new RuntimeException('تعذر تجهيز ملف التصدير المؤقت.');
        }

        try {
            SpreadsheetWriter::xlsx($path, $headers, $this->rows($query, $template), $this->columnTypes($headers), 'Products');
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
     * مرور على دفعات يحترم ترتيب القائمة.
     *
     * لا `lazyById`: هي تفرض ترتيباً بالمفتاح فتُسقط صامتةً الفرزَ الذي طلبه
     * المستخدم في الشاشة. المتحكّم يضمن ترتيباً حتمياً (عمود الفرز ثم `id`)،
     * فالتقسيم بالإزاحة هنا مستقرّ.
     *
     * @return \Generator<int, array<int, string|null>>
     */
    private function rows(Builder $query, string $template): \Generator
    {
        $headers = $this->headers($template);
        $page = 1;

        do {
            $batch = (clone $query)
                ->with(['productCategory', 'productBrand', 'unitTemplate'])
                ->forPage($page, self::CHUNK)
                ->get();

            foreach ($batch as $product) {
                yield $this->row($product, $headers);
            }

            $page++;
        } while ($batch->count() === self::CHUNK);
    }

    /**
     * @param  array<int, string>  $headers
     * @return array<int, string|null>
     */
    private function row(Product $product, array $headers): array
    {
        $values = [
            'nebrax_id' => (string) $product->id,
            'sku' => $product->sku,
            'name' => $product->name,
            'name_en' => $product->name_en,
            'type' => $product->type,
            'unit' => $product->unit,
            'unit_template' => $product->unitTemplate?->name,
            // الاسم من العلاقة أولاً والنصّ القديم احتياطياً — كـ`ProductResource`
            // تماماً، فما يراه المستخدم في القائمة هو ما يجده في الملف.
            'category' => $product->productCategory?->name ?? $product->category,
            'brand' => $product->productBrand?->name ?? $product->brand,
            'barcode' => $product->barcode,
            'sale_price' => Money::toRiyal($product->sale_price),
            'purchase_price' => Money::toRiyal($product->purchase_price),
            'min_sale_price' => $product->min_sale_price !== null ? Money::toRiyal($product->min_sale_price) : null,
            'tax_rate' => (string) $product->tax_rate,
            'track_inventory' => $product->track_inventory ? '1' : '0',
            'reorder_level' => $product->reorder_level !== null ? (string) $product->reorder_level : null,
            'tags' => $product->tags,
            'description' => $product->description,
            'internal_notes' => $product->internal_notes,
            'is_active' => $product->is_active ? '1' : '0',
            // قراءتان مشتقّتان من الحركات — تُصدَّران للمراجعة ولا يقبلهما الاستيراد.
            'quantity_on_hand' => $product->track_inventory ? (string) $product->quantity_on_hand : null,
            'avg_cost' => $product->track_inventory ? Money::toRiyal($product->avg_cost) : null,
        ];

        return array_map(static fn (string $header): ?string => $values[$header] ?? null, $headers);
    }
}
