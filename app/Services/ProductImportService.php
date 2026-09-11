<?php

namespace App\Services;

use App\Models\BarcodeRegistryEntry;
use App\Models\Brand;
use App\Models\Product;
use App\Models\ProductCategory;
use App\Models\UnitTemplate;
use App\Support\ProductImportFields;
use App\Support\SensitiveCostPolicy;
use App\Support\Settings;
use App\Support\SpreadsheetReader;
use App\Support\SpreadsheetWriter;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  استيراد المنتجات V2 — CSV/XLSX · إنشاء/تحديث/دمج · مطابقة أعمدة
 * ═══════════════════════════════════════════════════════════════
 *  ثلاث مراحل صريحة: `inspect` يقرأ أعمدة الملف ويقترح مطابقتها، `preview`
 *  يحقق كل صف بلا كتابة، و`apply` يعيد التحليل والتحقق كاملاً ثم يكتب في
 *  معاملة واحدة. المعاينة **ليست تفويضاً**: ملفٌ تغيّر أو كتالوجٌ تغيّر بين
 *  المعاينة والتطبيق يُكشف عند التطبيق لا بعده.
 *
 *  ═══ ما لا يفعله هذا المسار أبداً ═══
 *  لا يستورد كمية ولا متوسط تكلفة ولا حركة مخزون ولا رصيداً افتتاحياً، ولا
 *  يولّد أي قيد محاسبي. تلك حقائق مشتقّة من المستندات والحركات، وقبولها من
 *  ملف كتالوج كان سيجعل جدول Excel مصدرَ حقيقةٍ للدفاتر.
 *  ولا يغيّر نوع منتج قائم ولا تتبّع مخزونه: كلاهما يعيد تفسير سجلّ تاريخي.
 */
class ProductImportService
{
    public const MODE_CREATE = 'create';
    public const MODE_UPDATE = 'update';
    public const MODE_UPSERT = 'upsert';

    /** الخانة الفارغة لا تغيّر القيمة القائمة (الافتراضي الآمن). */
    public const BLANK_IGNORE = 'ignore';

    /** الخانة الفارغة تمسح الحقل — للحقول القابلة للمسح وحدها. */
    public const BLANK_CLEAR = 'clear';

    /** التصنيف/العلامة/القالب غير الموجود يوقف الصف بخطأ واضح. */
    public const MASTER_DATA_ERROR = 'match_or_error';

    /**
     * غير الموجود يُكتب في العمود النصّي القديم مع تحذير — سلوك V1 حرفياً،
     * وهو الافتراضي في الـ API كي لا ينكسر ملفٌ يعمل اليوم لدى مستأجر قائم.
     */
    public const MASTER_DATA_TEXT = 'match_or_text';

    /** ينشئ التصنيف/العلامة الناقص. اختيار صريح لا افتراض. */
    public const MASTER_DATA_CREATE = 'create_missing';

    /**
     * ترويسات V1 الثابتة. تبقى منشورةً لأن ملفات المستأجرين مبنيّة عليها،
     * والمطابقة التلقائية تتعرّف عليها كاملةً.
     */
    public const HEADERS = [
        'sku', 'name', 'name_en', 'type', 'unit', 'sale_price_sar',
        'purchase_price_sar', 'tax_rate', 'track_inventory', 'reorder_level',
        'category', 'brand', 'barcode', 'description', 'is_active',
    ];

    /**
     * حجم عملي لمعالجة طلب واحد.
     *
     * **لماذا لا يُرفع إلى عشرات الآلاف؟** لأن الإنتاج يعمل بـ`QUEUE_CONNECTION=sync`
     * (انظر `Dockerfile`)، فلا عامل خلفية حقيقياً ينفّذ مهمة طويلة. رفع الحد
     * كان سيعد المستخدم بمعالجة لا يملكها النظام، وينتهي بمهلة طلب مقطوعة
     * بعد كتابةٍ جزئية أو بلا كتابة. العقد هنا مصمَّم ليُنقل إلى مهمة خلفية
     * لاحقاً بلا إعادة كتابة: `parse` نقيّة، و`apply` معاملة واحدة.
     */
    public const MAX_ROWS = 2000;

    /**
     * PR-DUR-HARDEN-1 — سقف مستقلّ لمحرّك الاستيراد الدائم (`ImportJobService`)
     * وحده، لا لـ`inspect()`/`preview()`/`apply()` المتزامنة تماماً كما كانت.
     *
     * **لماذا سقفٌ أعلى هنا تحديداً؟** الترحيل الدائم مجزَّأ فعلياً: كل استدعاء
     * `apply()` عبر التشغيلة يكتب نافذة `APPLY_BATCH_SIZE` صفٍّ فقط (١٠٠،
     * ثابتة بصرف النظر عن حجم الملف)، فتكلفة الكتابة الفعلية لكل طلب لا تكبر
     * مع حجم الملف إطلاقاً. القياس الفعلي (سكربت قياسٍ محليّ، لا افتراض):
     * قراءة ملفّ CSV واقعيّ الأعمدة بحجم ٥ م.ب (~١٨٨٠٠ صفّ) تتمّ خلال ~٣٠٠ms
     * وتستهلك ~٢٤ م.ب ذاكرة لكل قراءة — وحتى أسوأ حالة (أعمدة نحيلة، ٥ م.ب
     * تسع ~٢٨٢ ألف صفّ) تُقرأ خلال ~١.٣ ثانية وتستهلك ~٩٨ م.ب، لكلٍّ من
     * `inspect()` الدائم و`apply()` الدائم يعيدان قراءة الملف كاملاً في كل
     * قطعة (انظر `ImportJobService::applyNextChunk()`). السقف هنا (٢٠٠٠٠)
     * يحدّ عدد القطع الكلي بـ٢٠٠ (٢٠٠٠٠/١٠٠) فتبقى كلفة إعادة القراءة
     * التراكمية على كامل الاستيراد محدودةً (~٤٤ ثانية قياساً في أسوأ حالة
     * مقيسة عند هذا الحجم) بدل نموّها بلا حد، مع بقاء كل طلبٍ فرديٍّ آمناً
     * زمنياً وذاكرياً بهامشٍ واسع.
     *
     * **`preview()` ترتفع إلى هذا السقف أيضاً — لكن بشرط.** قبل هذا الـPR
     * كانت `matchExisting`/`assertLiveConflicts` تستعلمان القاعدة مرّتين لكل
     * صفّ؛ عند آلاف الصفوف يعني ذلك آلاف الاستعلامات في طلب معاينة واحد —
     * هذا وحده، لا قراءة الملف، كان يفرض سقفاً منخفضاً حقاً على `preview()`.
     * `prefetchProductMatches()` جمّعت هذا التحقّق في ٢-٣ استعلامات لكل نافذة
     * تحليل (قياسٌ فعلي: تحديث ٥٠٠٠ صفّ ضد ٥٠٠٠ منتج قائم = ١٣ استعلاماً لا
     * ~١٠٠٠٠؛ معاينة إنشاء ٢٠٠٠٠ صفّ كاملةً = ٧٥٠ms و٨٤ م.ب فقط) — فارتفع
     * سقفها الآمن الفعلي معها، ويطلبه المستدعي صراحةً بعلَم `for_durable`
     * تماماً كـ`inspect()`.
     *
     * **لماذا ليس أعلى من ٢٠٠٠٠ في هذا الـPR إذن؟** لأن `inspect()`/`apply()`
     * الدائمين ما زالا يعيدان قراءة الملف كاملاً من القرص في كل قطعة (انظر
     * `ImportJobService::applyNextChunk()`) — رفعٌ أعلى يحتاج أولاً تجزئة
     * قراءة الملف نفسها (بدل إعادة قراءته كاملاً في كل قطعة)، إعادة تصميمٍ
     * حقيقية للقارئ خارج نطاق هذا الـPR الضيّق عمداً (راجع
     * `PR-DUR-HARDEN-1-IMPLEMENTATION-REPORT.md`).
     */
    public const DURABLE_MAX_ROWS = 20000;

    /** أقصى عدد صفوف في طلب تطبيق واحد كي يبقى الطلب تحت مهلة منصة التشغيل. */
    public const APPLY_BATCH_SIZE = 100;

    /** حدّ أعمدة الملف — يصدّ ورقة عريضة بلا معنى قبل تحليلها. */
    public const MAX_COLUMNS = 200;

    /** سقف صفوف التفاصيل المعادة للواجهة؛ العدادات تبقى على كامل الملف. */
    private const PREVIEW_ROW_LIMIT = 200;

    /** أول صفوف الملف المعروضة في شاشة مطابقة الأعمدة. */
    private const SAMPLE_ROW_LIMIT = 5;

