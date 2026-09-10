<?php

namespace App\Services;

use App\Models\ImportJob;
use App\Support\ImportJobDomain;
use App\Support\ImportJobStatus;
use App\Support\SpreadsheetReader;
use App\Tenancy\TenantContext;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

/**
 * PR-DUR-1 — بنية تشغيلة الاستيراد الدائم: رفع → تخزين → بصمة → فحص هيكلي
 * (inspect) → `ready`/`failed`، وإلغاء قبل أيّ معالجة. PR-DUR-2 أضاف
 * `applyNextChunk()` لمجال `product_catalog` (يستهلك `ProductImportService`
 * حصراً)، وPR-DUR-3 وسّعه لمجال `product_workbook` (يستهلك
 * `ProductWorkbookService` حصراً). `InventoryOpeningImportService` لا يزال
 * غير مربوط (PR-DUR-4). عقود PR-DUR-1..3 كاملةً في
 * `DURABLE-IMPORTS-DECOMPOSITION.md` §4/§6/§7.
 */
class ImportJobService
{
    /** يعيد استخدام نفس سقفَي الصفوف/الأعمدة المفروضين على استيراد المنتجات — لا نسخة ثانية. */
    private const MAX_ROWS = ProductImportService::MAX_ROWS;

    private const MAX_COLUMNS = ProductImportService::MAX_COLUMNS;

    public function __construct(private readonly ImportJobFileStorage $storage) {}

    /**
     * إنشاءٌ آمنٌ تحت التزامن: القيد الفريد `(tenant_id, idempotency_key)` في
     * قاعدة البيانات هو الحَكَم النهائي، لا الفحص المسبق وحده. طلبان
     * متزامنان بنفس المفتاح قد يجتازا الفحص المسبق معاً؛ الخاسر يُدرِج فيصطدم
     * بالقيد فيُنظِّف ملفه اليتيم ويعيد تشغيلة الفائز — بعد التحقق من تطابق
     * الطلب (المجال + بصمة SHA-256)، لا إعادة سجلٍّ لا يخصّه أبداً.
     */
    public function create(UploadedFile $file, string $domain, ?string $idempotencyKey, ?string $userId): ImportJob
    {
        $idempotencyKey = $idempotencyKey !== null && trim($idempotencyKey) !== '' ? trim($idempotencyKey) : null;
        $sha256 = hash_file('sha256', $file->getRealPath());
        if ($sha256 === false) {
            throw new RuntimeException('تعذّر حساب بصمة الملف.');
        }

        if ($idempotencyKey !== null) {
            $existing = ImportJob::query()->where('idempotency_key', $idempotencyKey)->first();
            if ($existing) {
                return $this->assertSameRequestOrFail($existing, $domain, $sha256);
            }
        }

        $id = (string) Str::uuid();
        $stored = $this->storage->store((string) app(TenantContext::class)->id(), $id, $file, $sha256);

        try {
            // معاملة صريحة: عند تعارض القيد الفريد، يجب أن تعود القاعدة إلى
            // حالة نظيفة قبل استعلام الاسترداد أدناه — بلا هذا، تبقى معاملة
            // PostgreSQL «فاشلة» فيفشل حتى استعلام SELECT البريء بعدها
            // مباشرة (25P02). `DB::transaction()` يتراجع تلقائياً عند أي
            // استثناء قبل إعادة رميه، فيعيد الاتصال صالحاً للاستعلام التالي.
            $job = DB::transaction(fn () => ImportJob::create([
                'id' => $id,
                'domain' => $domain,
                'status' => ImportJobStatus::UPLOADED,
                'idempotency_key' => $idempotencyKey,
                'original_filename' => $file->getClientOriginalName(),
                'extension' => strtolower((string) $file->getClientOriginalExtension()),
                'mime_type' => $stored['mime_type'],
                'byte_size' => $stored['byte_size'],
                'storage_disk' => $stored['disk'],
                'storage_path' => $stored['path'],
                'content_sha256' => $sha256,
                'created_by' => $userId,
                'purge_after' => now()->addDays((int) config('imports.retention_days', 14)),
            ]));
        } catch (UniqueConstraintViolationException $e) {
            // خسرنا سباق (tenant_id, idempotency_key): تشغيلة أخرى أُدرِجت
            // بين فحصنا المسبق وإدراجنا. الملف الذي خزّناه للتوّ يتيمٌ الآن —
            // يُحذف فوراً؛ لا نسخة ثانية تبقى بلا سجل يشير إليها.
            $this->storage->delete($stored['path']);

            if ($idempotencyKey === null) {
                // لا قيد فريد يمكن أن يصطدم به مفتاحٌ غائب أصلاً — دفاعي فقط.
                throw $e;
            }

            $existing = ImportJob::query()->where('idempotency_key', $idempotencyKey)->first();
            if (! $existing) {
                throw $e;
            }

            return $this->assertSameRequestOrFail($existing, $domain, $sha256);
        }

        return $this->inspect($job);
    }

