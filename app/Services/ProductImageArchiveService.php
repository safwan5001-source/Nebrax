<?php

namespace App\Services;

use Illuminate\Http\UploadedFile;
use RuntimeException;
use ZipArchive;

final class ProductImageArchiveService
{
    public function __construct(private readonly ProductImageInspector $inspector) {}

    /** @return list<array{index:int,name:string,lookup:string,sha256:string,size:int,mime_type:string}> */
    public function manifest(UploadedFile $archive): array
    {
        if ((int) $archive->getSize() > (int) config('product_import_media.max_archive_bytes')) {
            throw new RuntimeException('حجم ZIP الخاص بصور المنتجات يتجاوز الحد الآمن.');
        }
        $path = $archive->getRealPath();
        $zip = new ZipArchive();
        if ($path === false || $zip->open($path) !== true) {
            throw new RuntimeException('تعذّر فتح ملف ZIP الخاص بالصور.');
        }

        try {
            if ($zip->numFiles > (int) config('product_import_media.max_archive_entries')) {
                throw new RuntimeException('عدد ملفات ZIP يتجاوز الحد الآمن.');
            }
            $total = 0;
            $seenNames = [];
            $entries = [];
            for ($index = 0; $index < $zip->numFiles; $index++) {
                $stat = $zip->statIndex($index);
                if (! is_array($stat)) {
                    throw new RuntimeException('تعذّر فحص أحد عناصر ZIP.');
                }
                $name = (string) ($stat['name'] ?? '');
                if ($name === '' || str_ends_with($name, '/')) {
                    continue;
                }
                $this->assertSafeEntryName($name);
                if (method_exists($zip, 'getEncryptionName') && $zip->getEncryptionName($index) !== false) {
                    throw new RuntimeException('ملف ZIP المشفّر غير مدعوم.');
                }
                $size = (int) ($stat['size'] ?? 0);
                $compressed = (int) ($stat['comp_size'] ?? 0);
                $total += $size;
                if ($size < 1 || $size > ProductImageInspector::MAX_BYTES
                    || $total > (int) config('product_import_media.max_archive_uncompressed_bytes')
                    || ($compressed === 0 && $size > 0)
                    || ($compressed > 0 && $size / $compressed > (int) config('product_import_media.max_compression_ratio'))) {
                    throw new RuntimeException('يحتوي ZIP على عنصر مضغوط يتجاوز حدود الأمان.');
                }

                $basename = basename(str_replace('\\', '/', $name));
                $key = mb_strtolower($basename, 'UTF-8');
                if (isset($seenNames[$key])) {
                    throw new RuntimeException("اسم صورة مكرر داخل ZIP: {$basename}.");
                }
                $seenNames[$key] = true;
                $file = $this->materializeFromOpenZip($zip, $index, $basename);
                try {
                    $image = $this->inspector->inspect($file);
                } finally {
                    @unlink($file->getRealPath());
                }
                $entries[] = [
                    'index' => $index,
                    'name' => $basename,
                    'lookup' => mb_strtolower(pathinfo($basename, PATHINFO_FILENAME), 'UTF-8'),
                    'sha256' => $image->sha256,
                    'size' => $image->size,
                    'mime_type' => $image->mimeType,
                ];
            }

            return $entries;
        } finally {
            $zip->close();
        }
    }

    public function materialize(UploadedFile $archive, int $index, string $name): UploadedFile
    {
        $path = $archive->getRealPath();
        $zip = new ZipArchive();
        if ($path === false || $zip->open($path) !== true) {
            throw new RuntimeException('تعذّر إعادة فتح ZIP الخاص بالصور.');
        }
        try {
            return $this->materializeFromOpenZip($zip, $index, $name);
        } finally {
            $zip->close();
        }
    }

    private function materializeFromOpenZip(ZipArchive $zip, int $index, string $name): UploadedFile
    {
        $stream = $zip->getStream((string) ($zip->statIndex($index)['name'] ?? ''));
        if (! is_resource($stream)) {
            throw new RuntimeException('تعذّر قراءة صورة من ZIP.');
        }
        $tmp = tempnam(sys_get_temp_dir(), 'product-image-zip-');
        if ($tmp === false) {
            fclose($stream);
            throw new RuntimeException('تعذّر إنشاء ملف مؤقت للصورة.');
        }
        $target = fopen($tmp, 'wb');
        if (! is_resource($target)) {
            fclose($stream);
            @unlink($tmp);
            throw new RuntimeException('تعذّر إنشاء ملف مؤقت للصورة.');
        }
        stream_copy_to_stream($stream, $target, ProductImageInspector::MAX_BYTES + 1);
        fclose($stream);
        fclose($target);

        return new UploadedFile($tmp, $name, null, null, true);
    }

    private function assertSafeEntryName(string $name): void
    {
        $normalized = str_replace('\\', '/', $name);
        if (str_contains($name, "\0") || str_starts_with($normalized, '/')
            || preg_match('/^[A-Za-z]:\//', $normalized)
            || in_array('..', explode('/', $normalized), true)) {
            throw new RuntimeException('يحتوي ZIP على مسار غير آمن (Zip Slip).');
        }
        $extension = strtolower(pathinfo($normalized, PATHINFO_EXTENSION));
        if (! in_array($extension, ['jpg', 'jpeg', 'png', 'webp'], true)) {
            throw new RuntimeException("يحتوي ZIP على ملف غير مدعوم: {$name}.");
        }
    }
}