    /**
     * أعمدة الملف وعيّنة منه واقتراح المطابقة — بلا أي تحقق أو كتابة.
     *
     * `$maxRows`: `MAX_ROWS` افتراضياً (توافقٌ خلفي حرفي لكل مستدعٍ لا يعرف
     * غيره)؛ `ImportJobService` يمرّر `DURABLE_MAX_ROWS` صراحةً عند فحص تشغيلة
     * دائمة، و`ProductController::importInspect` يمرّره أيضاً حين يطلب طلبٌ
     * صريحاً `for_durable` (الملف سيُطبَّق عبر تشغيلة دائمة، لا مساراً متزامناً).
     *
     * @return array{columns: array<int, array{index: int, header: string, samples: array<int, string>, suggested_field: string|null}>, total_rows: int, fields: array<int, array<string, mixed>>}
     */
    public function inspect(UploadedFile $file, int $maxRows = self::MAX_ROWS): array
    {
        $rows = $this->readFile($file, $maxRows);
        $headers = array_map(static fn ($value): string => trim((string) $value), array_shift($rows) ?? []);
        if ($headers === [] || implode('', $headers) === '') {
            throw new RuntimeException('صف العناوين في الملف فارغ. ضع أسماء الأعمدة في الصف الأول.');
        }

        $mapping = ProductImportFields::autoMap($headers);
        $sample = array_slice($rows, 0, self::SAMPLE_ROW_LIMIT);

        $columns = [];
        foreach ($headers as $index => $header) {
            $columns[] = [
                'index' => $index,
                'header' => $header,
                'samples' => array_values(array_map(
                    static fn (array $row): string => (string) ($row[$index] ?? ''),
                    $sample
                )),
                'suggested_field' => $mapping[$index] ?? null,
            ];
        }

        return [
            'columns' => $columns,
            // دقيقٌ لا تقديري: الملف الذي يتجاوز الحد يُرفض قبل الوصول إلى هنا.
            'total_rows' => count(array_filter($rows, fn (array $row): bool => ! self::isBlankRow($row))),
            'fields' => $this->fieldContract(),
        ];
    }

    /** عقد الحقول للواجهة: المفتاح والتسميتان والإلزامية وقابلية المسح. */
    public function fieldContract(): array
    {
        $fields = [];
        foreach (ProductImportFields::all() as $key => $field) {
            $fields[] = [
                'key' => $key,
                'label_ar' => $field['label_ar'],
                'label_en' => $field['label_en'],
                'type' => $field['type'],
                'required' => (bool) $field['required'],
                'clearable' => (bool) $field['clearable'],
                'update_locked' => (bool) $field['update_locked'],
                'writable' => (bool) $field['writable'],
            ];
        }

        return $fields;
    }

    /** قالب CSV يحمل ترويسات الاستيراد القانونية وسطرَي مثال. */
    public function template(): string
    {
        return SpreadsheetWriter::csv(ProductImportFields::templateHeaders(), [
            $this->templateRow([
                'sku' => 'SKU-1001', 'name' => 'قهوة عربية', 'name_en' => 'Arabic Coffee',
                'type' => 'good', 'unit' => 'قطعة', 'category' => 'مشروبات', 'brand' => 'نبراكس',
                'barcode' => '6281234567890', 'sale_price' => '35.00', 'purchase_price' => '20.00',
                'tax_rate' => '15', 'track_inventory' => '1', 'reorder_level' => '5',
                'description' => 'عبوة قهوة 250 جرام', 'is_active' => '1',
            ]),
            $this->templateRow([
                'sku' => 'SVC-2001', 'name' => 'صيانة دورية', 'name_en' => 'Periodic Maintenance',
                'type' => 'service', 'unit' => 'خدمة', 'category' => 'خدمات',
                'barcode' => '6281234567906', 'sale_price' => '150.00',
                'tax_rate' => '15', 'track_inventory' => '0',
                'description' => 'زيارة صيانة واحدة', 'is_active' => '1',
            ]),
        ]);
    }

    /** @param array<string, string> $values @return array<int, string> */
    private function templateRow(array $values): array
    {
        return array_map(
            static fn (string $key): string => $values[$key] ?? '',
            ProductImportFields::templateHeaders()
        );
    }

    /**
     * معاينة غير مغيّرة للبيانات.
     *
     * `$maxRows` — نفس معنى `apply()`: `MAX_ROWS` افتراضياً؛ `for_durable`
     * في `ImportProductsRequest` يرفعه إلى `DURABLE_MAX_ROWS` الآن بعد أن صار
     * تحقّق SKU/الباركود/معرّف نبراكس مجمَّعاً (`prefetchProductMatches()`،
     * PR-DUR-HARDEN-1) لا استعلامَين لكل صفّ كما كان قبله.
     *
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    public function preview(UploadedFile $file, array $options, bool $costAuthorized = true, int $maxRows = self::MAX_ROWS): array
    {
        $parsed = $this->parse($file, $this->options($options), $maxRows);
        // PR-INV-1: فشلٌ مبكر متّسق — لا يترك المستخدم يظن أن المعاينة تفويضٌ
        // للتطبيق حين تُرفض مطابقة سعر الشراء لاحقاً هناك حتماً.
        $this->assertCostMappingAuthorized($parsed['mapping'], $costAuthorized);

        $rows = array_slice($parsed['rows'], 0, self::PREVIEW_ROW_LIMIT);

        return [
            'mode' => $parsed['mode'],
            'blank_policy' => $parsed['blank_policy'],
            'master_data_policy' => $parsed['master_data_policy'],
            'mapping' => $parsed['mapping'],
            'total_rows' => $parsed['total_rows'],
            'create_rows' => $parsed['create_rows'],
            'update_rows' => $parsed['update_rows'],
            'skipped_rows' => $parsed['skipped_rows'],
            'warning_rows' => $parsed['warning_rows'],
            'error_rows' => $parsed['error_rows'],
            // مفتاحان تاريخيان يستهلكهما عميل V1 — يبقيان بدلالتهما نفسها.
            'valid_rows' => $parsed['total_rows'] - $parsed['error_rows'],
            'invalid_rows' => $parsed['error_rows'],
            'rows' => array_map(fn (array $row): array => $this->rowSummary($row), $rows),
            'rows_shown' => count($rows),
            'rows_truncated' => count($parsed['rows']) > count($rows),
            // الأخطاء كاملة لا مقتطعة: تقرير الأخطاء القابل للتنزيل يُبنى منها.
            'errors' => $parsed['errors'],
        ];
    }

    /**
     * يعيد التحليل والتحقق كاملاً قبل الكتابة، ثم يكتب في معاملة واحدة.
     *
     * `$maxRows`: `MAX_ROWS` افتراضياً للمسار المتزامن (توافقٌ خلفي حرفي —
     * طلبٌ بلا `batch_offset`/`batch_size` يكتب الملف كله في معاملةٍ واحدة،
     * فيبقى محكوماً بنفس السقف الذي وُجد لأجله أصلاً). `ImportJobService`
     * وحده يمرّر `DURABLE_MAX_ROWS` هنا، لأن ترحيله عبر قطعةٍ واحدة (١٠٠ صفّ
     * كحدٍّ أقصى) لا يكتب سوى نافذته، بصرف النظر عن حجم الملف الكلي.
     *
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    public function apply(UploadedFile $file, array $options, ?string $userId = null, bool $costAuthorized = true, int $maxRows = self::MAX_ROWS): array
    {
        $resolved = $this->options($options);
        $parsed = $this->parse($file, $resolved, $maxRows);
        // PR-INV-1: لا تُوثَق صلاحية جلسة معاينة قديمة — تُعاد قراءتها هنا حيّةً
        // على المطابقة الفعلية المطبَّقة قبل أي كتابة.
        $this->assertCostMappingAuthorized($parsed['mapping'], $costAuthorized);

        if ($parsed['error_rows'] > 0) {
            throw new RuntimeException('لا يمكن تطبيق الاستيراد قبل معالجة الأخطاء الظاهرة في المعاينة.');
        }
        if ($parsed['total_rows'] === 0) {
            throw new RuntimeException('لا يحتوي الملف صفوف بيانات قابلة للتطبيق.');
        }

        $lifecycle = app(ProductLifecycleService::class);

        return DB::transaction(function () use ($parsed, $resolved, $lifecycle, $userId): array {
            $created = 0;
            $updated = 0;
            $skipped = 0;
            $results = [];

            // البيانات الأساسية الناقصة تُنشأ هنا — **داخل** المعاملة وبعد أن
            // ثبت أن الملف كله بلا أخطاء. فشلُ أي صف بعدها يرجع بها معه.
            $references = $this->materializePendingReferences($parsed['pending_references']);

            foreach ($parsed['rows'] as $row) {
                /** @var array<string, mixed> $payload */
                $payload = $row['payload'];
                /** @var Product|null $existing */
                $existing = $row['existing'];

                if ($row['action'] === 'skip') {
                    $skipped++;
                    $results[] = $this->rowSummary($row);
                    continue;
                }

                $payload = $this->applyDeferredReferences($payload, $row['deferred'], $references, (int) $row['row']);

                if ($row['action'] === 'update') {
                    if (! $existing) {
                        throw new RuntimeException("تعذر العثور على المنتج المستهدف في الصف {$row['row']} أثناء التطبيق.");
                    }
                    // إعادة تحقق حيّة داخل المعاملة: ما تحقق وقت التحليل قد
                    // يكون تغيّر بطلب متزامن قبل أن تُغلق هذه المعاملة.
                    $this->assertNoLiveSkuConflict((string) ($payload['sku'] ?? ''), $existing->id);
                    $this->assertNoLiveBarcodeConflict((string) ($payload['barcode'] ?? ''), $existing->id);
                    $lifecycle->update($existing, $payload, $userId);
                    $updated++;
                    $results[] = $this->rowSummary($row);
                    continue;
                }