    /**
     * ربط هوية إعادة المحاولة بالمفتاح: تشغيلةٌ قائمة بنفس `idempotency_key`
     * تُعاد **فقط** إن كان المجال وبصمة SHA-256 مطابقين حرفياً لطلب اليوم —
     * إعادة محاولة فعلية لنفس الطلب، لا أكثر. أي اختلاف (ملفٌ آخر أو مجالٌ
     * آخر) يُرفض صراحةً (422 عبر `ApiController::domain()`)؛ لا يُعاد أبداً
     * سجلٌّ لا يخصّ هذا الطلب تحت ستار «نفس المفتاح».
     */
    private function assertSameRequestOrFail(ImportJob $existing, string $domain, string $sha256): ImportJob
    {
        if ($existing->domain !== $domain || $existing->content_sha256 !== $sha256) {
            throw new RuntimeException(
                'مفتاح idempotency هذا مستخدَم بالفعل لملف أو مجال مختلف. استخدم مفتاحاً جديداً لهذا الطلب.'
            );
        }

        return $existing;
    }

    /**
     * فحصٌ هيكلي فقط: يتحقق أن الملف المخزَّن قابل للقراءة وضمن سقف
     * الصفوف/الأعمدة، ثم `ready`. فشلٌ هنا يُفشل التشغيلة (لا الطلب) ويحذف
     * الملف المخزَّن — السجل يبقى للتدقيق (لا نجاح خفي جزئي). يعمل بلا علمٍ
     * بسائق التخزين (`materializeLocalCopy` يُحيّد الفرق بين local وs3).
     *
     * **`row_count` صفوف بيانات لا صفوف فيزيائية:** يُستثنى الصف الفارغ
     * بنفس تعريف `ProductImportService::isBlankRow()` — تماماً كما يعدّ
     * `ProductImportService::parse()` نافذة الدُفعة عبر `dataIndex` (يتجاوز
     * الفارغ بلا زيادته). عدّادٌ يشمل الفارغ هنا بينما تستثنيه نافذة التطبيق
     * كان يجعل `processed_rows` لا يبلغ `row_count` أبداً عند وجود صفوف
     * فارغة، فتبقى التشغيلة `processing` للأبد ثم تفشل عند أول قطعة تالية لا
     * تجد صفوفاً قابلة للتطبيق (انظر تصحيح المراجعة PR-DUR-2).
     */
    private function inspect(ImportJob $job): ImportJob
    {
        $tmpPath = null;
        try {
            $tmpPath = $this->materializeLocalCopy($job->storage_path);
            [$rowCount, $columnCount] = $this->inspectCounts($job->domain, $tmpPath, $job->extension);

            $job->update([
                'status' => ImportJobStatus::READY,
                'row_count' => $rowCount,
                'column_count' => $columnCount,
            ]);

            return $job;
        } catch (Throwable $e) {
            $this->storage->delete($job->storage_path);
            $job->update([
                'status' => ImportJobStatus::FAILED,
                'storage_path' => null,
                'error_message' => $e->getMessage(),
            ]);

            return $job;
        } finally {
            if ($tmpPath !== null && is_file($tmpPath)) {
                @unlink($tmpPath);
            }
        }
    }

