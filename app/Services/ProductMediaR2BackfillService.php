<?php

namespace App\Services;

use App\Models\ProductMedia;
use App\Services\DocumentCenter\DocumentStorageService;
use App\Tenancy\TenantContext;
use Aws\Exception\AwsException;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

/**
 * ═══════════════════════════════════════════════════════════════
 *  ProductMediaR2BackfillService — ترحيل يدوي محصور لوسائط منتجٍ قديمة (AWJ-R2-4C)
 * ═══════════════════════════════════════════════════════════════
 *  يُستدعى **حصراً** من `awj:product-media-r2-backfill` (أمر يدوي، لا تشغيل
 *  آلي عبر boot/scheduler/queue). لا يحذف المصدر القديم أبداً — خارج نطاق
 *  هذه الحقبة عمداً (AWJ-R2-4 epic). Idempotent بالبناء: يستعلم فقط عن صفوف
 *  `disk != 'r2'`، فأي تشغيلٍ لاحق يتجاوز الصفوف المرحَّلة فعلاً تلقائياً.
 *
 *  لا يسرد الحاوية (bucket listing) إطلاقاً ولا يقبل مفاتيح خام من المستدعي —
 *  كل مفتاح يُشتقّ حصراً عبر `R2StorageService::put/exists/get` من هوية الصفّ
 *  (`product_id`) واسم ملفٍّ آمن، بنفس عقد AWJ-R2-2 حرفياً. لا يلمس أي نموذجٍ
 *  آخر غير `ProductMedia` — لا فواتير ولا مستندات ولا مرفقات أخرى.
 */
class ProductMediaR2BackfillService
{
    /** حماية ذاكرة: لا نحمّل بايتات كائنٍ أكبر من هذا في الذاكرة للتحقّق من التكامل. */
    private const MAX_BYTES = 25 * 1024 * 1024;

    public function __construct(
        private readonly DocumentStorageService $documentStorage,
        private readonly R2StorageService $r2,
    ) {}

    /** يفشل مبكراً وبرسالة واحدة واضحة بدل تكرار نفس الفشل لكل صفّ. */
    public function ensureR2Configured(): void
    {
        foreach (['key', 'secret', 'bucket', 'endpoint'] as $required) {
            if ((string) config("filesystems.disks.r2.{$required}", '') === '') {
                throw new RuntimeException("R2 storage setting is missing: {$required}.");
            }
        }
    }

    /**
     * @return array{tenant_id: string, dry_run: bool, results: list<array{media_id: string, product_id: string, source_disk: string, status: string}>, summary: array<string, int>}
     */
    public function run(string $tenantId, int $limit, bool $dryRun): array
    {
        $this->ensureR2Configured();

        app(TenantContext::class)->set($tenantId);
        try {
            // لا سرد للحاوية ولا مفاتيح خام — فقط صفوف ProductMedia المعزولة
            // بمستأجر هذا الاستدعاء (TenantScope) وغير المرحَّلة بعد.
            $rows = ProductMedia::query()
                ->where('disk', '!=', 'r2')
                ->orderBy('created_at')
                ->limit($limit)
                ->get();

            $results = [];
            foreach ($rows as $media) {
                $results[] = $this->migrateOne($media, $dryRun);
            }

            $summary = [];
            foreach ($results as $result) {
                $summary[$result['status']] = ($summary[$result['status']] ?? 0) + 1;
            }

            return [
                'tenant_id' => $tenantId,
                'dry_run' => $dryRun,
                'results' => $results,
                'summary' => $summary,
            ];
        } finally {
            app(TenantContext::class)->forget();
        }
    }

