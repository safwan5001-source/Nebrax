<?php

namespace App\Services;

use App\Contracts\DocumentSafetyScanner;
use App\Support\DocumentScanStatus;
use Illuminate\Http\UploadedFile;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Throwable;

/**
 * بوّابة قبول ملفات الاستيراد (IMP-H1-S4): ملف جداول أو أرشيف يصل إلى أي مسار استيراد يُفحَص بالفاحص نفسه الذي يحرس مركز المستندات
 * (`DocumentSafetyScanner`، ClamAV اليوم) **قبل أي تحليل** له (`SpreadsheetReader` يفكّ XLSX بـ`ZipArchive` ويفتح ZIP الصور).
 *
 * سياسة قابلة للضبط (لا سلوك مفروض): `imports.intake_scan.mode`
 *  - `off` (الافتراضي) — لا فحص، السلوك الحالي حرفياً؛
 *  - `on` — فشل مغلق: مصاب ⇒ 422 · الفاحص غير مهيَّأ/غير متاح/ردّ غير مفهوم ⇒ 503 (لا يُقبل ملف بلا فحص).
 * تفعيلها في الإنتاج قرار تشغيلي (D-04: يحتاج فاحصاً مُهيَّأً)، لا يتخذه هذا الكود.
 */
class SpreadsheetIntakeGuard
{
    public const MODE_OFF = 'off';

    public const MODE_ON = 'on';

    public function __construct(private readonly DocumentSafetyScanner $scanner) {}

    public function enabled(): bool
    {
        $mode = strtolower(trim((string) config('imports.intake_scan.mode', self::MODE_OFF)));

        // فشل مغلق: أي قيمة غير `off`/فارغة (مثل `On` أو `true`) تُفعّل الفحص بدل أن تُترك الملفات بلا فحص بصمت.
        return $mode !== '' && $mode !== self::MODE_OFF;
    }

    /** @param  iterable<UploadedFile>  $files */
    public function admit(iterable $files): void
    {
        if (! $this->enabled()) {
            return;
        }

        foreach ($files as $file) {
            $this->admitOne($file);
        }
    }

    private function admitOne(UploadedFile $file): void
    {
        $path = $file->getRealPath();
        $stream = $path === false ? false : @fopen($path, 'rb');
        if (! is_resource($stream)) {
            throw new HttpException(503, 'تعذّر قراءة الملف لفحصه؛ لم يُقبل.');
        }

        try {
            $status = $this->scanner->scan($stream);
        } catch (Throwable) {
            // الفاحص غير مهيَّأ أو غير متاح أو ردّ غير مفهوم: لا يُقبل ملفٌ لم يُفحَص (فشل مغلق، بلا تسريب تفاصيل الفاحص).
            throw new HttpException(503, 'فحص الملفات غير متاح الآن؛ لم يُقبل الملف. حاول لاحقاً.');
        } finally {
            fclose($stream);
        }

        if ($status === DocumentScanStatus::INFECTED) {
            throw new HttpException(422, 'رُفض الملف: اكتشف فاحص الملفات محتوى ضاراً.');
        }
        if ($status !== DocumentScanStatus::CLEAN) {
            throw new HttpException(503, 'تعذّر إتمام فحص الملف؛ لم يُقبل.');
        }
    }
}
