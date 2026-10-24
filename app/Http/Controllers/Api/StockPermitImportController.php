<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StockPermitImportRequest;
use App\Services\ImportPreviewService;
use App\Services\StockPermitImportService;
use App\Support\ImportJobDomain;
use Illuminate\Http\JsonResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * استيراد بنود إذنٍ مخزني مسودة (IMP-H7-S3): قالب · عقد الحقول · فحص · معاينة. رأس الإذن خيارات مجمَّدة للتشغيلة. **بلا `apply` متزامن**: التنفيذ عبر
 * `POST /import-jobs` (مجال `stock_permit_import`) المربوط بمعاينةٍ أحادية الاستعمال. ينشئ مسودة فقط؛ الترحيل (حركة المخزون والقيد) فعلٌ منفصل لا يمرّ من هنا.
 */
class StockPermitImportController extends ApiController
{
    public function __construct(protected StockPermitImportService $imports) {}

    public function template(): StreamedResponse
    {
        $content = $this->domain(fn () => $this->imports->template());

        return response()->streamDownload(static fn () => print($content), 'nebrax-stock-permit-import-template.csv', ['Content-Type' => 'text/csv; charset=UTF-8']);
    }

    public function fields(): JsonResponse
    {
        return response()->json(['data' => ['fields' => $this->imports->fieldContract()]]);
    }

    public function inspect(StockPermitImportRequest $request): JsonResponse
    {
        $data = $this->domain(fn () => $this->imports->inspect($request->file('file')));

        return response()->json(['data' => $data]);
    }

    public function preview(StockPermitImportRequest $request): JsonResponse
    {
        $data = $this->domain(function () use ($request): array {
            $options = $request->importOptions();
            $preview = $this->imports->preview($request->file('file'), $options, $request->user()?->id);
            // وحدة الملف الذرّية: لا خطّة صفوف — الربط بالملف والخيارات القانونية وحدها (التطبيق يعيد التحقق كاملاً).
            $preview['binding'] = app(ImportPreviewService::class)->issue(
                ImportJobDomain::STOCK_PERMIT_IMPORT, $request->file('file'), null, $options, $request->user()?->id, null,
            );

            return $preview;
        });

        return response()->json(['data' => $data]);
    }
}
