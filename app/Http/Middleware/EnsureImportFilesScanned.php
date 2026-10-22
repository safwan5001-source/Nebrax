<?php

namespace App\Http\Middleware;

use App\Services\SpreadsheetIntakeGuard;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Symfony\Component\HttpFoundation\Response;

/**
 * يمرّر كل ملف مرفوع في الطلب بـ`SpreadsheetIntakeGuard` **قبل** المتحكّم وطبقة التحقق وأي تحليل (IMP-H1-S4). يُطبَّق على كل مسار يقبل
 * ملف استيراد أو أرشيفه؛ ويحرس ذلك اختبار ثابت يعدّد المسارات التي تقبل ملفاً (`ImportIntakeGuardTest`) فلا يتخطّاها مجالٌ جديد.
 * بوّابة معطّلة (`off`) = لا أثر.
 */
class EnsureImportFilesScanned
{
    public function __construct(private readonly SpreadsheetIntakeGuard $guard) {}

    public function handle(Request $request, Closure $next): Response
    {
        if ($this->guard->enabled()) {
            $this->guard->admit($this->uploadedFiles($request->allFiles()));
        }

        return $next($request);
    }

    /**
     * @param  array<int|string, mixed>  $files
     * @return list<UploadedFile>
     */
    private function uploadedFiles(array $files): array
    {
        $flat = [];
        foreach ($files as $value) {
            if ($value instanceof UploadedFile) {
                $flat[] = $value;
            } elseif (is_array($value)) {
                array_push($flat, ...$this->uploadedFiles($value));
            }
        }

        return $flat;
    }
}
