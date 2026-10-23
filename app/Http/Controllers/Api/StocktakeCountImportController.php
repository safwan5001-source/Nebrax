<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StocktakeCountImportRequest;
use App\Services\ImportPreviewService;
use App\Services\StocktakeCountImportService;
use App\Support\ImportJobDomain;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * استيراد أعداد ورقة جردٍ مفتوح (IMP-H7-S1b): قالب أعمى · عقد الحقول · فحص · معاينة. الجرد المستهدف خيارٌ مجمَّد للتشغيلة. **بلا `apply` متزامن**:
 * التنفيذ عبر `POST /import-jobs` (مجال `stocktake_count`) المربوط بمعاينةٍ أحادية الاستعمال. يكتب العدّ فقط؛ ترحيل الفروق فعلٌ منفصل لا يمرّ من هنا.
 */
class StocktakeCountImportController extends ApiController
{
    public function __construct(protected StocktakeCountImportService $imports) {}

    /** قالب عدّ أعمى لجردٍ بعينه (بلا رصيد نظام). */
    public function template(Request $request, string $id): StreamedResponse
    {
        $content = $this->domain(fn () => $this->imports->template($id, $request->user()?->id));

        return response()->streamDownload(static fn () => print($content), 'nebrax-stocktake-count-template.csv', ['Content-Type' => 'text/csv; charset=UTF-8']);
    }

    public function fields(): JsonResponse
    {
        return response()->json(['data' => ['fields' => $this->imports->fieldContract()]]);
    }

    public function inspect(StocktakeCountImportRequest $request): JsonResponse
    {
        $data = $this->domain(fn () => $this->imports->inspect($request->file('file')));

        return response()->json(['data' => $data]);
    }

    public function preview(StocktakeCountImportRequest $request): JsonResponse
    {
        $data = $this->domain(function () use ($request): array {
            $preview = $this->imports->preview($request->file('file'), $request->importOptions(), $request->user()?->id);
            // وحدة الملف الذرّية: لا خطّة صفوف — الربط بالملف والخيارات وحدهما (التطبيق يعيد التحقق كاملاً تحت قفل الجرد).
            $preview['binding'] = app(ImportPreviewService::class)->issue(
                ImportJobDomain::STOCKTAKE_COUNT, $request->file('file'), null, $request->importOptions(), $request->user()?->id, null,
            );

            return $preview;
        });

        return response()->json(['data' => $data]);
    }
}
