<?php

namespace App\Services;

use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

/**
 * تخزين ملفات الاستيراد الدائم — عقدٌ محايدٌ عن السائق (local/S3-متوافق)،
 * مستقلٌّ تماماً عن `DocumentStorageService` (مجالٌ مختلف كلياً — لا اعتماد
 * على `PlatformIntegrationResolver` ولا أي منطق Document Center). التبديل
 * بين local وS3/R2 هو تغيير إعداد في `config/imports.php` فقط — لا تغيير في
 * هذا الملف ولا في أي خدمة/متحكّم يستهلكه.
 *
 * ⚠️ **`local` ليس ديمومة إنتاجية.** انظر التنبيه الكامل في `config/imports.php`.
 * القرص المحلي لحاوية الخادم مؤقت ويُفقَد عند إعادة البناء/الاستبدال/إعادة
 * التشغيل — هذا سلوكٌ فعليٌّ موثَّق، لا افتراض.
 */
class ImportJobFileStorage
{
    public function driver(): string
    {
        return (string) config('imports.storage.driver', 'local');
    }

    /**
     * يخزّن الملف تحت مسار مملوك للمستأجر والتشغيلة حصراً (خاصٌّ دائماً —
     * `visibility: private`)، ويعيد تسمية القرص المستعمَل وحجم/نوع الملف.
     * `$sha256` مُحسَّبٌ مسبقاً من المستدعي (`ImportJobService`) — لا إعادة
     * حساب هنا، فبصمة الملف مصدرها واحد.
     *
     * @return array{path: string, disk: string, byte_size: int, mime_type: ?string}
     */
    public function store(string $tenantId, string $jobId, UploadedFile $file, string $sha256): array
    {
        $extension = strtolower((string) $file->getClientOriginalExtension());
        // مسار مفصول بالمستأجر ثم التشغيلة — لا تقاطع ممكن بين مستأجرين
        // حتى لو تشارك السائق نفسه (bucket واحد لكل النظام في وضع s3).
        $key = "imports/{$tenantId}/{$jobId}/original.{$extension}";

        $stream = fopen($file->getRealPath(), 'rb');
        if (! is_resource($stream)) {
            throw new RuntimeException('تعذّرت قراءة الملف المرفوع.');
        }

        try {
            if (! $this->filesystem()->put($key, $stream, ['visibility' => 'private'])) {
                throw new RuntimeException('تعذّر تخزين ملف الاستيراد.');
            }
        } finally {
            if (is_resource($stream)) {
                fclose($stream);
            }
        }

        return [
            'path' => $key,
            'disk' => $this->driver(),
            'byte_size' => (int) $file->getSize(),
            'mime_type' => $file->getMimeType(),
        ];
    }

    /**
     * قراءة تدفّقية محايدة عن السائق — تُستهلَك دوماً عبر نسخة محلية مؤقتة
     * (`ImportJobService::materializeLocalCopy()`) لأن `SpreadsheetReader`
     * يحتاج مسار ملف حقيقي (ZipArchive/XMLReader لصيغة XLSX).
     *
     * @return resource
     */
    public function readStream(string $path)
    {
        $stream = $this->filesystem()->readStream($path);
        if (! is_resource($stream)) {
            throw new RuntimeException('ملف الاستيراد المخزَّن غير متاح للقراءة.');
        }

        return $stream;
    }

    public function delete(string $path): void
    {
        $fs = $this->filesystem();
        if ($fs->exists($path)) {
            $fs->delete($path);
        }
    }

    /**
     * يشتق نظام الملفات من الإعداد **الحالي** دوماً — لا من قيمة `storage_disk`
     * التاريخية المخزَّنة على التشغيلة (تلك للتدقيق فقط). تبديل السائق أثناء
     * حياة تشغيلة قائمة خارج نطاق هذا الـPR (نافذة قصيرة عملياً: رفع ثم فحص
     * فوري في الطلب نفسه).
     */
    private function filesystem(): Filesystem
    {
        $driver = $this->driver();

        if ($driver === 'local') {
            return Storage::disk('local');
        }

        if ($driver !== 's3') {
            throw new RuntimeException('سائق تخزين الاستيراد غير مدعوم: ' . $driver);
        }

        // فشلٌ صريح قبل أي كتابة — لا سقوط صامت إلى local عند إعداد s3 ناقص.
        foreach (['key', 'secret', 'bucket', 'endpoint'] as $required) {
            if (blank(config("imports.storage.{$required}"))) {
                throw new RuntimeException("إعداد تخزين الاستيراد مفقود: {$required}.");
            }
        }

        return Storage::build([
            'driver' => 's3',
            'key' => config('imports.storage.key'),
            'secret' => config('imports.storage.secret'),
            'region' => config('imports.storage.region'),
            'bucket' => config('imports.storage.bucket'),
            'endpoint' => config('imports.storage.endpoint'),
            'url' => config('imports.storage.url'),
            'use_path_style_endpoint' => (bool) config('imports.storage.use_path_style_endpoint'),
            'throw' => true,
            'visibility' => 'private',
        ]);
    }
}