    /**
     * `SpreadsheetReader` يحتاج مسار ملف حقيقي (ZipArchive/XMLReader لصيغة
     * XLSX) — لا تدفق. نسخة مؤقتة محلية تُحذف حتماً بعد الفحص (`finally`
     * في `inspect()`)، بصرف النظر عن سائق التخزين الفعلي خلف `readStream()`.
     */
    private function materializeLocalCopy(string $path): string
    {
        $stream = $this->storage->readStream($path);
        $tmpPath = tempnam(sys_get_temp_dir(), 'import-inspect-');
        if ($tmpPath === false) {
            throw new RuntimeException('تعذّر إنشاء نسخة مؤقتة للفحص.');
        }

        $target = fopen($tmpPath, 'wb');
        if (! is_resource($target)) {
            throw new RuntimeException('تعذّر إنشاء نسخة مؤقتة للفحص.');
        }

        stream_copy_to_stream($stream, $target);
        fclose($target);
        if (is_resource($stream)) {
            fclose($stream);
        }

        return $tmpPath;
    }

    /**
     * PR-DUR-3 — عدّاد الصفوف/الأعمدة يتفرّع حسب المجال، لا محرّكان منفصلان:
     * `product_catalog` ملفٌّ أحادي الورقة (`SpreadsheetReader::read()`،
     * سلوك PR-DUR-1/2 حرفياً)، و`product_workbook` مصنّفٌ ثلاثي الأوراق
     * (`SpreadsheetReader::readWorkbookXlsx()` — نفس القارئ الذي تستهلكه
     * `ProductWorkbookService::readWorkbook()` بلا نسخة ثانية). `row_count`
     * لمصنّف = مجموع صفوف البيانات في الأوراق الثلاث الحاضرة، بنفس تعريف
     * `ProductImportService::isBlankRow()` — يطابق حرفياً ما تحسبه
     * `ProductWorkbookService::inspect()` لكل ورقة على حدة اليوم.
     *
     * @return array{0: int, 1: int} [row_count, column_count]
     */
    private function inspectCounts(string $domain, string $tmpPath, string $extension): array
    {
        if ($domain === ImportJobDomain::PRODUCT_WORKBOOK) {
            $sheets = SpreadsheetReader::readWorkbookXlsx($tmpPath, self::MAX_ROWS, self::MAX_COLUMNS);
            if (! isset($sheets[ProductWorkbookService::SHEET_PRODUCTS])) {
                throw new RuntimeException(
                    'المصنّف لا يحتوي ورقة «'.ProductWorkbookService::SHEET_PRODUCTS.'» — هي الورقة الإلزامية الوحيدة.'
                );
            }

            $rowCount = 0;
            $sheetNames = [
                ProductWorkbookService::SHEET_PRODUCTS,
                ProductWorkbookService::SHEET_BARCODES,
                ProductWorkbookService::SHEET_UNIT_PRICES,
            ];
            foreach ($sheetNames as $sheetName) {
                if (! isset($sheets[$sheetName])) {
                    continue;
                }
                $dataRows = array_slice($sheets[$sheetName], 1);
                $rowCount += count(array_filter(
                    $dataRows,
                    static fn (array $row): bool => ! ProductImportService::isBlankRow($row)
                ));
            }

            $productsHeader = $sheets[ProductWorkbookService::SHEET_PRODUCTS][0] ?? [];

            return [$rowCount, count($productsHeader)];
        }

        $rows = SpreadsheetReader::read($tmpPath, $extension, self::MAX_ROWS, self::MAX_COLUMNS);

        return [$this->countDataRows($rows), $rows === [] ? 0 : count($rows[0])];
    }

