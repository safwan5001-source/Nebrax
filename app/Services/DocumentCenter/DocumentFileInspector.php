<?php

namespace App\Services\DocumentCenter;

use Illuminate\Http\UploadedFile;
use Illuminate\Validation\ValidationException;

class DocumentFileInspector
{
    private const EXTENSIONS = [
        'application/pdf' => ['pdf'],
        'image/jpeg' => ['jpg', 'jpeg'],
        'image/png' => ['png'],
        'image/webp' => ['webp'],
    ];

    public function __construct(private readonly PdfPageCounter $pdfPages)
    {
    }

    public function inspect(UploadedFile $file): InspectedDocumentFile
    {
        $path = $file->getRealPath();
        if ($path === false || ! is_file($path) || ! is_readable($path)) {
            throw ValidationException::withMessages(['file' => 'تعذر قراءة الملف المرفوع.']);
        }

        $size = filesize($path);
        $maximum = (int) config('document_center.intake.max_file_kilobytes', 20480) * 1024;
        if ($size === false || $size < 1 || $size > $maximum) {
            throw ValidationException::withMessages(['file' => 'حجم الملف غير صالح أو يتجاوز الحد المسموح.']);
        }

        $detected = (new \finfo(FILEINFO_MIME_TYPE))->file($path) ?: '';
        if (! array_key_exists($detected, self::EXTENSIONS)) {
            throw ValidationException::withMessages(['file' => 'نوع الملف الفعلي غير مدعوم.']);
        }

        $extension = strtolower($file->getClientOriginalExtension());
        if (! in_array($extension, self::EXTENSIONS[$detected], true)) {
            throw ValidationException::withMessages(['file' => 'امتداد الملف لا يطابق محتواه الفعلي.']);
        }

        $pages = $detected === 'application/pdf'
            ? $this->pdfPages->count($path)
            : $this->inspectImage($path, $detected);

        $name = trim(basename(str_replace('\\', '/', str_replace("\0", '', $file->getClientOriginalName()))));
        if ($name === '' || mb_strlen($name) > 255) {
            throw ValidationException::withMessages(['file' => 'اسم الملف غير صالح.']);
        }

        $sha256 = hash_file('sha256', $path);
        if ($sha256 === false) {
            throw ValidationException::withMessages(['file' => 'تعذر حساب بصمة الملف.']);
        }

        return new InspectedDocumentFile(
            $name,
            $file->getClientMimeType() ?: null,
            $detected,
            $extension,
            (int) $size,
            $pages,
            $sha256,
        );
    }

    private function inspectImage(string $path, string $detectedMime): int
    {
        $details = @getimagesize($path);
        if ($details === false || ($details['mime'] ?? null) !== $detectedMime) {
            throw ValidationException::withMessages(['file' => 'الصورة تالفة أو لا تطابق نوعها.']);
        }

        [$width, $height] = $details;
        $maxDimension = (int) config('document_center.intake.max_image_dimension', 12000);
        $maxPixels = (int) config('document_center.intake.max_image_pixels', 80000000);
        if ($width < 1 || $height < 1 || $width > $maxDimension || $height > $maxDimension || $width * $height > $maxPixels) {
            throw ValidationException::withMessages(['file' => 'أبعاد الصورة تتجاوز حدود المعالجة الآمنة.']);
        }

        return 1;
    }
}