                $this->assertNoLiveSkuConflict((string) ($payload['sku'] ?? ''));
                $this->assertNoLiveBarcodeConflict((string) ($payload['barcode'] ?? ''));
                $product = Product::create($this->createPayload($payload));
                $lifecycle->create($product, $userId);
                $created++;
                $results[] = $this->rowSummary($row, $product);
            }

            return [
                'mode' => $resolved['mode'],
                'blank_policy' => $resolved['blank_policy'],
                'created' => $created,
                'updated' => $updated,
                'skipped' => $skipped,
                'total_rows' => $parsed['total_rows'],
                'batch_offset' => (int) ($resolved['batch_offset'] ?? 0),
                'batch_size' => $resolved['batch_size'],
                'results' => $results,
            ];
        });
    }

    /**
     * PR-INV-1: يرفض مطابقة عمودٍ لسعر الشراء بلا صلاحية `products.view_cost` —
     * قبل أي تحقق آخر أو كتابة. مصدر الحقيقة `SensitiveCostPolicy` وحده.
     *
     * `RuntimeException` لا `abort(403)` عمداً: `ApiController::domain()` يغلّف
     * `preview`/`apply` كاملاً ويحوّل كل رفضٍ في هذه الخدمة — بما فيها مطابقة
     * حقل مطلوب ناقصة — إلى 422 موحّد؛ `HttpException`ترث `RuntimeException`
     * فتُلتقط بالمصادفة هناك بجسم صحيح لكن رمزاً غير متّسق مع بقية أخطاء
     * الاستيراد. الاتّساق مع اصطلاح الاستيراد القائم أهمّ من تطابق حرفي مع 403
     * المستعمل في أسطح لا تمرّ عبر `domain()` (الفلترة/الفرز/الكتابة المباشرة).
     *
     * @param  array<int, string>  $mapping
     */
    private function assertCostMappingAuthorized(array $mapping, bool $costAuthorized): void
    {
        if (SensitiveCostPolicy::importMappingBlocked($mapping, $costAuthorized)) {
            throw new RuntimeException('ربط عمود بسعر الشراء يحتاج صلاحية عرض التكلفة.');
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  الخيارات
    // ═══════════════════════════════════════════════════════════════

    /**
     * @param  array<string, mixed>  $options
     * @return array{mode: string, blank_policy: string, master_data_policy: string, mapping: array<int, string>|null}
     */
    private function options(array $options): array
    {
        $mode = (string) ($options['mode'] ?? self::MODE_CREATE);
        if (! in_array($mode, [self::MODE_CREATE, self::MODE_UPDATE, self::MODE_UPSERT], true)) {
            throw new RuntimeException('وضع الاستيراد غير صالح.');
        }

        $blank = (string) ($options['blank_policy'] ?? self::BLANK_IGNORE);
        if (! in_array($blank, [self::BLANK_IGNORE, self::BLANK_CLEAR], true)) {
            throw new RuntimeException('سياسة القيم الفارغة غير صالحة.');
        }

        $masterData = (string) ($options['master_data_policy'] ?? self::MASTER_DATA_TEXT);
        if (! in_array($masterData, [self::MASTER_DATA_ERROR, self::MASTER_DATA_TEXT, self::MASTER_DATA_CREATE], true)) {
            throw new RuntimeException('سياسة البيانات الأساسية غير صالحة.');
        }

        $mapping = null;
        if (isset($options['mapping']) && is_array($options['mapping'])) {
            $mapping = [];
            $taken = [];
            foreach ($options['mapping'] as $index => $key) {
                if ($key === null || $key === '' || $key === 'ignore') {
                    continue;
                }
                if (! is_numeric($index) || (int) $index < 0) {
                    throw new RuntimeException('مطابقة الأعمدة تحمل فهرس عمود غير صالح.');
                }
                if (ProductImportFields::get((string) $key) === null) {
                    throw new RuntimeException("الحقل «{$key}» غير معروف في عقد استيراد المنتجات.");
                }
                if (isset($taken[$key])) {
                    throw new RuntimeException("لا يمكن ربط عمودين بالحقل نفسه «{$key}».");
                }
                $taken[(string) $key] = true;
                $mapping[(int) $index] = (string) $key;
            }
        }

        $batchOffset = array_key_exists('batch_offset', $options) ? max(0, (int) $options['batch_offset']) : 0;
        $batchSize = array_key_exists('batch_size', $options)
            ? min(self::APPLY_BATCH_SIZE, max(1, (int) $options['batch_size']))
            : null;

        return [
            'mode' => $mode,
            'blank_policy' => $blank,
            'master_data_policy' => $masterData,
            'mapping' => $mapping,
            'batch_offset' => $batchOffset,
            'batch_size' => $batchSize,
        ];
    }

    // ═══════════════════════════════════════════════════════════════
    //  التحليل والتحقق
    // ═══════════════════════════════════════════════════════════════

    /**
     * `$maxRows` — راجع توثيق `apply()`/`inspect()`/`preview()`: `MAX_ROWS`
     * افتراضياً لكل مسارٍ لا يعرف غيره؛ يرتفع إلى `DURABLE_MAX_ROWS` فقط حين
     * يمرّره المستدعي صراحةً (تشغيلة دائمة، أو طلبٌ صريح `for_durable`).
     *
     * @param  array{mode: string, blank_policy: string, master_data_policy: string, mapping: array<int, string>|null}  $options
     * @return array<string, mixed>
     */
    private function parse(UploadedFile $file, array $options, int $maxRows = self::MAX_ROWS): array
    {
        $raw = $this->readFile($file, $maxRows);
        $headers = array_map(static fn ($value): string => trim((string) $value), array_shift($raw) ?? []);
        if ($headers === [] || implode('', $headers) === '') {
            throw new RuntimeException('صف العناوين في الملف فارغ. ضع أسماء الأعمدة في الصف الأول.');
        }

        $mapping = $options['mapping'] ?? $this->autoMapping($headers);
        $this->assertMappingCoversContract($mapping, $options['mode']);

        $references = $this->referenceIndex();
        // أسماء المراجع الناقصة التي طلب الملفُ إنشاءها. تُجمع هنا ولا تُكتب:
        // الكتابة كلها داخل معاملة `apply` الناجحة وحدها (انظر §المراجع المؤجَّلة).
        $pending = ['category' => [], 'brand' => []];
        $rows = [];
        $errors = [];
        $seen = ['sku' => [], 'barcode' => [], 'nebrax_id' => []];
        $counters = ['create' => 0, 'update' => 0, 'skip' => 0, 'warning' => 0, 'error' => 0];
        $batchOffset = (int) ($options['batch_offset'] ?? 0);
        $batchSize = $options['batch_size'] ?? null;
        $dataIndex = 0;
        // PR-DUR-HARDEN-1 — استعلامان دفعةً واحدة بدل استعلامين لكل صفّ
        // (`matchExisting`/`assertLiveConflicts` أدناه)؛ راجع توثيق
        // `prefetchProductMatches()`.
        $matches = $this->prefetchProductMatches($raw, $mapping, $batchOffset, $batchSize);

        foreach ($raw as $offset => $values) {
            if (self::isBlankRow($values)) {
                continue;
            }

            $dataIndex++;
            if ($batchSize !== null && ($dataIndex <= $batchOffset || $dataIndex > $batchOffset + $batchSize)) {
                continue;
            }

            // رقم الصف كما يراه المستخدم في Excel: العناوين هي الصف ١.
            $rowNumber = $offset + 2;
            $cells = $this->cells($values, $mapping);

            $messages = [];
            $warnings = [];

            // صفٌ أعرض من صف العناوين يعني أن قيمةً ستسقط صامتةً — وهو أخطر من
            // خطأ صريح. أمّا الأضيق فخلاياه الأخيرة فارغة، وذلك شائع وغير ضار.
            if (count($values) > count($headers)) {
                $messages[] = 'عدد الأعمدة في هذا الصف يتجاوز صف العناوين، فبعض القيم ستسقط. صحّح الملف.';
            }

            $normalized = $this->normalize($cells, $mapping, $options, $references, $pending, $messages, $warnings);

            $this->assertUniqueWithinFile($cells, $rowNumber, $seen, $messages);
            $existing = $this->matchExisting($cells, $options['mode'], $matches, $messages);
            $action = $this->resolveAction($cells, $options['mode'], $existing, $messages);

            $payload = [];
            $deferred = [];
            if ($messages === []) {
                $payload = $action === 'create'
                    ? $this->buildCreatePayload($normalized, $messages, $deferred)
                    : $this->buildUpdatePayload($normalized, $existing, $options, $messages, $warnings, $deferred);
            }

            if ($messages === [] && $action === 'update' && $this->isNoOpUpdate($existing, $payload, $deferred)) {
                $action = 'skip';
            }

            if ($messages === []) {
                $this->assertLiveConflicts($payload, $action, $existing, $matches, $messages);
            }

            $status = $messages !== [] ? 'error' : ($warnings !== [] ? 'warning' : 'ok');
            if ($messages !== []) {
                $action = 'error';
                $errors[] = ['row' => $rowNumber, 'messages' => array_values(array_unique($messages))];
                $counters['error']++;
            } else {
                $counters[$action]++;
                if ($warnings !== []) {
                    $counters['warning']++;
                }
            }

            $rows[] = [
                'row' => $rowNumber,
                'action' => $action,
                'status' => $status,
                'valid' => $messages === [],
                'messages' => array_values(array_unique(array_merge($messages, $warnings))),
                'cells' => $cells,
                'payload' => $payload,
                'deferred' => $deferred,
                'existing' => $existing,
                'preview' => [
                    'sku' => $payload['sku'] ?? ($cells['sku'] ?? null) ?: ($existing?->sku),
                    'name' => $payload['name'] ?? ($cells['name'] ?? null) ?: ($existing?->name),
                    'type' => $payload['type'] ?? ($cells['type'] ?? null) ?: ($existing?->type),
                    'barcode' => $payload['barcode'] ?? ($cells['barcode'] ?? null) ?: ($existing?->barcode),
                ],
            ];
        }

        return [
            'mode' => $options['mode'],
            'blank_policy' => $options['blank_policy'],
            'master_data_policy' => $options['master_data_policy'],
            'mapping' => $mapping,
            'total_rows' => count($rows),
            'create_rows' => $counters['create'],
            'update_rows' => $counters['update'],
            'skipped_rows' => $counters['skip'],
            'warning_rows' => $counters['warning'],
            'error_rows' => $counters['error'],
            'rows' => $rows,
            'errors' => $errors,
            'pending_references' => $pending,
        ];
    }

    /**
     * @param  array<int, string>  $headers
     * @return array<int, string>
     */
    private function autoMapping(array $headers): array
    {
        $mapping = [];
        foreach (ProductImportFields::autoMap($headers) as $index => $key) {
            if ($key !== null) {
                $mapping[$index] = $key;
            }
        }

        if ($mapping === []) {
            throw new RuntimeException('تعذّر التعرف على أي عمود في الملف. طابق الأعمدة يدوياً أو نزّل القالب.');
        }

        return $mapping;
    }

    /** @param array<int, string> $mapping */
    private function assertMappingCoversContract(array $mapping, string $mode): void
    {
        $fields = array_values($mapping);

        if ($mode === self::MODE_CREATE || $mode === self::MODE_UPSERT) {
            $missing = [];
            foreach (ProductImportFields::all() as $key => $field) {
                if ($field['required'] && ! in_array($key, $fields, true)) {
                    $missing[] = $field['label_ar'];
                }
            }
            if ($missing !== []) {
                throw new RuntimeException('حقول مطلوبة لم تُطابق بأي عمود: '.implode('، ', $missing).'.');
            }
        }

        if ($mode === self::MODE_UPDATE || $mode === self::MODE_UPSERT) {
            if (! in_array('sku', $fields, true) && ! in_array('nebrax_id', $fields, true)) {
                throw new RuntimeException('التحديث يحتاج عمود معرّف: «معرّف نبراكس» أو «رمز الصنف (SKU)». الاسم لا يصلح معرّفاً.');
            }
        }
    }

    /**
     * @param  array<int, string>  $values
     * @param  array<int, string>  $mapping
     * @return array<string, string>
     */
    private function cells(array $values, array $mapping): array
    {
        $cells = [];
        foreach ($mapping as $index => $key) {
            $cells[$key] = trim((string) ($values[$index] ?? ''));
        }

        return $cells;
    }

    /**
     * @param  array<string, string>  $cells
     * @param  array<int, string>  $mapping
     * @param  array{mode: string, blank_policy: string, master_data_policy: string, mapping: array<int, string>|null}  $options
     * @param  array<string, array<string, mixed>>  $references
     * @param  array<string, array<string, string>>  $pending
     * @param  array<int, string>  $messages
     * @param  array<int, string>  $warnings
     * @return array<string, array{present: bool, blank: bool, value: mixed}>
     */
    private function normalize(array $cells, array $mapping, array $options, array $references, array &$pending, array &$messages, array &$warnings): array
    {
        $mapped = array_values($mapping);
        $normalized = [];

        foreach (ProductImportFields::all() as $key => $field) {
            if (! $field['writable']) {
                continue;
            }
            $present = in_array($key, $mapped, true);
            $raw = $cells[$key] ?? '';
            $blank = trim($raw) === '';

            if (! $present || $blank) {
                $normalized[$key] = ['present' => $present, 'blank' => true, 'value' => null];
                continue;
            }

            $normalized[$key] = [
                'present' => true,
                'blank' => false,
                'value' => $this->castValue($key, $field, $raw, $options, $references, $pending, $messages, $warnings),
            ];
        }

        return $normalized;
    }

    /**
     * @param  array<string, mixed>  $field
     * @param  array{mode: string, blank_policy: string, master_data_policy: string, mapping: array<int, string>|null}  $options
     * @param  array<string, array<string, mixed>>  $references
     * @param  array<string, array<string, string>>  $pending
     * @param  array<int, string>  $messages
     * @param  array<int, string>  $warnings
     */
    private function castValue(string $key, array $field, string $raw, array $options, array $references, array &$pending, array &$messages, array &$warnings): mixed
    {
        $label = $field['label_ar'];

        return match ($field['type']) {
            ProductImportFields::TYPE_MONEY => $this->parseMoney($raw, $label, $messages),
            ProductImportFields::TYPE_PERCENT,
            ProductImportFields::TYPE_INTEGER => $this->parseInteger($raw, $label, (int) ($field['min'] ?? 0), (int) ($field['max'] ?? PHP_INT_MAX), $messages),
            ProductImportFields::TYPE_BOOLEAN => $this->parseBoolean($raw, $label, (bool) ($field['default'] ?? false), $messages),
            ProductImportFields::TYPE_ENUM => $this->parseEnum($raw, $label, $field['values'], $messages),
            ProductImportFields::TYPE_REFERENCE => $this->resolveReference($key, $field, $raw, $options, $references, $pending, $messages, $warnings),
            default => $this->parseText($raw, $key, $label, (int) ($field['max'] ?? 255), $messages),
        };
    }

    // ═══════════════════════════════════════════════════════════════
    //  محوّلات القيم
    // ═══════════════════════════════════════════════════════════════

    /** @param array<int, string> $messages */
    private function parseText(string $value, string $key, string $label, int $max, array &$messages): ?string
    {
        $value = trim($value);
        if (mb_strlen($value) > $max) {
            $messages[] = "«{$label}» يتجاوز الحد الأقصى ({$max}) حرفاً.";

            return null;
        }

        return $value === '' ? null : $value;
    }

    /** @param array<int, string> $values @param array<int, string> $messages */
    private function parseEnum(string $value, string $label, array $values, array &$messages): ?string
    {
        $normalized = mb_strtolower(trim($value), 'UTF-8');
        $aliases = [
            'سلعة' => 'good', 'صنف' => 'good', 'منتج' => 'good', 'بضاعة' => 'good', 'product' => 'good', 'item' => 'good', 'goods' => 'good',
            'خدمة' => 'service', 'خدمه' => 'service', 'services' => 'service',
        ];
        $normalized = $aliases[$normalized] ?? $normalized;

        if (! in_array($normalized, $values, true)) {
            $messages[] = "«{$label}» يجب أن يكون ".implode(' أو ', $values).'.';

            return null;
        }

        return $normalized;
    }

    /** @param array<int, string> $messages */
    private function parseBoolean(string $value, string $label, bool $default, array &$messages): bool
    {
        $value = mb_strtolower(trim($this->latinDigits($value)), 'UTF-8');
        if ($value === '') {
            return $default;
        }
        if (in_array($value, ['1', 'true', 'yes', 'y', 'نعم', 'صح', 'نشط', 'مفعل', 'active'], true)) {
            return true;
        }
        if (in_array($value, ['0', 'false', 'no', 'n', 'لا', 'خطأ', 'غير نشط', 'معطل', 'inactive'], true)) {
            return false;
        }

        $messages[] = "«{$label}» يقبل 1 أو 0 أو true أو false أو نعم/لا.";

        return $default;
    }

    /**
     * ريال بشري → هللات صحيحة. بلا `float` في أي خطوة: الجزءان يُقرآن نصّاً
     * ثم يُضربان ويُجمعان كأعداد صحيحة.
     *
     * @param  array<int, string>  $messages
     */
    private function parseMoney(string $value, string $label, array &$messages): ?int
    {
        $normalized = $this->latinDigits($value);
        // فواصل الآلاف ومسافاتها تُزال؛ الفاصلة العشرية العربية تصير نقطة.
        $normalized = str_replace(['٫', '،'], ['.', ''], $normalized);
        $normalized = preg_replace('/[,\s\x{00A0}]/u', '', $normalized) ?? $normalized;

        if (! preg_match('/^\d+(?:\.\d{1,2})?$/', $normalized)) {
            $messages[] = "«{$label}» يجب أن يكون رقماً غير سالب بصيغة 123.45 وبمنزلتين عشريتين على الأكثر.";

            return null;
        }
        if (strlen(explode('.', $normalized)[0]) > 13) {
            $messages[] = "«{$label}» يتجاوز النطاق المالي الآمن.";

            return null;
        }

        [$whole, $fraction] = array_pad(explode('.', $normalized, 2), 2, '');

        return ((int) $whole * 100) + (int) str_pad($fraction, 2, '0');
    }

    /** @param array<int, string> $messages */
    private function parseInteger(string $value, string $label, int $min, int $max, array &$messages): ?int
    {
        $normalized = preg_replace('/[,\s\x{00A0}]/u', '', $this->latinDigits($value)) ?? '';
        // «15%» و«15.00» مقبولان بشرياً لنسبة صحيحة؛ الكسر غير الصفري يُرفض.
        $normalized = rtrim(trim($normalized), '%');
        if (preg_match('/^(\d+)\.0+$/', $normalized, $matches)) {
            $normalized = $matches[1];
        }

        if (! preg_match('/^\d+$/', $normalized)) {
            $messages[] = "«{$label}» يجب أن يكون عدداً صحيحاً بين {$min} و{$max}.";

            return null;
        }

        $number = (int) $normalized;
        if ($number < $min || $number > $max) {
            $messages[] = "«{$label}» يجب أن يكون عدداً صحيحاً بين {$min} و{$max}.";

            return null;
        }

        return $number;
    }

    private function latinDigits(string $value): string
    {
        return strtr($value, [
            '٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4',
            '٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9',
            '۰' => '0', '۱' => '1', '۲' => '2', '۳' => '3', '۴' => '4',
            '۵' => '5', '۶' => '6', '۷' => '7', '۸' => '8', '۹' => '9',
        ]);
    }

    // ═══════════════════════════════════════════════════════════════
    //  البيانات الأساسية (التصنيف · العلامة · قالب الوحدات)
    // ═══════════════════════════════════════════════════════════════

    /**
     * فهرس مراجع المستأجر مرّة واحدة لكل تشغيل — بدل استعلام لكل صف.
     *
     * @return array<string, array<string, mixed>>
     */
    private function referenceIndex(): array
    {
        $build = static function ($rows): array {
            $byId = [];
            $byName = [];
            foreach ($rows as $row) {
                $byId[$row->id] = $row;
                $key = self::referenceNeedle((string) $row->name);
                // أول تطابق يفوز، ويُوسم التكرار كي يُرفض التطابق الغامض.
                $byName[$key] = isset($byName[$key]) ? false : $row;
            }

            return ['by_id' => $byId, 'by_name' => $byName];
        };

        return [
            'category' => $build(ProductCategory::query()->get(['id', 'name', 'is_active'])),
            'brand' => $build(Brand::query()->get(['id', 'name', 'is_active'])),
            'unit_template' => $build(UnitTemplate::query()->get(['id', 'name', 'base_unit', 'is_active'])),
        ];
    }

    /**
     * @param  array<string, mixed>  $field
     * @param  array{mode: string, blank_policy: string, master_data_policy: string, mapping: array<int, string>|null}  $options
     * @param  array<string, array<string, mixed>>  $references
     * @param  array<string, array<string, string>>  $pending
     * @param  array<int, string>  $messages
     * @param  array<int, string>  $warnings
     * @return array{id: string|null, name: string, model: mixed, pending: string|null}|null
     */
    private function resolveReference(string $key, array $field, string $raw, array $options, array $references, array &$pending, array &$messages, array &$warnings): ?array
    {
        $label = $field['label_ar'];
        $reference = (string) $field['reference'];
        $index = $references[$reference];
        $value = trim($raw);

        if (isset($index['by_id'][$value])) {
            return ['id' => $value, 'name' => (string) $index['by_id'][$value]->name, 'model' => $index['by_id'][$value], 'pending' => null];
        }

        $needle = self::referenceNeedle($value);
        $match = $index['by_name'][$needle] ?? null;

        if ($match === false) {
            $messages[] = "«{$label}» يطابق أكثر من سجل بالاسم «{$value}». استخدم المعرّف بدل الاسم.";

            return null;
        }
        if ($match !== null) {
            return ['id' => (string) $match->id, 'name' => (string) $match->name, 'model' => $match, 'pending' => null];
        }

        return match ($options['master_data_policy']) {
            self::MASTER_DATA_ERROR => $this->referenceMissing($label, $value, $messages),
            self::MASTER_DATA_CREATE => $this->deferReference($reference, $value, $label, $pending, $messages, $warnings),
            // سلوك V1: النص الحر يُحفظ في العمود القديم مع تنبيه ظاهر.
            default => $this->referenceAsText($key, $label, $value, $warnings),
        };
    }

    /**
     * مفتاح المطابقة بالاسم — واحدٌ للفهرس ولسجلّ التأجيل ولحلّه داخل المعاملة.
     * اختلافُه بين الثلاثة كان سيُنشئ اسماً موجوداً أو يفشل في ربط ما أُنشئ.
     */
    private static function referenceNeedle(string $name): string
    {
        return mb_strtolower(trim($name), 'UTF-8');
    }

    /** @param array<int, string> $messages */
    private function referenceMissing(string $label, string $value, array &$messages): null
    {
        $messages[] = "«{$label}» بالقيمة «{$value}» غير موجود في بيانات المؤسسة. أنشئه أولاً أو غيّر سياسة البيانات الأساسية.";

        return null;
    }

    /** @param array<int, string> $warnings @return array{id: null, name: string, model: null, pending: null}|null */
    private function referenceAsText(string $key, string $label, string $value, array &$warnings): ?array
    {
        if ($key === 'unit_template') {
            // قالب الوحدات ليس نصّاً حرّاً: معامله يضرب الكمية الداخلة للمخزون،
            // فقيمة بلا سجلّ لا معنى لها ولا مكان لها.
            $warnings[] = "«{$label}» بالقيمة «{$value}» غير موجود، وسيبقى المنتج بلا قالب وحدات.";

            return null;
        }

        $warnings[] = "«{$label}» بالقيمة «{$value}» غير مُدار في بيانات المؤسسة، وسيُحفظ نصّاً حرّاً فقط.";

        return ['id' => null, 'name' => $value, 'model' => null, 'pending' => null];
    }

    /**
     * **لا يكتب شيئاً.** يسجّل الاسم الناقص فحسب، ويُنشأ فعلياً داخل معاملة
     * `apply` الناجحة وحدها.
     *
     * المعاينة عقدها أنها لا تغيّر البيانات: إنشاء التصنيف وقتها كان يترك
     * أثراً دائماً لملفٍ قد لا يُطبَّق أصلاً — يكفي أن يجرّب المستخدم سياسةً
     * ثم يعدل عنها. وحتى داخل `apply` كان الإنشاء يقع **قبل** المعاملة، فرجوعُ
     * المعاملة لا يمسحه: تُخلَّف تصنيفاتٌ يتيمة لاستيرادٍ لم يحدث.
     *
     * والتسجيل بمفتاح الاسم المُوحَّد يمنع تكرار الإنشاء للاسم نفسه داخل الملف:
     * ألفُ صفٍّ يذكر «قهوة» ينتج عنها تصنيفٌ واحد لا ألف.
     *
     * @param  array<string, array<string, string>>  $pending
     * @param  array<int, string>  $messages
     * @param  array<int, string>  $warnings
     * @return array{id: null, name: string, model: null, pending: string}|null
     */
    private function deferReference(string $reference, string $value, string $label, array &$pending, array &$messages, array &$warnings): ?array
    {
        if ($reference === 'unit_template') {
            $messages[] = "«{$label}» لا يُنشأ تلقائياً: قالب الوحدات يحتاج وحدة أساس ومعاملات تحويل صريحة. أنشئه من إعدادات المنتجات أولاً.";

            return null;
        }

        // المعاينة تقول ما ستفعله بدل أن تفعله: هذا التنبيه هو ما حلّ محلّ
        // الإنشاء الفوري الذي كان يقع وقت المعاينة.
        $warnings[] = "«{$label}» بالقيمة «{$value}» غير موجود، وسيُنشأ عند تنفيذ الاستيراد.";

        $pending[$reference][self::referenceNeedle($value)] ??= $value;

        return ['id' => null, 'name' => $value, 'model' => null, 'pending' => $reference];
    }

    /**
     * ينشئ المراجع الناقصة **داخل معاملة التطبيق** ويعيد خريطة الاسم ← المُعرّف.
     *
     * يعيد الفهرسة من القاعدة أولاً لأن طلباً متزامناً قد يكون أنشأ الاسم نفسه
     * بين التحليل والتطبيق؛ إنشاؤه ثانيةً يزرع تكراراً يجعل المطابقة بالاسم
     * غامضةً في كل استيراد لاحق.
     *
     * @param  array<string, array<string, string>>  $pending
     * @return array<string, array<string, string>>
     */
    private function materializePendingReferences(array $pending): array
    {
        $resolved = [];

        foreach ($pending as $reference => $names) {
            $resolved[$reference] = [];
            if ($names === []) {
                continue;
            }

            /** @var class-string<ProductCategory|Brand> $model */
            $model = $reference === 'category' ? ProductCategory::class : Brand::class;

            $live = [];
            foreach ($model::query()->get(['id', 'name']) as $row) {
                $live[self::referenceNeedle((string) $row->name)] = (string) $row->id;
            }

            foreach ($names as $needle => $name) {
                $resolved[$reference][$needle] = $live[$needle]
                    ?? (string) $model::create(['name' => $name])->id;
            }
        }

        return $resolved;
    }

    /**
     * يستبدل الإسناد المؤجَّل بالمُعرّف الحقيقي بعد إنشائه — ويفرّغ العمود
     * النصّي القديم كما يفعل المرجع المطابَق تماماً.
     *
     * @param  array<string, mixed>  $payload
     * @param  array<string, string>  $deferred
     * @param  array<string, array<string, string>>  $resolved
     * @return array<string, mixed>
     */
    private function applyDeferredReferences(array $payload, array $deferred, array $resolved, int $rowNumber): array
    {
        foreach ($deferred as $reference => $needle) {
            $id = $resolved[$reference][$needle] ?? null;
            if ($id === null) {
                throw new RuntimeException("تعذّر تجهيز البيانات الأساسية المطلوبة في الصف {$rowNumber} أثناء التطبيق.");
            }

            $payload["{$reference}_id"] = $id;
            $payload[$reference] = null;
        }

        return $payload;
    }

    // ═══════════════════════════════════════════════════════════════
    //  المطابقة والإجراء
    // ═══════════════════════════════════════════════════════════════

    /**
     * @param  array<string, string>  $cells
     * @param  array<string, array<string, int>>  $seen
     * @param  array<int, string>  $messages
     */
    private function assertUniqueWithinFile(array $cells, int $rowNumber, array &$seen, array &$messages): void
    {
        $labels = ['sku' => 'رمز SKU', 'barcode' => 'الباركود', 'nebrax_id' => 'معرّف نبراكس'];

        foreach ($labels as $key => $label) {
            $value = trim((string) ($cells[$key] ?? ''));
            if ($value === '') {
                continue;
            }
            $index = mb_strtolower($value, 'UTF-8');
            if (isset($seen[$key][$index])) {
                $messages[] = "{$label} مكرر داخل الملف (أول ظهور في الصف {$seen[$key][$index]}).";
                continue;
            }
            $seen[$key][$index] = $rowNumber;
        }
    }

    /**
     * أولوية المطابقة: معرّف نبراكس ثم رمز الصنف. **الاسم ليس معرّفاً أبداً.**
     *
     * المعرّف يُحلّ من فهرس `prefetchProductMatches()` المجلوب دفعةً واحدة قبل
     * الحلقة (لا استعلامٌ هنا نفسه) — والفهرس نفسه مبنيٌّ من `Product::query()`
     * فيخضع لنطاق المستأجر تلقائياً؛ معرّفٌ من مستأجر آخر لا يُحلّ فيتحوّل إلى
     * خطأ صف، ولا يتسرّب وجوده في رسالة.
     *
     * @param  array<string, string>  $cells
     * @param  array{by_sku: array<string, Product>, by_id: array<string, Product>, by_barcode: array<string, string>}  $matches
     * @param  array<int, string>  $messages
     */
    private function matchExisting(array $cells, string $mode, array $matches, array &$messages): ?Product
    {
        $nebraxId = trim((string) ($cells['nebrax_id'] ?? ''));
        $sku = trim((string) ($cells['sku'] ?? ''));

        if ($nebraxId !== '') {
            if (! preg_match('/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/', $nebraxId)) {
                $messages[] = 'معرّف نبراكس غير صالح. لا تعدّل هذا العمود يدوياً؛ احذفه لتتم المطابقة برمز الصنف.';

                return null;
            }

            $product = $matches['by_id'][$nebraxId] ?? null;
            if ($product === null && $mode !== self::MODE_CREATE) {
                $messages[] = 'معرّف نبراكس لا يطابق أي منتج في نطاقك. تحقق أن الملف مُصدَّر من المؤسسة نفسها.';
            }

            return $product;
        }

        if ($sku !== '' && $mode !== self::MODE_CREATE) {
            return $matches['by_sku'][$sku] ?? null;
        }

        return null;
    }

    /**
     * فهرس مطابقة/تعارض المنتجات مرّة واحدة لكل نافذة تحليل — بدل استعلامين
     * حيّين لكل صفّ (`matchExisting`/`assertLiveConflicts` أعلاه/أدناه) كما
     * كان الحال قبل PR-DUR-HARDEN-1. يجمع كل قيم SKU/معرّف نبراكس/الباركود
     * المرشَّحة ضمن النافذة الحالية فقط — نافذة القطعة عند الترحيل الدائم
     * المجزَّأ، أو الملف كله عند المعاينة أو التطبيق المتزامن — ثم يجلبها
     * بدفعاتٍ محدودة (`fetchInChunks()`) بدل استعلامٍ فرديّ متكرّر؛ نفس نمط
     * `referenceIndex()` القائم للتصنيف/العلامة/قالب الوحدات، معمَّماً هنا على
     * مطابقة/تعارض المنتج نفسه. هذا وحده ما يجعل تحقّق ملفٍ بآلاف الصفوف آمناً
     * في طلبٍ واحد بدل تحويله إلى آلاف الاستعلامات المتزامنة.
     *
     * **لا علاقة لهذا بالتحقّق الحيّ داخل معاملة `apply()` النهائية**
     * (`assertNoLiveSkuConflict`/`assertNoLiveBarcodeConflict`، غير مُمَسَّتين
     * هنا مطلقاً): ذاك تحقّقٌ متعمَّدٌ حيّ وقت الكتابة الفعلية بلا تخزين مؤقت،
     * يحمي من صفٍّ يتعارض مع طلبٍ متزامنٍ التزم بين لحظة هذا الفهرس ولحظة
     * الكتابة. هذا الفهرس يخدم مرحلة التحليل/المعاينة فقط — «حيٌّ» بمعنى أنه
     * يُقرأ من القاعدة الفعلية لا من ذاكرة، لا بمعنى إعادة قراءته لحظة الكتابة.
     *
     * @param  array<int, array<int, string>>  $raw  نفس ناتج `readFile()` (بلا صفّ العناوين).
     * @param  array<int, string>  $mapping
     * @return array{by_sku: array<string, Product>, by_id: array<string, Product>, by_barcode: array<string, string>}
     */
    private function prefetchProductMatches(array $raw, array $mapping, int $batchOffset, ?int $batchSize): array
    {
        $skus = [];
        $nebraxIds = [];
        $barcodes = [];
        $dataIndex = 0;

        foreach ($raw as $values) {
            if (self::isBlankRow($values)) {
                continue;
            }
            $dataIndex++;
            if ($batchSize !== null && ($dataIndex <= $batchOffset || $dataIndex > $batchOffset + $batchSize)) {
                continue;
            }

            $cells = $this->cells($values, $mapping);
            $sku = trim((string) ($cells['sku'] ?? ''));
            $nebraxId = trim((string) ($cells['nebrax_id'] ?? ''));
            $barcode = trim((string) ($cells['barcode'] ?? ''));

            if ($sku !== '') {
                $skus[$sku] = true;
            }
            if ($nebraxId !== '' && preg_match('/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/', $nebraxId)) {
                $nebraxIds[$nebraxId] = true;
            }
            if ($barcode !== '') {
                $barcodes[$barcode] = true;
            }
        }

        return [
            'by_sku' => $this->fetchInChunks(Product::query(), 'sku', array_keys($skus))->keyBy('sku')->all(),
            'by_id' => $this->fetchInChunks(Product::query(), 'id', array_keys($nebraxIds))->keyBy('id')->all(),
            'by_barcode' => $this->fetchInChunks(BarcodeRegistryEntry::query(), 'code', array_keys($barcodes))
                ->pluck('product_id', 'code')->all(),
        ];
    }

    /**
     * `whereIn()` واحد قد يحمل آلاف القيم؛ يُجزَّأ إلى دفعات معتدلة الحجم
     * لتفادي حدّ عدد مُعامِلات SQLite الافتراضي ولإبقاء كل استعلام صغيراً
     * وسريع التخطيط على أي محرّك.
     *
     * @param  array<int, string>  $values
     */
    private function fetchInChunks(Builder $query, string $column, array $values): Collection
    {
        if ($values === []) {
            return new Collection;
        }

        $results = new Collection;
        foreach (array_chunk($values, 500) as $chunk) {
            $results = $results->merge((clone $query)->whereIn($column, $chunk)->get());
        }

        return $results;
    }

    /**
     * @param  array<string, string>  $cells
     * @param  array<int, string>  $messages
     */
    private function resolveAction(array $cells, string $mode, ?Product $existing, array &$messages): string
    {
        $hasIdentifier = trim((string) ($cells['nebrax_id'] ?? '')) !== ''
            || trim((string) ($cells['sku'] ?? '')) !== '';

        if ($mode === self::MODE_CREATE) {
            if ($existing !== null) {
                $messages[] = 'الصف يشير إلى منتج قائم بالفعل. استخدم وضع التحديث أو الدمج بدل الإنشاء.';
            }

            return 'create';
        }

        if ($mode === self::MODE_UPDATE) {
            if (! $hasIdentifier) {
                $messages[] = 'التحديث يحتاج معرّف نبراكس أو رمز الصنف في هذا الصف.';
            } elseif ($existing === null && $messages === []) {
                $messages[] = 'لا يوجد منتج متاح في نطاق الكتالوج الحالي يطابق هذا المعرّف للتحديث.';
            }

            return 'update';
        }

        // الدمج: الموجود يُحدَّث، وغير الموجود يُنشأ.
        return $existing !== null ? 'update' : 'create';
    }

    // ═══════════════════════════════════════════════════════════════
    //  بناء الحمولات
    // ═══════════════════════════════════════════════════════════════

    /**
     * @param  array<string, array{present: bool, blank: bool, value: mixed}>  $normalized
     * @param  array<int, string>  $messages
     * @param  array<string, string>  $deferred
     * @return array<string, mixed>
     */
    private function buildCreatePayload(array $normalized, array &$messages, array &$deferred): array
    {
        $payload = [];

        foreach (ProductImportFields::all() as $key => $field) {
            if (! $field['writable']) {
                continue;
            }
            $cell = $normalized[$key];

            if ($cell['blank']) {
                if ($field['required']) {
                    $messages[] = "«{$field['label_ar']}» مطلوب لإنشاء منتج جديد.";
                }
                continue;
            }
            if ($cell['value'] === null) {
                continue; // القيمة رُفضت وسُجّلت رسالتها في التحقق.
            }

            $this->assignField($payload, $key, $field, $cell['value'], $deferred);
        }

        if (($payload['type'] ?? null) === 'service' && ($payload['track_inventory'] ?? false)) {
            $messages[] = 'الخدمة لا تتبع مخزوناً.';
        }
        $this->assertMinSalePrice($payload, null, $messages);

        return $payload;
    }

    /**
     * @param  array<string, array{present: bool, blank: bool, value: mixed}>  $normalized
     * @param  array{mode: string, blank_policy: string, master_data_policy: string, mapping: array<int, string>|null}  $options
     * @param  array<int, string>  $messages
     * @param  array<int, string>  $warnings
     * @param  array<string, string>  $deferred
     * @return array<string, mixed>
     */
    private function buildUpdatePayload(array $normalized, ?Product $existing, array $options, array &$messages, array &$warnings, array &$deferred): array
    {
        if ($existing === null) {
            return [];
        }

        $payload = [];

        foreach (ProductImportFields::all() as $key => $field) {
            if (! $field['writable']) {
                continue;
            }
            $cell = $normalized[$key];
            if (! $cell['present']) {
                continue;
            }

            if ($field['update_locked']) {
                $this->assertLockedFieldUnchanged($key, $field, $cell, $existing, $messages);
                continue;
            }

            if ($cell['blank']) {
                if ($options['blank_policy'] !== self::BLANK_CLEAR) {
                    continue;
                }
                if (! $field['clearable']) {
                    $warnings[] = "«{$field['label_ar']}» لا يقبل المسح؛ بقيت قيمته الحالية كما هي.";
                    continue;
                }
                $this->clearField($payload, $key);
                continue;
            }

            if ($cell['value'] === null) {
                continue;
            }

            $this->warnManagedReferenceDropped($key, $field, $cell['value'], $existing, $warnings);
            $this->assignField($payload, $key, $field, $cell['value'], $deferred);
        }

        // تغيير رمز الصنف مسموح فقط حين تمّت المطابقة بمعرّف نبراكس؛ ومع ذلك
        // يبقى الرمز الجديد خاضعاً لفحص التفرّد الحيّ أدناه.
        if (isset($payload['sku']) && (string) $payload['sku'] === (string) $existing->sku) {
            unset($payload['sku']);
        }

        $this->assertMinSalePrice($payload, $existing, $messages);

        return $payload;
    }

    /**
     * @param  array<string, mixed>  $payload
     * @param  array<string, mixed>  $field
     * @param  array<string, string>  $deferred
     */
    private function assignField(array &$payload, string $key, array $field, mixed $value, array &$deferred): void
    {
        if ($field['type'] === ProductImportFields::TYPE_REFERENCE) {
            /** @var array{id: string|null, name: string, model: mixed, pending: string|null} $value */
            match ($key) {
                'category' => $this->assignManagedReference($payload, 'category_id', 'category', $value, $deferred),
                'brand' => $this->assignManagedReference($payload, 'brand_id', 'brand', $value, $deferred),
                default => $this->assignUnitTemplate($payload, $value),
            };

            return;
        }

        $payload[$key] = $value;
    }

    /**
     * المُعرّف هو مصدر الحقيقة. حين يُحلّ المرجع، يُفرَّغ العمود النصّي القديم
     * كي لا يبقى اسمان لشيء واحد ينحرفان مع أول إعادة تسمية.
     *
     * @param  array<string, mixed>  $payload
     * @param  array{id: string|null, name: string, model: mixed, pending: string|null}  $value
     * @param  array<string, string>  $deferred
     */
    private function assignManagedReference(array &$payload, string $idColumn, string $textColumn, array $value, array &$deferred): void
    {
        if ($value['id'] !== null) {
            $payload[$idColumn] = $value['id'];
            $payload[$textColumn] = null;

            return;
        }

        if (($value['pending'] ?? null) !== null) {
            // المُعرّف لا يوجد بعد. لا يُكتب في الحمولة شيء الآن، ويُملأ من
            // خريطة الإنشاء داخل المعاملة (`applyDeferredReferences`).
            $deferred[$textColumn] = self::referenceNeedle($value['name']);

            return;
        }

        // النص الحر صار مصدر الحقيقة، فيُمسح المُعرّف المُدار معه. إبقاؤه كان
        // يجعل `ProductResource` والتصدير يعرضان الاسم المُدار القديم — أي
        // خلاف ما قال الاستيراد إنه حفظه، وهو ما يراه المستخدم لا الحمولة.
        $payload[$idColumn] = null;
        $payload[$textColumn] = $value['name'];
    }

    /**
     * اعتماد النص الحر على منتج له تصنيف/علامة مُدارة **يفكّ ارتباطاً قائماً**.
     * ذلك أثرٌ يستحق أن يُقال، لا أن يُمرَّر صامتاً تحت تنبيه «سيُحفظ نصّاً».
     *
     * @param  array<string, mixed>  $field
     * @param  array<int, string>  $warnings
     */
    private function warnManagedReferenceDropped(string $key, array $field, mixed $value, Product $existing, array &$warnings): void
    {
        if ($field['type'] !== ProductImportFields::TYPE_REFERENCE || ! in_array($key, ['category', 'brand'], true)) {
            return;
        }

        /** @var array{id: string|null, name: string, model: mixed, pending: string|null} $value */
        if ($value['id'] !== null || ($value['pending'] ?? null) !== null) {
            return;
        }
        if ($existing->{"{$key}_id"} === null) {
            return;
        }

        $current = $key === 'category' ? $existing->productCategory?->name : $existing->productBrand?->name;
        $warnings[] = "«{$field['label_ar']}» المُدار «{$current}» سيُفَكّ عن المنتج، لأن القيمة «{$value['name']}» ستُحفظ نصّاً حرّاً.";
    }

    /** @param array<string, mixed> $payload @param array{id: string|null, name: string, model: mixed} $value */
    private function assignUnitTemplate(array &$payload, array $value): void
    {
        if ($value['id'] === null) {
            return;
        }

        $payload['unit_template_id'] = $value['id'];
        // وحدة الأساس تُفرض من القالب — تماماً كما يفعل `ProductController`.
        $payload['unit'] = (string) $value['model']->base_unit;
    }

    /** @param array<string, mixed> $payload */
    private function clearField(array &$payload, string $key): void
    {
        // المرجع المُدار يُمسح من طرفيه: المُعرّف والعمود النصّي القديم معاً،
        // وإلا بقي الاسم القديم ظاهراً في المورد بعد «مسح» أفرغ المُعرّف وحده.
        if ($key === 'category' || $key === 'brand') {
            $payload["{$key}_id"] = null;
            $payload[$key] = null;

            return;
        }

        if ($key === 'unit_template') {
            $payload['unit_template_id'] = null;

            return;
        }

        $payload[$key] = null;
    }

    /**
     * @param  array{present: bool, blank: bool, value: mixed}  $cell
     * @param  array<string, mixed>  $field
     * @param  array<int, string>  $messages
     */
    private function assertLockedFieldUnchanged(string $key, array $field, array $cell, Product $existing, array &$messages): void
    {
        if ($cell['blank'] || $cell['value'] === null) {
            return;
        }

        $current = $key === 'track_inventory' ? (bool) $existing->track_inventory : $existing->{$key};
        if ($cell['value'] === $current) {
            return;
        }

        $messages[] = $key === 'type'
            ? 'لا يغير الاستيراد نوع المنتج الموجود؛ أنشئ منتجاً جديداً بدلاً من إعادة تصنيفه.'
            : 'لا يغير الاستيراد تتبع المخزون للمنتج الموجود؛ فهذا يؤثر في دورة الحركات والتكلفة.';
    }

    /**
     * حدّ السعر الأدنى استرشادي في البطاقة، لكن قبوله أعلى من سعر البيع في
     * ملف جملة يبني كتالوجاً يرفض بيع نفسه.
     *
     * @param  array<string, mixed>  $payload
     * @param  array<int, string>  $messages
     */
    private function assertMinSalePrice(array $payload, ?Product $existing, array &$messages): void
    {
        $min = array_key_exists('min_sale_price', $payload) ? $payload['min_sale_price'] : $existing?->min_sale_price;
        $sale = array_key_exists('sale_price', $payload) ? $payload['sale_price'] : $existing?->sale_price;

        if ($min !== null && $sale !== null && (int) $min > (int) $sale) {
            $messages[] = '«أقل سعر بيع» أعلى من «سعر البيع» في هذا الصف.';
        }
    }

    /**
     * الإنشاء يستكمل ما لم يرد في الملف: رمز الصنف من العدّاد المقفول نفسه
     * الذي تستعمله بطاقة المنتج، وسعر الشراء صفراً (العمود غير قابل لـ NULL).
     *
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    private function createPayload(array $payload): array
    {
        $payload['purchase_price'] = $payload['purchase_price'] ?? 0;

        if (blank($payload['sku'] ?? null)) {
            $prefix = (string) Settings::get('numbering', 'product_prefix');
            $payload['sku'] = Product::nextDocumentNumber($prefix !== '' ? $prefix : 'SKU');
        }

        return $payload;
    }

    /**
     * صفٌ يطابق منتجاً ولا يغيّر فيه شيئاً = تخطٍّ لا تحديث. الفرق مهم:
     * «حُدّث ٢٠٠٠ منتج» بينما لم يتغيّر أيٌّ منها تقريرٌ كاذب.
     *
     * @param  array<string, mixed>  $payload
     * @param  array<string, string>  $deferred
     */
    private function isNoOpUpdate(?Product $existing, array $payload, array $deferred): bool
    {
        if ($existing === null) {
            return false;
        }
        // إسنادٌ مؤجَّل يعني مرجعاً لا وجود له بعد، فلا يمكن أن يكون المنتج
        // مرتبطاً به أصلاً: الصف يغيّر شيئاً بالتأكيد. ولولا هذا الشرط لتحوّل
        // إلى «تخطٍّ» لأن الحمولة تبدو فارغة قبل ملء المُعرّف.
        if ($deferred !== []) {
            return false;
        }
        if ($payload === []) {
            return true;
        }

        $probe = clone $existing;
        $probe->fill($payload);

        return $probe->getDirty() === [];
    }

    // ═══════════════════════════════════════════════════════════════
    //  التفرّد الحيّ
    // ═══════════════════════════════════════════════════════════════

    /**
     * تحقّقٌ من فهرس `prefetchProductMatches()` المجلوب دفعةً واحدة قبل حلقة
     * `parse()` — لا استعلامٌ حيٌّ لكل صفّ هنا بعد PR-DUR-HARDEN-1؛ راجع
     * توثيق `prefetchProductMatches()` للفارق عن التحقّق الحيّ الحقيقي وقت
     * الكتابة (`assertNoLiveSkuConflict`/`assertNoLiveBarcodeConflict` أدناه،
     * غير مُمَسَّتين هنا، ولا يزالان يستعلمان حيّاً عمداً داخل معاملة `apply()`).
     *
     * @param  array<string, mixed>  $payload
     * @param  array{by_sku: array<string, Product>, by_id: array<string, Product>, by_barcode: array<string, string>}  $matches
     * @param  array<int, string>  $messages
     */
    private function assertLiveConflicts(array $payload, string $action, ?Product $existing, array $matches, array &$messages): void
    {
        // الاستثناء يُشتقّ من **المنتج المطابَق** لا من اسم الإجراء: صفٌّ لا
        // يغيّر شيئاً يتحوّل إلى «تخطٍّ» قبل هذا الفحص، فلو قرأنا الإجراء وحده
        // لصار المنتج يتعارض مع باركود نفسه ويُرفض ملفُ round-trip كما صُدِّر.
        // وفي وضع الإنشاء لا يصل الصف هنا أصلاً إن طابق منتجاً قائماً.
        $exceptId = $existing?->id;

        $sku = (string) ($payload['sku'] ?? '');
        if ($sku !== '' && $this->hasBatchedSkuConflict($sku, $matches, $exceptId)) {
            $messages[] = 'رمز SKU مستخدم بالفعل في نطاق الكتالوج الحالي.';
        }

        $barcode = (string) ($payload['barcode'] ?? '');
        if ($barcode !== '' && $this->hasBatchedBarcodeConflict($barcode, $matches, $exceptId)) {
            $messages[] = 'الباركود مستخدم بالفعل لمنتج آخر في المؤسسة.';
        }
    }

    /** @param array{by_sku: array<string, Product>, by_id: array<string, Product>, by_barcode: array<string, string>} $matches */
    private function hasBatchedSkuConflict(string $sku, array $matches, ?string $exceptProductId = null): bool
    {
        if ($sku === '') {
            return false;
        }
        $product = $matches['by_sku'][$sku] ?? null;

        return $product !== null && $product->id !== $exceptProductId;
    }

    /** @param array{by_sku: array<string, Product>, by_id: array<string, Product>, by_barcode: array<string, string>} $matches */
    private function hasBatchedBarcodeConflict(string $barcode, array $matches, ?string $exceptProductId = null): bool
    {
        if ($barcode === '') {
            return false;
        }
        $productId = $matches['by_barcode'][$barcode] ?? null;

        return $productId !== null && $productId !== $exceptProductId;
    }

    /**
     * تحقّقٌ حيٌّ حقيقي وقت الكتابة الفعلية داخل معاملة `apply()` — بلا فهرسٍ
     * مسبق ولا تخزين مؤقت عمداً: يحمي من صفٍّ يتعارض مع طلبٍ متزامنٍ التزم
     * بين لحظة `assertLiveConflicts()` (فهرسٌ مسبق) ولحظة هذه الكتابة.
     */
    private function hasLiveSkuConflict(string $sku, ?string $exceptProductId = null): bool
    {
        if ($sku === '') {
            return false;
        }

        return Product::query()
            ->where('sku', $sku)
            ->when($exceptProductId, fn ($query) => $query->where('id', '!=', $exceptProductId))
            ->exists();
    }

    private function assertNoLiveSkuConflict(string $sku, ?string $exceptProductId = null): void
    {
        if ($this->hasLiveSkuConflict($sku, $exceptProductId)) {
            throw new RuntimeException('رمز SKU مستخدم بالفعل في نطاق الكتالوج الحالي.');
        }
    }

    /**
     * الباركود يُمسح ضوئياً في كل الفروع، فتفرّده على مستوى المؤسسة لا الفرع.
     * الفحص عبر فضاء الباركود الموحّد (PR-UOM-1) — نفس المصدر الذي يستعمله
     * إنشاء/تعديل المنتج والباركود البديل، فلا يفوت الاستيراد باركوداً بديلاً
     * مستخدَماً بالفعل لمنتجٍ آخر (كان يفحص `Product.barcode` وحده سابقاً).
     */
    private function hasLiveBarcodeConflict(string $barcode, ?string $exceptProductId = null): bool
    {
        if ($barcode === '') {
            return false;
        }

        return BarcodeRegistryEntry::isTaken($barcode, $exceptProductId);
    }

    private function assertNoLiveBarcodeConflict(string $barcode, ?string $exceptProductId = null): void
    {
        if ($this->hasLiveBarcodeConflict($barcode, $exceptProductId)) {
            throw new RuntimeException('الباركود مستخدم بالفعل لمنتج آخر في المؤسسة.');
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  أدوات
    // ═══════════════════════════════════════════════════════════════

    /**
     * @param  array<string, mixed>  $row
     * @return array<string, mixed>
     */
    private function rowSummary(array $row, ?Product $product = null): array
    {
        return [
            'row' => $row['row'],
            'action' => $row['action'],
            'status' => $row['status'],
            'valid' => $row['valid'],
            'sku' => $product?->sku ?? $row['preview']['sku'],
            'name' => $row['preview']['name'],
            'type' => $row['preview']['type'],
            'barcode' => $row['preview']['barcode'],
            'messages' => $row['messages'],
        ];
    }

    /** @return array<int, array<int, string>> */
    private function readFile(UploadedFile $file, int $maxRows = self::MAX_ROWS): array
    {
        $extension = strtolower((string) ($file->getClientOriginalExtension() ?: $file->extension()));
        if (! SpreadsheetReader::isSupportedExtension($extension)) {
            throw new RuntimeException('صيغة الملف غير مدعومة. استخدم CSV أو XLSX.');
        }

        $path = $file->getRealPath();
        if ($path === false || ! is_readable($path)) {
            throw new RuntimeException('تعذر قراءة ملف الاستيراد.');
        }

        return SpreadsheetReader::read($path, $extension, $maxRows, self::MAX_COLUMNS);
    }

    /**
     * تعريف «الصف الفارغ» الوحيد في مسار استيراد المنتجات — يستعمله `inspect()`
     * و`parse()` هنا، و`ImportJobService` (PR-DUR-2) ليُطابق `row_count`/الاكتمال
     * الدائم نفس تعريف صفوف البيانات المستعمل في ترقيم `dataIndex` أدناه، بلا
     * نسخة ثانية من المنطق قد تنحرف عنه.
     *
     * @param  array<int, string>  $values
     */
    public static function isBlankRow(array $values): bool
    {
        foreach ($values as $value) {
            if (trim((string) $value) !== '') {
                return false;
            }
        }

        return true;
    }
}