    /**
     * عدد صفوف البيانات الفعلية (بلا صف العناوين ولا الصفوف الفارغة) —
     * التعريف الوحيد المستعمل لـ`row_count` ولاكتمال الترحيل معاً، مطابقاً
     * حرفياً لتعريف `dataIndex` في `ProductImportService::parse()`.
     *
     * @param  array<int, array<int, string>>  $rows  ناتج `SpreadsheetReader::read()` كاملاً (يشمل صف العناوين).
     */
    private function countDataRows(array $rows): int
    {
        $dataRows = $rows === [] ? [] : array_slice($rows, 1);

        return count(array_filter(
            $dataRows,
            static fn (array $row): bool => ! ProductImportService::isBlankRow($row)
        ));
    }

    /**
     * PR-DUR-2 — يرحّل قطعةً واحدة محدودة الحجم من تشغيلة `product_catalog`
     * جاهزة أو قيد المعالجة، معيداً استعمال `ProductImportService::apply()`
     * حصراً كحد الطفرة الوحيد — لا منطق مطابقة/تحقق/كتابة مكرَّر هنا.
     *
     * **الأمان من التزامن:** `lockForUpdate()` على صفّ التشغيلة يُمسَك طوال
     * القراءة والتطبيق والتحديث معاً — لا يُفرَج عنه بين قراءة المؤشّر
     * وكتابته. محاولتا ترحيل متزامنتان لنفس التشغيلة تتسلسلان فعلياً على
     * PostgreSQL (قفل صفٍّ حقيقي)، وعلى SQLite ضمن تسلسل الكاتب الوحيد على
     * مستوى الملف؛ فلا قطعتان تريان نفس `processed_rows` معاً أبداً.
     *
     * **الاستئناف/إعادة المحاولة مجانية:** كل استدعاء يعيد قراءة
     * `processed_rows` الفعلي من القاعدة تحت القفل، لا من ذاكرة العملية —
     * إعادة محاولة بعد انقطاع (قبل التزام أي شيء) تكرّر نفس نافذة الصفوف
     * من الصفر بلا أثر مضاعف؛ إعادة محاولة بعد نجاح تتقدّم تلقائياً للقطعة
     * التالية. تشغيلة `completed` تُعاد كما هي بلا استدعاء ثانٍ للتطبيق.
     *
     * **الخيارات تُجمَّد عند أول قطعة فقط** (`apply_options`) — القطع
     * اللاحقة تتجاهل خيارات الطلب الحالي فلا تُعاد تفسير حالة واجهة تغيّرت
     * بين الاستدعاءات.
     */
    public function applyNextChunk(ImportJob $job, array $options, ?string $userId, bool $costAuthorized): ImportJob
    {
        $updated = DB::transaction(function () use ($job, $options, $userId, $costAuthorized) {
            /** @var ImportJob $locked */
            $locked = ImportJob::query()->whereKey($job->id)->lockForUpdate()->firstOrFail();

            $this->assertApplicable($locked);

            if ($locked->status === ImportJobStatus::COMPLETED) {
                return $locked;
            }

            $firstChunk = $locked->status === ImportJobStatus::READY;
            $frozenOptions = $firstChunk ? $options : (array) ($locked->apply_options ?? []);

            $tmpPath = $this->materializeLocalCopy((string) $locked->storage_path);
            try {
                if ($firstChunk) {
                    $fill = [
                        'status' => ImportJobStatus::PROCESSING,
                        'apply_options' => $frozenOptions,
                        'started_at' => now(),
                    ];

                    if ($locked->domain === ImportJobDomain::PRODUCT_CATALOG) {
                        // إعادة حساب `row_count` بتعريف صفوف البيانات دون الفيزيائي
                        // مرّة واحدة هنا — تصحيحٌ ذاتيٌّ لتشغيلات `ready` أُنشئت
                        // بالحساب الفيزيائي القديم (قبل تصحيح المراجعة) قبل أن
                        // يعتمد عليها الاكتمال أدناه، بلا نقل بيانات منفصل.
                        // `product_workbook` (PR-DUR-3) أُضيف بعد هذا التصحيح —
                        // `inspect()` يحسبه بالتعريف الصحيح من أول يوم.
                        $rows = SpreadsheetReader::read($tmpPath, $locked->extension, self::MAX_ROWS, self::MAX_COLUMNS);
                        $fill['row_count'] = $this->countDataRows($rows);
                    }

                    $locked->forceFill($fill)->save();
                }

                $offset = (int) $locked->processed_rows;
                $batchSize = min(
                    ProductImportService::APPLY_BATCH_SIZE,
                    max(1, (int) ($frozenOptions['batch_size'] ?? ProductImportService::APPLY_BATCH_SIZE))
                );

                try {
                    $chunk = $this->runChunk($locked, $tmpPath, $frozenOptions, $offset, $batchSize, $userId, $costAuthorized);
                } catch (Throwable $e) {
                    $locked->forceFill([
                        'status' => ImportJobStatus::FAILED,
                        'error_message' => $e->getMessage(),
                    ])->save();

                    return $locked;
                }

                $processed = $offset + $chunk['processed_in_chunk'];
                $totalRows = (int) $locked->row_count;
                $completed = $processed >= $totalRows;

                $locked->forceFill([
                    'processed_rows' => $processed,
                    'status' => $completed ? ImportJobStatus::COMPLETED : ImportJobStatus::PROCESSING,
                    'finished_at' => $completed ? now() : null,
                    'apply_result' => $chunk['result'],
                ])->save();

                return $locked;
            } finally {
                if (is_file($tmpPath)) {
                    @unlink($tmpPath);
                }
            }
        });

        if ($updated->status === ImportJobStatus::FAILED) {
            throw new RuntimeException($updated->error_message ?? 'فشل ترحيل التشغيلة.');
        }

        return $updated;
    }

