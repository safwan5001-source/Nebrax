<?php

namespace App\Services;

use App\Models\ImportJob;
use App\Support\ImportJobStatus;
use App\Support\SpreadsheetReader;
use App\Tenancy\TenantContext;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

/**
 * PR-DUR-1 — بنية تشغيلة الاستيراد الدائم: رفع → تخزين → بصمة → فحص هيكلي
 * (inspect) → `ready`/`failed`، وإلغاء قبل أيّ معالجة. لا يستهلك ولا يُستهلَك
 * من أيّ من `ProductImportService`/`ProductWorkbookService`/
 * `InventoryOpeningImportService` — عقد PR-DUR-1 كاملاً في
 * `DURABLE-IMPORTS-DECOMPOSITION.md` §4.
 */
class ImportJobService
{
    /** يعيد استخدام نفس سقفَي الصفوف/الأعمدة المفروضين على استيراد المنتجات — لا نسخة ثانية. */
    private const MAX_ROWS = ProductImportService::MAX_ROWS;

    private const MAX_COLUMNS = ProductImportService::MAX_COLUMNS;

    public function __construct(private readonly ImportJobFileStorage $storage) {}

    public function create(UploadedFile $file, string $domain, ?string $idempotencyKey, ?string $userId): ImportJob
    {
        $idempotencyKey = $idempotencyKey !== null && trim($idempotencyKey) !== '' ? trim($idempotencyKey) : null;

        if ($idempotencyKey !== null) {
            $existing = ImportJob::query()->where('idempotency_key', $idempotencyKey)->first();
            if ($existing) {
                return $existing;
            }
        }

        $id = (string) Str::uuid();
        $extension = strtolower((string) $file->getClientOriginalExtension());
        $stored = $this->storage->store((string) app(TenantContext::class)->id(), $id, $file);

        $job = ImportJob::create([
            'id' => $id,
            'domain' => $domain,
            'status' => ImportJobStatus::UPLOADED,
            'idempotency_key' => $idempotencyKey,
            'original_filename' => $file->getClientOriginalName(),
            'extension' => $extension,
            'mime_type' => $stored['mime_type'],
            'byte_size' => $stored['byte_size'],
            'storage_disk' => $stored['disk'],
            'storage_path' => $stored['path'],
            'content_sha256' => $stored['sha256'],
            'created_by' => $userId,
            'purge_after' => now()->addDays((int) config('imports.retention_days', 14)),
        ]);

        return $this->inspect($job);
    }

    /**
     * فحصٌ هيكلي فقط: يتحقق أن الملف المخزَّن قابل للقراءة وضمن سقف
     * الصفوف/الأعمدة، ثم `ready`. فشلٌ هنا يُفشل التشغيلة (لا الطلب) ويحذف
     * الملف المخزَّن — السجل يبقى للتدقيق (لا نجاح خفي جزئي).
     */
    private function inspect(ImportJob $job): ImportJob
    {
        try {
            $path = $this->storage->absolutePath($job->storage_disk, $job->storage_path);
            $rows = SpreadsheetReader::read($path, $job->extension, self::MAX_ROWS, self::MAX_COLUMNS);

            $job->update([
                'status' => ImportJobStatus::READY,
                'row_count' => max(0, count($rows) - 1),
                'column_count' => $rows === [] ? 0 : count($rows[0]),
            ]);

            return $job;
        } catch (Throwable $e) {
            $this->storage->delete($job->storage_disk, $job->storage_path);
            $job->update([
                'status' => ImportJobStatus::FAILED,
                'storage_path' => null,
                'error_message' => $e->getMessage(),
            ]);

            return $job;
        }
    }

    public function cancel(ImportJob $job, ?string $userId): ImportJob
    {
        if (! in_array($job->status, ImportJobStatus::CANCELLABLE_FROM, true)) {
            throw new RuntimeException('لا يمكن إلغاء تشغيلة استيراد بحالتها الحالية.');
        }

        if ($job->storage_path !== null) {
            $this->storage->delete($job->storage_disk, $job->storage_path);
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
