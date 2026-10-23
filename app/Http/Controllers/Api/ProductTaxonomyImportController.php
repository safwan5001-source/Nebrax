<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\ProductTaxonomyImportRequest;
use App\Services\ImportPreviewService;
use App\Services\ProductTaxonomyImportService;
use App\Support\ImportJobDomain;
use App\Support\ProductTaxonomyImportFields;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * استيراد تصنيفات المنتجات وعلاماتها (IMP-H4-S5): قالب · عقد الحقول · فحص · معاينة. **بلا `apply` متزامن** (القاعدة 10): التنفيذ عبر `POST /import-jobs`
 * (مجال `product_taxonomy`) المربوط بمعاينةٍ أحادية الاستعمال تصدرها `preview` هنا. لا أثر محاسبي ولا مخزني.
 */
class ProductTaxonomyImportController extends ApiController
{
    public function __construct(protected ProductTaxonomyImportService $imports) {}

    public function template(Request $request): StreamedResponse
    {
        $kind = $this->kindOrFail($request);
        $content = $this->domain(fn () => $this->imports->template($kind));

        return response()->streamDownload(
            static fn () => print($content),
            "nebrax-{$kind}-import-template.csv",
            ['Content-Type' => 'text/csv; charset=UTF-8']
        );
    }

    public function fields(Request $request): JsonResponse
    {
        return response()->json(['data' => ['fields' => $this->imports->fieldContract($this->kindOrFail($request))]]);
    }

    public function inspect(ProductTaxonomyImportRequest $request): JsonResponse
    {
        $data = $this->domain(fn () => $this->imports->inspect($request->file('file'), $request->string('kind')->toString(), ProductTaxonomyImportService::DURABLE_MAX_ROWS));

        return response()->json(['data' => $data]);
    }

    /** معاينة: عدّادات وحالة كل صف. **لا كتابة إطلاقاً.** تُصدِر ربطاً أحادي الاستعمال للتشغيلة الدائمة. */
    public function preview(ProductTaxonomyImportRequest $request): JsonResponse
    {
        $data = $this->domain(function () use ($request): array {
            ['preview' => $preview, 'plan' => $plan] = $this->imports->previewWithPlan($request->file('file'), $request->importOptions(), ProductTaxonomyImportService::DURABLE_MAX_ROWS);
            $preview['binding'] = app(ImportPreviewService::class)->issue(
                ImportJobDomain::PRODUCT_TAXONOMY, $request->file('file'), null, $request->importOptions(), $request->user()?->id, $plan,
            );

            return $preview;
        });

        return response()->json(['data' => $data]);
    }

    private function kindOrFail(Request $request): string
    {
        return (string) $request->validate(['kind' => ['required', 'in:'.implode(',', ProductTaxonomyImportFields::KINDS)]])['kind'];
    }
}