    /**
     * يبني ملف الإدخال المشترك ثم يوزّع على محرّك المجال — لا منطق مطابقة/
     * تحقق/كتابة هنا نفسه، فقط تحويل النتيجة إلى شكلٍ موحّد يفهمه
     * `applyNextChunk()`: كم صفاً اعتُبر منجَزاً في هذه القطعة، والنتيجة
     * الخام لتخزينها في `apply_result`.
     *
     * @param  array<string, mixed>  $options
     * @return array{processed_in_chunk: int, result: array<string, mixed>}
     */
    private function runChunk(ImportJob $job, string $tmpPath, array $options, int $offset, int $batchSize, ?string $userId, bool $costAuthorized): array
    {
        $file = new UploadedFile($tmpPath, (string) $job->original_filename, $job->mime_type, null, true);

        return match ($job->domain) {
            ImportJobDomain::PRODUCT_CATALOG => $this->runProductCatalogChunk($file, $options, $offset, $batchSize, $userId, $costAuthorized),
            ImportJobDomain::PRODUCT_WORKBOOK => $this->runProductWorkbookChunk($file, $options, (int) $job->row_count, $userId, $costAuthorized),
            default => throw new RuntimeException('لا يوجد محرّك ترحيل مجزّأ لهذا المجال بعد.'),
        };
    }

    /** @param array<string, mixed> $options @return array{processed_in_chunk: int, result: array<string, mixed>} */
    private function runProductCatalogChunk(UploadedFile $file, array $options, int $offset, int $batchSize, ?string $userId, bool $costAuthorized): array
    {
        $chunkOptions = array_merge($options, [
            'batch_offset' => $offset,
            'batch_size' => $batchSize,
        ]);

        $result = app(ProductImportService::class)->apply($file, $chunkOptions, $userId, $costAuthorized);

        return [
            'processed_in_chunk' => $result['created'] + $result['updated'] + $result['skipped'],
            'result' => $result,
        ];
    }

