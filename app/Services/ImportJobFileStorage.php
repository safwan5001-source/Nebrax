<?php

namespace App\Services;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

/**
 * تخزين ملفات الاستيراد الدائم — قرص محلي خاص فقط (PR-DUR-1، القرار D-I في
 * `DURABLE-IMPORTS-DECOMPOSITION.md` §4). مستقل عمداً عن `DocumentStorageService`:
 * مجال مختلف تماماً (استيراد المنتجات/المخزون لا مركز المستندات)، والترقية
 * إلى S3/R2 لاحقاً تغيير إعداد لا إعادة تصميم.
 */
class ImportJobFileStorage
{
    public function disk(): string
    {
        return 'local';
    }

    /**
     * يخزّن الملف تحت مسار مملوك للمستأجر والتشغيلة، ويعيد بصمته وحجمه.
     *
     * @return array{path: string, disk: string, sha256: string, byte_size: int, mime_type: ?string}
     */
    public function store(string $tenantId, string $jobId, UploadedFile $file): array
    {
        $disk = $this->disk();
        $extension = strtolower((string) $file->getClientOriginalExtension());
        $key = "imports/{$tenantId}/{$jobId}/original.{$extension}";

        $stream = fopen($file->getRealPath(), 'rb');
        if (! is_resource($stream)) {
            throw new RuntimeException('تعذّرت قراءة الملف المرفوع.');
        }

        try {
            if (! Storage::disk($disk)->put($key, $stream, ['visibility' => 'private'])) {
                throw new RuntimeException('تعذّر تخزين ملف الاستيراد.');
            }
        } finally {
            if (is_resource($stream)) {
                fclose($stream);
            }
        }

        return [
            'path' => $key,
            'disk' => $disk,
            'sha256' => hash_file('sha256', $file->getRealPath()),
            'byte_size' => (int) $file->getSize(),
            'mime_type' => $file->getMimeType(),
        ];
    }

    /** المسار المطلق للملف المخزَّن — لإعادة استعماله مع `SpreadsheetReader`. */
    public function absolutePath(string $disk, string $path): string
    {
        return Storage::disk($disk)->path($path);
    }

    public function delete(string $disk, string $path): void
    {
        if (Storage::disk($disk)->exists($path)) {
            Storage::disk($disk)->delete($path);
        }
    }
}
