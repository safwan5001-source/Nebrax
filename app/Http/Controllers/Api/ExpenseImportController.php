<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\ExpenseImportRequest;
use App\Services\ExpenseImportService;
use App\Services\ImportPreviewService;
use App\Support\ImportJobDomain;
use Illuminate\Http\JsonResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * استيراد المصروفات مسوداتٍ (IMP-H5-S2): قالب · عقد الحقول · فحص · معاينة. **بلا `apply` متزامن**: التنفيذ عبر `POST /import-jobs` (مجال `expense_import`)
 * المربوط بمعاينةٍ أحادية الاستعمال تحمل خطّة الصفوف (انجراف الخطة يُرفض وقت التنفيذ). لا ترحيل ولا قيد من هذا المسار أبداً.
 */
class ExpenseImportController extends ApiController
{
    public function __construct(protected ExpenseImportService $imports) {}

    public function template(): StreamedResponse
    {
        $content = $this->domain(fn () => $this->imports->template());

        return response()->streamDownload(static fn () => print($content), 'nebrax-expenses-import-template.csv', ['Content-Type' => 'text/csv; charset=UTF-8']);
    }

    public function fields(): JsonResponse
    {
        return response()->json(['data' => ['fields' => $this->imports->fieldContract()]]);
    }

    public function inspect(ExpenseImportRequest $request): JsonResponse
    {
        $data = $this->domain(fn () => $this->imports->inspect($request->file('file'), ExpenseImportService::DURABLE_MAX_ROWS));

        return response()->json(['data' => $data]);
    }

    /** معاينة: عدّادات وحالة كل صف وتكراراته. **لا كتابة إطلاقاً.** تُصدِر ربطاً أحادي الاستعمال تحمل خطّته. */
    public function preview(ExpenseImportRequest $request): JsonResponse
    {
        $data = $this->domain(function () use ($request): array {
            ['preview' => $preview, 'plan' => $plan] = $this->imports->previewWithPlan($request->file('file'), $request->importOptions(), ExpenseImportService::DURABLE_MAX_ROWS);
            $preview['binding'] = app(ImportPreviewService::class)->issue(
                ImportJobDomain::EXPENSE_IMPORT, $request->file('file'), null, $request->importOptions(), $request->user()?->id, $plan,
            );

            return $preview;
        });

        return response()->json(['data' => $data]);
    }
}