    /**
     * المصنّف ثلاثي الأوراق (Products/Barcodes/Unit Prices) ذرّيٌّ بطبيعته:
     * `ProductWorkbookService::apply()` يطبّق أوراقه الثلاث داخل معاملةٍ
     * واحدة بترتيبٍ مقصود (Products أولاً فيصبح مرئياً لبقية الأوراق داخل
     * نفس المعاملة — تعليق `ProductWorkbookService::apply()` نفسه)، ولا
     * يقبل `batch_offset`/`batch_size` أصلاً. تقطيعه صفّاً صفّاً كان يكسر
     * هذه الرؤية المتبادلة بين الأوراق أو يعيد تصميم عقد PR-UOM2-4 المعتمد —
     * كلاهما خارج نطاق هذا الـPR («لا تعِد تصميم Durable Imports»، «لا تغيّر
     * قواعد UOM/barcode/pricing المعتمدة»). القطعة الوحيدة الممكنة هنا هي
     * المصنّف كله؛ الاستئناف/التزامن/عدم التكرار محفوظة عبر نفس القفل
     * والمعاملة في `applyNextChunk()` تماماً كمجال `product_catalog` — لا
     * عبر تقسيم صفوف. تشغيلةٌ تنجح تكتمل من أول استدعاء؛ تشغيلةٌ فشلت
     * تصبح نهائية (`failed`) كبقية المجالات — لا حالة وسيطة قابلة للاستئناف
     * لمصنّفٍ فشل جزئياً، لأن معاملته الداخلية تتراجع كلها أصلاً.
     *
     * @param array<string, mixed> $options
     * @return array{processed_in_chunk: int, result: array<string, mixed>}
     */
    private function runProductWorkbookChunk(UploadedFile $file, array $options, int $totalRows, ?string $userId, bool $costAuthorized): array
    {
        $priceList = app(ProductWorkbookService::class)->resolveActivePriceList($options['price_list_id'] ?? null);
        $productOptions = array_intersect_key($options, array_flip(['mode', 'blank_policy', 'master_data_policy', 'mapping']));

        $result = app(ProductWorkbookService::class)->apply($file, $productOptions, $priceList, $userId, $costAuthorized);

        return [
            'processed_in_chunk' => $totalRows,
            'result' => $result,
        ];
    }

    /**
     * فشلٌ مغلَق صراحةً على مجالٍ بلا محرّك ترحيل أو حالةٍ لا تقبل الترحيل —
     * لا محاولة تخمين نيّة الطالب. `product_catalog` (PR-DUR-2) و
     * `product_workbook` (PR-DUR-3) مربوطان بمعالجة فعلية اليوم.
     */
    private function assertApplicable(ImportJob $job): void
    {
        $enginesAvailable = [ImportJobDomain::PRODUCT_CATALOG, ImportJobDomain::PRODUCT_WORKBOOK];
        if (! in_array($job->domain, $enginesAvailable, true)) {
            throw new RuntimeException('لا يوجد محرّك ترحيل مجزّأ لهذا المجال بعد.');
        }

        $applicable = [ImportJobStatus::READY, ImportJobStatus::PROCESSING, ImportJobStatus::COMPLETED];
        if (! in_array($job->status, $applicable, true)) {
            throw new RuntimeException('لا يمكن ترحيل تشغيلة استيراد بحالتها الحالية.');
        }
    }

    public function cancel(ImportJob $job, ?string $userId): ImportJob
    {
        if (! in_array($job->status, ImportJobStatus::CANCELLABLE_FROM, true)) {
            throw new RuntimeException('لا يمكن إلغاء تشغيلة استيراد بحالتها الحالية.');
        }

        if ($job->storage_path !== null) {
            $this->storage->delete($job->storage_path);
        }

        $job->update([
            'status' => ImportJobStatus::CANCELLED,
            'storage_path' => null,
            'cancelled_by' => $userId,
            'cancelled_at' => now(),
        ]);

        return $job;
    }
}
