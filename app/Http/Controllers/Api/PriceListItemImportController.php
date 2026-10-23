<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\PriceListItemImportRequest;
use App\Services\ImportPreviewService;
use App\Services\PriceListItemImportService;
use App\Support\ImportJobDomain;
use Illuminate\Http\JsonResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * استيراد أسعار قائمة سعر (IMP-H4-S5): قالب · عقد الحقول · فحص · معاينة. القائمة خيارٌ مجمَّد للتشغيلة (يُحلّ نشطاً داخل المؤسسة أو يفشل مغلقاً).
 * **بلا `apply` متزامن**: التنفيذ عبر `POST /import-jobs` (مجال `price_list_items`) المربوط بالمعاينة. لا يمسّ سعر بطاقة المنتج ولا الأستاذ.
 */
class PriceListItemImportController extends ApiController
{
    public function __construct(protected PriceListItemImportService $imports) {}

    public function template(): StreamedResponse
    {
        $content = $this->domain(fn () => $this->imports->template());

        return response()->streamDownload(static fn () => print($content), 'nebrax-price-list-items-import-template.csv', ['Content-Type' => 'text/csv; charset=UTF-8']);
    }

    public function fields(): JsonResponse
    {
        return response()->json(['data' => ['fields' => $this->imports->fieldContract()]]);
    }

    public function inspect(PriceListItemImportRequest $request): JsonResponse
    {
        $data = $this->domain(fn () => $this->imports->inspect($request->file('file'), PriceListItemImportService::DURABLE_MAX_ROWS));

        return response()->json(['data' => $data]);
    }

    public function preview(PriceListItemImportRequest $request): JsonResponse
    {
        $data = $this->domain(function () use ($request): array {
            ['preview' => $preview, 'plan' => $plan] = $this->imports->previewWithPlan($request->file('file'), $request->importOptions(), PriceListItemImportService::DURABLE_MAX_ROWS);
            $preview['binding'] = app(ImportPreviewService::class)->issue(
                ImportJobDomain::PRICE_LIST_ITEMS, $request->file('file'), null, $request->importOptions(), $request->user()?->id, $plan,
            );

            return $preview;
        });

        return response()->json(['data' => $data]);
    }
}
