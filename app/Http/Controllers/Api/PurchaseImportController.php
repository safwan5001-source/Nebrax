<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\PurchaseImportRequest;
use App\Services\ImportPreviewService;
use App\Services\PurchaseImportService;
use App\Support\ImportJobDomain;
use Illuminate\Http\JsonResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * استيراد فواتير المشتريات مسوداتٍ (IMP-H5-S4a): قالب · عقد الحقول · فحص · معاينة. **بلا `apply` متزامن**: التنفيذ عبر `POST /import-jobs` (مجال `purchase_import`)
 * المربوط بمعاينةٍ أحادية الاستعمال تحمل خطّة الفواتير (انجراف الخطة يُرفض وقت التنفيذ). لا ترحيل ولا قيد ولا حركة مخزون من هذا المسار أبداً.
 */
class PurchaseImportController extends ApiController
{
    public function __construct(protected PurchaseImportService $imports) {}

    public function template(): StreamedResponse
    {
        $content = $this->domain(fn () => $this->imports->template());

        return response()->streamDownload(static fn () => print($content), 'nebrax-purchases-import-template.csv', ['Content-Type' => 'text/csv; charset=UTF-8']);
    }

    public function fields(): JsonResponse
    {
        return response()->json(['data' => ['fields' => $this->imports->fieldContract()]]);
    }

    public function inspect(PurchaseImportRequest $request): JsonResponse
    {
        $data = $this->domain(fn () => $this->imports->inspect($request->file('file'), PurchaseImportService::DURABLE_MAX_ROWS));

        return response()->json(['data' => $data]);
    }

    /** معاينة: عدّادات وحالة كل فاتورة. **لا كتابة إطلاقاً.** تُصدِر ربطاً أحادي الاستعمال تحمل خطّته. المستودع المحدَّد يجب أن يكون ضمن صلاحيات الفاعل. */
    public function preview(PurchaseImportRequest $request): JsonResponse
    {
        $data = $this->domain(function () use ($request): array {
            $options = $request->importOptions();
            $warehouse = (string) ($options['warehouse_id'] ?? '');
            $this->imports->assertWarehouseAccess($warehouse !== '' ? mb_strtolower($warehouse, 'UTF-8') : null, $request->user()?->id);
            ['preview' => $preview, 'plan' => $plan] = $this->imports->previewWithPlan($request->file('file'), $options, PurchaseImportService::DURABLE_MAX_ROWS);
            $preview['binding'] = app(ImportPreviewService::class)->issue(
                ImportJobDomain::PURCHASE_IMPORT, $request->file('file'), null, $options, $request->user()?->id, $plan,
            );

            return $preview;
        });

        return response()->json(['data' => $data]);
    }
}