    /** @return array{media_id: string, product_id: string, source_disk: string, status: string} */
    private function migrateOne(ProductMedia $media, bool $dryRun): array
    {
        $row = [
            'media_id' => $media->id,
            'product_id' => $media->product_id,
            'source_disk' => $media->disk,
            'status' => 'unknown',
        ];

        if ($dryRun) {
            $row['status'] = 'would_migrate';

            return $row;
        }

        try {
            $bytes = $this->readLegacyBytes($media);
        } catch (RuntimeException $exception) {
            $row['status'] = $exception->getMessage();

            return $row;
        }

        if (strlen($bytes) > self::MAX_BYTES) {
            $row['status'] = 'failed_too_large';

            return $row;
        }

        $sourceHash = hash('sha256', $bytes);
        $filename = basename($media->path);
        if (preg_match('/\A[A-Za-z0-9][A-Za-z0-9._-]{0,127}\z/', $filename) !== 1) {
            $extension = strtolower((string) pathinfo($filename, PATHINFO_EXTENSION)) ?: 'bin';
            $extension = preg_match('/\A[a-z0-9]{1,10}\z/', $extension) === 1 ? $extension : 'bin';
            $filename = Str::uuid().'.'.$extension;
        }

        try {
            $key = $this->r2->put(ProductMedia::R2_DOMAIN, (string) $media->product_id, $filename, $bytes, $media->mime_type);
        } catch (RuntimeException|AwsException $exception) {
            $row['status'] = 'failed_write';

            return $row;
        }

        // من هنا فصاعداً كائنٌ فعليٌّ موجودٌ على R2 بهذا المفتاح تحديداً. أي
        // فشلٍ لاحق (تحقّق/قراءة رجعية/تكامل/حفظ) يجب ألّا يترك كائناً يتيماً
        // لا يشير إليه أي صفّ — فتُحاول إزالته (الكائن الدقيق فقط، لا سرد ولا
        // بادئة)، والمصدر القديم يبقى كما هو دائماً بلا مساس.
        $productId = (string) $media->product_id;

        // exists() تُعيد false لـ404/NoSuchKey فقط، وتُعيد رمي أي خطأ آخر
        // (5xx/شبكة) — يجب التقاطه هنا أيضاً وإلا أفلت من migrateOne() بلا
        // cleanupOrphan()، تاركاً كائناً يتيماً كتبه put() هذا التشغيل تحديداً.
        try {
            $exists = $this->r2->exists(ProductMedia::R2_DOMAIN, $productId, $filename);
        } catch (RuntimeException|AwsException $exception) {
            $row['status'] = $this->cleanupOrphan($productId, $filename, 'failed_verify_exists');

            return $row;
        }

        if (! $exists) {
            $row['status'] = $this->cleanupOrphan($productId, $filename, 'failed_verify_missing');

            return $row;
        }

        try {
            $readBack = $this->r2->get(ProductMedia::R2_DOMAIN, $productId, $filename);
        } catch (RuntimeException|AwsException $exception) {
            $row['status'] = $this->cleanupOrphan($productId, $filename, 'failed_verify_read');

            return $row;
        }

        if (! hash_equals($sourceHash, hash('sha256', (string) $readBack))) {
            $row['status'] = $this->cleanupOrphan($productId, $filename, 'failed_integrity_mismatch');

            return $row;
        }

        // المصدر القديم لا يُحذف هنا عمداً (خارج النطاق) — فقط تحويل الإشارة.
        try {
            $media->forceFill(['disk' => 'r2', 'path' => $key])->save();
        } catch (Throwable $exception) {
            $row['status'] = $this->cleanupOrphan($productId, $filename, 'failed_db_update');

            return $row;
        }

        $row['status'] = 'migrated';

        return $row;
    }

    /**
     * يحذف كائن R2 الذي أنشأه `put()` في هذا الاستدعاء تحديداً عند فشل خطوةٍ
     * لاحقة — لا سرد، لا بادئة، الكائن الدقيق فقط. فشل الحذف نفسه لا يُموَّه:
     * يُلحَق بحالة الصفّ لاحقةً `_orphan_cleanup_failed` فيظهر في التقرير
     * المُنظَّم للتشغيل اليدوي بدل أن يُبتلَع صامتاً.
     */
    private function cleanupOrphan(string $productId, string $filename, string $reasonStatus): string
    {
        try {
            $this->r2->delete(ProductMedia::R2_DOMAIN, $productId, $filename);
        } catch (RuntimeException|AwsException $exception) {
            return $reasonStatus.'_orphan_cleanup_failed';
        }

        return $reasonStatus;
    }

    /** @throws RuntimeException بحالةٍ رمزية (source_missing/source_unavailable) ككودٍ في الرسالة */
    private function readLegacyBytes(ProductMedia $media): string
    {
        if ($media->disk === 'document') {
            try {
                $stream = $this->documentStorage->readStream($this->documentStorage->profile(), $media->path);
            } catch (RuntimeException $exception) {
                throw new RuntimeException('failed_source_missing');
            }

            try {
                $contents = stream_get_contents($stream);
            } finally {
                if (is_resource($stream)) {
                    fclose($stream);
                }
            }

            if ($contents === false) {
                throw new RuntimeException('failed_source_missing');
            }

            return $contents;
        }

        try {
            $disk = Storage::disk($media->disk);
            if (! $disk->exists($media->path)) {
                throw new RuntimeException('failed_source_missing');
            }

            $contents = $disk->get($media->path);
        } catch (RuntimeException $exception) {
            throw $exception;
        } catch (Throwable $exception) {
            throw new RuntimeException('failed_source_missing');
        }

        return $contents;
    }
}
