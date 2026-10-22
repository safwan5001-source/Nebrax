<?php

namespace App\Services;

use App\Models\ImportJob;
use App\Support\ImportChunk;
use App\Support\ImportChunkResult;
use App\Support\ImportJobDomain;
use App\Support\ImportJobStatus;
use App\Support\ImportPreviewException;
use App\Tenancy\BranchContext;
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
 * حصراً)، PR-DUR-3 وسّعه لمجال `product_workbook` (يستهلك
 * `ProductWorkbookService` حصراً)، وPR-DUR-4 وسّعه لمجال `inventory_opening`
 * (يستهلك `InventoryOpeningImportService` حصراً — **مسودة فقط، لا ترحيل**).
 * عقود PR-DUR-1..4 كاملةً في `DURABLE-IMPORTS-DECOMPOSITION.md` §4/§6/§7/§8.
 */
class ImportJobService
{
    public function __construct(
        private readonly ImportJobFileStorage $storage,
        private readonly ProductImageArchiveService $imageArchives,
        private readonly ImportDomainRegistry $domains,
        private readonly BranchContext $branch,
        private readonly ImportPreviewService $previews,
    ) {}

    /**
     * إنشاءٌ آمنٌ تحت التزامن: القيد الفريد `(tenant_id, idempotency_key)` في
     * قاعدة البيانات هو الحَكَم النهائي، لا الفحص المسبق وحده. طلبان
     * متزامنان بنفس المفتاح قد يجتازا الفحص المسبق معاً؛ الخاسر يُدرِج فيصطدم
     * بالقيد فيُنظِّف ملفه اليتيم ويعيد تشغيلة الفائز — بعد التحقق من تطابق
     * الطلب (المجال + بصمة SHA-256)، لا إعادة سجلٍّ لا يخصّه أبداً.
     */
    public function create(
        UploadedFile $file,
        string $domain,
        ?string $idempotencyKey,
        ?string $userId,
        ?UploadedFile $mediaArchive = null,
        ?array $options = null,
        ?string $previewId = null,
        ?string $previewHash = null,
    ): ImportJob
    {
        $idempotencyKey = $idempotencyKey !== null && trim($idempotencyKey) !== '' ? trim($idempotencyKey) : null;
        $sha256 = hash_file('sha256', $file->getRealPath());
        if ($sha256 === false) {
            throw new RuntimeException('تعذّر حساب بصمة الملف.');
        }
        $archiveSha256 = null;
        if ($mediaArchive !== null) {
            if ($domain !== ImportJobDomain::PRODUCT_CATALOG) {
                throw new RuntimeException('أرشيف صور المنتجات متاح لاستيراد كتالوج المنتجات فقط.');
            }
            // فحصٌ كامل قبل التخزين: بنية ZIP، المسارات، التشفير، الأحجام،
            // نسبة الضغط، ثم MIME/محتوى كل صورة لا امتدادها وحده.
            $this->imageArchives->manifest($mediaArchive);
            $archiveSha256 = hash_file('sha256', $mediaArchive->getRealPath());
            if ($archiveSha256 === false) {
                throw new RuntimeException('تعذّر حساب بصمة أرشيف الصور.');
            }
        }

        // IMP-H1-S3a: فرع التشغيلة يُلتقط **مرة واحدة** من سياق الطلب (مضبوطٌ خادمياً في `SetBranch` بعد التحقق من
        // نطاق المستخدم) ولا يتغيّر بعدها؛ كل قطعة ترحيل لاحقة تستعيده من التشغيلة لا من طلبها.
        $branchId = $this->branch->id();

        // IMP-H1-S3b: خيارات التشغيلة قانونيةً (نفس الدالة التي حوّلت خيارات المعاينة) — تُجمَّد على التشغيلة وتدخل بصمة
        // المعاينة وهوية إعادة المحاولة.
        $canonical = $this->domains->for($domain)->canonicalOptions($options ?? []);

        if ($idempotencyKey !== null) {
            $existing = ImportJob::query()->where('idempotency_key', $idempotencyKey)->first();
            if ($existing) {
                return $this->assertSameRequestOrFail($existing, $domain, $sha256, $archiveSha256, $branchId, $previewId, $previewHash, $canonical);
            }
        }

        // إعادة محاولة بعد ضياع الاستجابة: معاينةٌ أُنفقت لتشغيلةٍ أُنشئت فعلاً وجاء الطلب نفسه حرفياً ⇒ نفس التشغيلة (لا `preview_consumed`).
        if ($previewId !== null && $previewHash !== null) {
            $spent = $this->previews->consumedPreviewFor($previewId, $previewHash, $userId, $domain, $sha256, $archiveSha256, $canonical);
            $replayed = $spent === null ? null : ImportJob::query()->whereKey($spent->consumed_job_id)->where('preview_id', $spent->id)->first();
            if ($replayed !== null) {
                return $replayed;
            }
        }

        // المعاينة تُتحقَّق **قبل** تخزين أي ملف: إنشاءٌ مرفوض لا يترك أثراً. بلا معاينة: العقد القديم ما لم يُلزَم بها.
        $preview = null;
        if ($previewId !== null || $previewHash !== null) {
            $preview = $this->previews->assertConsumable(
                (string) $previewId, (string) $previewHash, $userId, $domain, $sha256, $archiveSha256, $canonical
            );
        } elseif ($this->previews->requiredNow()) {
            throw new ImportPreviewException('preview_required', 'عاين الملف قبل التنفيذ: لا تُنشأ تشغيلة تنفيذية بلا معاينة.');
        }

        $id = (string) Str::uuid();
        $stored = $this->storage->store((string) app(TenantContext::class)->id(), $id, $file, $sha256);
        try {
            $storedArchive = $mediaArchive === null
                ? null
                : $this->storage->storeMediaArchive((string) app(TenantContext::class)->id(), $id, $mediaArchive);
        } catch (Throwable $exception) {
            $this->storage->delete($stored['path']);
            throw $exception;
        }

        try {
            // معاملة صريحة: عند تعارض القيد الفريد، يجب أن تعود القاعدة إلى
            // حالة نظيفة قبل استعلام الاسترداد أدناه — بلا هذا، تبقى معاملة
            // PostgreSQL «فاشلة» فيفشل حتى استعلام SELECT البريء بعدها
            // مباشرة (25P02). `DB::transaction()` يتراجع تلقائياً عند أي
            // استثناء قبل إعادة رميه، فيعيد الاتصال صالحاً للاستعلام التالي.
            $job = DB::transaction(function () use ($preview, $id, $branchId, $domain, $idempotencyKey, $file, $stored, $sha256, $mediaArchive, $storedArchive, $archiveSha256, $userId, $canonical, $previewHash) {
                $created = ImportJob::create([
                'id' => $id,
                'branch_id' => $branchId,
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
                'media_archive_original_filename' => $mediaArchive?->getClientOriginalName(),
                'media_archive_mime_type' => $storedArchive['mime_type'] ?? null,
                'media_archive_byte_size' => $storedArchive['byte_size'] ?? null,
                'media_archive_storage_path' => $storedArchive['path'] ?? null,
                'media_archive_content_sha256' => $archiveSha256,
                'created_by' => $userId,
                'purge_after' => now()->addDays((int) config('imports.retention_days', 14)),
                // خيارات مجمَّدة عند الإنشاء لتشغيلةٍ مربوطةٍ بمعاينة؛ غيرها يجمّدها أول `apply` كالسابق.
                'preview_id' => $preview?->id,
                'preview_hash' => $preview === null ? null : $previewHash,
                'apply_options' => $preview === null ? null : $canonical,
                ]);

                // إنفاق المعاينة وإدراج التشغيلة **ذرّياً** في المعاملة نفسها: تعارض القيد الفريد أو فشل الإنفاق يُرجع الاثنين
                // فتبقى المعاينة صالحة لإعادة المحاولة، ولا تشغيلة بلا إنفاق. (المعرّف من السجل المنشأ لا من `$id`.)
                if ($preview !== null) {
                    $this->previews->consume($preview, (string) $created->id);
                }

                return $created;
            });
        } catch (UniqueConstraintViolationException $e) {
            // خسرنا سباق (tenant_id, idempotency_key): تشغيلة أخرى أُدرِجت
            // بين فحصنا المسبق وإدراجنا. الملف الذي خزّناه للتوّ يتيمٌ الآن —
            // يُحذف فوراً؛ لا نسخة ثانية تبقى بلا سجل يشير إليها.
            $this->storage->delete($stored['path']);
            if ($storedArchive !== null) {
                $this->storage->delete($storedArchive['path']);
            }

            if ($idempotencyKey === null) {
                // لا قيد فريد يمكن أن يصطدم به مفتاحٌ غائب أصلاً — دفاعي فقط.
                throw $e;
            }

            $existing = ImportJob::query()->where('idempotency_key', $idempotencyKey)->first();
            if (! $existing) {
                throw $e;
            }

            return $this->assertSameRequestOrFail($existing, $domain, $sha256, $archiveSha256, $branchId, $previewId, $previewHash, $canonical);
        } catch (Throwable $e) {
            // أي إخفاقٍ آخر في الإدراج (مثلاً حُذف الفرع بعد أن تحقّق منه `SetBranch` فيرفض قيد الـFK `branch_id`): الملف وأرشيف
            // الصور خُزِّنا قبل الإدراج ولا سجلّ يشير إليهما — يُحذفان قبل إعادة الرمي فلا يبقى كائنٌ يتيمٌ للأبد.
            $this->storage->delete($stored['path']);
            if ($storedArchive !== null) {
                $this->storage->delete($storedArchive['path']);
            }

            throw $e;
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
    /**
     * @param  array<string, mixed>  $canonical  خيارات الطلب القانونية — تدخل الهوية (القاعدة 12): الملف نفسه بمطابقة أو خيارات
     *                                            أو معاينة مختلفة **ليس** إعادة محاولة.
     */
    private function assertSameRequestOrFail(
        ImportJob $existing,
        string $domain,
        string $sha256,
        ?string $archiveSha256,
        ?string $branchId,
        ?string $previewId = null,
        ?string $previewHash = null,
        array $canonical = [],
    ): ImportJob {
        $differentBinding = $existing->preview_id !== $previewId
            || $existing->preview_hash !== $previewHash
            // الخيارات المجمَّدة تُقارَن فقط حين التشغيلة القائمة مربوطةٌ بمعاينة (غيرها تُجمَّد عند أول apply).
            // `apply_options` تحمل بعد أول قطعة مفتاح `batch_size` التشغيلي أيضاً — تُقارَن قانونياً (المفاتيح الدلالية وحدها).
            || ($existing->preview_id !== null
                && $this->domains->for($domain)->canonicalOptions((array) $existing->apply_options) !== $canonical);

        if (
            $differentBinding
            || $existing->domain !== $domain
            // مقارنةٌ صارمة بما فيها `NULL`: لا يُستثنى «قديمٌ بلا فرع» لأن `nullOnDelete` ينتج `NULL` أيضاً لتشغيلةٍ حُذف فرعها،
            // فكان يُعاد سجلّها لطلبٍ من فرعٍ آخر. إعادة محاولة عبر نشر هذا العمود نفسه (ثوانٍ) تُطالَب بمفتاحٍ جديد فحسب.
            || $existing->branch_id !== $branchId
            || $existing->content_sha256 !== $sha256
            || $existing->media_archive_content_sha256 !== $archiveSha256
        ) {
            throw new RuntimeException(
                'مفتاح idempotency هذا مستخدَم بالفعل لملف أو مجال أو فرع أو معاينة أو خيارات مختلفة. استخدم مفتاحاً جديداً لهذا الطلب.'
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
            if ($job->media_archive_storage_path !== null) {
                $this->storage->delete($job->media_archive_storage_path);
            }
            $job->update([
                'status' => ImportJobStatus::FAILED,
                'storage_path' => null,
                'media_archive_storage_path' => null,
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
     * فحصٌ هيكلي عبر محوّل المجال (IMP-H1-S2) — لا معرفة بمجالٍ بعينه هنا. المجال غير المسجَّل يفشل مغلقاً.
     *
     * @return array{0: int, 1: int} [row_count, column_count]
     */
    private function inspectCounts(string $domain, string $tmpPath, string $extension): array
    {
        return $this->domains->for($domain)->inspect($tmpPath, $extension);
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
    public function applyNextChunk(ImportJob $job, array $options, ?string $userId, bool $costAuthorized, ?array $explicitOptions = null): ImportJob
    {
        $updated = DB::transaction(function () use ($job, $options, $userId, $costAuthorized, $explicitOptions) {
            /** @var ImportJob $locked */
            $locked = ImportJob::query()->whereKey($job->id)->lockForUpdate()->firstOrFail();

            $this->assertApplicable($locked);

            if ($locked->status === ImportJobStatus::COMPLETED) {
                return $locked;
            }

            // IMP-H1-S3b: تشغيلةٌ مربوطةٌ بمعاينة تنفّذ **خياراتها المجمَّدة عند الإنشاء** (هي ما عاينه المستخدم)؛ أي خيارٍ
            // مختلف في طلب التطبيق يُرفض صراحةً لا يُتجاهَل بصمت. `batch_size` تشغيليٌّ لا دلاليّ فيبقى من طلب أول قطعة.
            if ($locked->preview_id !== null && $explicitOptions !== null) {
                $this->assertOptionsFrozen($locked, $explicitOptions);
            }

            $firstChunk = $locked->status === ImportJobStatus::READY;
            if ($locked->preview_id !== null) {
                $frozenOptions = (array) ($locked->apply_options ?? []);
                if ($firstChunk && isset($options['batch_size'])) {
                    $frozenOptions['batch_size'] = $options['batch_size'];
                }
            } else {
                $frozenOptions = $firstChunk ? $options : (array) ($locked->apply_options ?? []);
            }

            $tmpPath = $this->materializeLocalCopy((string) $locked->storage_path);
            $archiveTmpPath = null;
            try {
                if ($locked->media_archive_storage_path !== null) {
                    $archiveTmpPath = $this->materializeLocalCopy((string) $locked->media_archive_storage_path);
                }
                if ($firstChunk) {
                    $fill = [
                        'status' => ImportJobStatus::PROCESSING,
                        'apply_options' => $frozenOptions,
                        'started_at' => now(),
                    ];

                    // تصحيح ذاتي اختياري لـ`row_count` عند أول ترحيل (للمجال الذي اختلف تعريفه — انظر محوّله).
                    $recount = $this->withJobBranch($locked, fn () => $this->domains->for($locked->domain)->recountOnFirstApply($tmpPath, $locked->extension));
                    if ($recount !== null) {
                        $fill['row_count'] = $recount;
                    }

                    $locked->forceFill($fill)->save();
                }

                $offset = (int) $locked->processed_rows;
                $batchSize = min(
                    ProductImportService::APPLY_BATCH_SIZE,
                    max(1, (int) ($frozenOptions['batch_size'] ?? ProductImportService::APPLY_BATCH_SIZE))
                );

                try {
                    // IMP-H1-S8a: القطعة معاملةٌ فرعيّة (savepoint) كاملة — فشلٌ في أي مرحلة منها (ومنها صور المنتجات بعد كتابة الصفوف) يُرجع كتابات
                    // النافذة معاً، فلا تبقى منتجات مكتوبة بلا أن تُحسب منجزة، ويصحّ وصف الوحدات الفاشلة بأنها «لم تُطبَّق».
                    $chunk = DB::transaction(fn () => $this->withJobBranch($locked, fn () => $this->runChunk($locked, $tmpPath, $archiveTmpPath, $frozenOptions, $offset, $batchSize, $userId, $costAuthorized)));
                } catch (Throwable $e) {
                    $locked->forceFill([
                        'status' => ImportJobStatus::FAILED,
                        'error_message' => $e->getMessage(),
                    ])->save();
                    // IMP-H1-S8a: الوحدات الفاشلة/غير المنجزة تُسجَّل في معاملة الفشل نفسها (حالة `failed` بلا وحداتها غير ممكنة).
                    app(ImportJobUnitRecorder::class)->recordChunkFailure($locked, $this->domains->for($locked->domain), $offset, $batchSize, $e);

                    return $locked;
                }

                $processed = $offset + $chunk->processedUnits;
                $totalRows = (int) $locked->row_count;
                $completed = $processed >= $totalRows;

                $locked->forceFill([
                    'processed_rows' => $processed,
                    'status' => $completed ? ImportJobStatus::COMPLETED : ImportJobStatus::PROCESSING,
                    'finished_at' => $completed ? now() : null,
                    'apply_result' => $chunk->result,
                ])->save();

                return $locked;
            } finally {
                if (is_file($tmpPath)) {
                    @unlink($tmpPath);
                }
                if ($archiveTmpPath !== null && is_file($archiveTmpPath)) {
                    @unlink($archiveTmpPath);
                }
            }
        });

        if ($updated->status === ImportJobStatus::FAILED) {
            throw new RuntimeException($updated->error_message ?? 'فشل ترحيل التشغيلة.');
        }

        return $updated;
    }

    /**
     * خيارات الطلب الصريحة (الحقول المُرسَلة فعلاً) لا تغيّر ما جُمِّد عند الإنشاء: نُحوِّل المجمَّد + الصريح قانونياً ونقارنه
     * بالمجمَّد قانونياً. حقلٌ لا يخصّ المجال يُسقَطه التحويل القانوني فلا يُعدّ تغييراً.
     *
     * @param  array<string, mixed>  $explicit
     */
    private function assertOptionsFrozen(ImportJob $job, array $explicit): void
    {
        $adapter = $this->domains->for($job->domain);
        $frozen = $adapter->canonicalOptions((array) $job->apply_options);

        if ($adapter->canonicalOptions(array_merge($frozen, $explicit)) !== $frozen) {
            throw new ImportPreviewException('options_frozen', 'خيارات هذه التشغيلة مجمَّدة منذ المعاينة ولا تتغيّر عند التنفيذ. أنشئ معاينة جديدة بالخيارات المطلوبة.');
        }
    }

    /**
     * يجري القطعة **بفرع التشغيلة** لا بفرع الطلب الحالي، ثم يعيد سياق الفرع كما كان (finally) — `BranchContext`
     * singleton يعيش طوال الطلب، فلا يتسرّب فرع التشغيلة إلى ما بعدها. تشغيلةٌ بلا فرع (قديمة أو مستأجر بلا فروع)
     * تبقى على سلوكها القديم: الفرع النشط للطلب.
     */
    private function withJobBranch(ImportJob $job, callable $run): mixed
    {
        if ($job->branch_id === null) {
            return $run();
        }

        $previous = $this->branch->id();
        $this->branch->set($job->branch_id);
        try {
            return $run();
        } finally {
            $this->branch->set($previous);
        }
    }

    /**
     * يبني مدخلات القطعة ويفوّض الترحيل إلى محوّل المجال (IMP-H1-S2) — لا منطق مطابقة/تحقق/كتابة هنا.
     *
     * @param  array<string, mixed>  $options
     */
    private function runChunk(ImportJob $job, string $tmpPath, ?string $archiveTmpPath, array $options, int $offset, int $batchSize, ?string $userId, bool $costAuthorized): ImportChunkResult
    {
        $file = new UploadedFile($tmpPath, (string) $job->original_filename, $job->mime_type, null, true);

        return $this->domains->for($job->domain)->applyChunk(
            new ImportChunk($job, $file, $archiveTmpPath, $options, $offset, $batchSize, $userId, $costAuthorized)
        );
    }

    /**
     * فشلٌ مغلَق صراحةً على مجالٍ بلا محرّك ترحيل أو حالةٍ لا تقبل الترحيل —
     * لا محاولة تخمين نيّة الطالب. `product_catalog` (PR-DUR-2)،
     * `product_workbook` (PR-DUR-3)، و`inventory_opening` (PR-DUR-4) مربوطة
     * بمعالجة فعلية اليوم.
     */
    private function assertApplicable(ImportJob $job): void
    {
        if (! $this->domains->has($job->domain)) {
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
        if ($job->media_archive_storage_path !== null) {
            $this->storage->delete($job->media_archive_storage_path);
        }

        $job->update([
            'status' => ImportJobStatus::CANCELLED,
            'storage_path' => null,
            'media_archive_storage_path' => null,
            'cancelled_by' => $userId,
            'cancelled_at' => now(),
        ]);

        return $job;
    }
}
