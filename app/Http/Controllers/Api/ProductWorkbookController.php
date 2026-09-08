<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\ProductWorkbookExportRequest;
use App\Http\Requests\ProductWorkbookImportRequest;
use App\Models\PriceList;
use App\Services\ProductWorkbookService;
use App\Support\ProductListFilters;
use App\Support\SensitiveCostPolicy;
use Illuminate\Http\JsonResponse;

/**
 * PR-UOM2-4 — مصنّف Products/Barcodes/Unit Prices ثلاثي الأوراق. متحكّمٌ
 * مستقلٌّ عن `ProductController` (على غرار `InventoryOpeningController`
 * المستقل عن مسار المنتجات القائم) لأن هذا مسارٌ إضافيٌّ جديدٌ كاملاً، لا
 * تعديلاً على استيراد/تصدير المنتجات أحادي الورقة القائم — ذاك يبقى بلا
 * أي تغيير في `ProductController`/`ImportProductsRequest`/`ExportProductsRequest`.
 */
class ProductWorkbookController extends ApiController
{
    public function __construct(protected ProductWorkbookService $workbooks) {}

    /** قائمة سعرٍ واحدة يملكها المستأجر الحالي — القرار D-F: بلا تخمين، فشلٌ مغلقٌ إن غابت أو خرجت عن النطاق. */
    private function resolvePriceList(?string $priceListId): PriceList
    {
        $priceList = $priceListId !== null ? PriceList::query()->find($priceListId) : null;
        if ($priceList === null) {
            abort(422, 'قائمة السعر المحدَّدة غير موجودة في نطاق المؤسسة.');
        }

        return $priceList;
    }

    public function template()
    {
        return response()->streamDownload(function (): void {
            echo $this->workbooks->template();
        }, 'nebrax-products-workbook-template.xlsx', [
            'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ]);
    }

    public function fields(): JsonResponse
    {
        return response()->json(['data' => $this->workbooks->fieldContract()]);
    }

    public function inspect(ProductWorkbookImportRequest $request): JsonResponse
    {
        return response()->json([
            'data' => $this->domain(fn () => $this->workbooks->inspect($request->file('file'))),
        ]);
    }

    public function preview(ProductWorkbookImportRequest $request): JsonResponse
    {
        $priceList = $this->resolvePriceList($request->string('price_list_id')->toString() ?: null);

        return response()->json([
            'data' => $this->domain(fn () => $this->workbooks->preview(
                $request->file('file'),
                $request->productOptions(),
                $priceList,
                SensitiveCostPolicy::authorized($request->user()),
            )),
        ]);
    }

    public function apply(ProductWorkbookImportRequest $request): JsonResponse
    {
        $priceList = $this->resolvePriceList($request->string('price_list_id')->toString() ?: null);

        return response()->json([
            'data' => $this->domain(fn () => $this->workbooks->apply(
                $request->file('file'),
                $request->productOptions(),
                $priceList,
                $request->user()?->id,
                SensitiveCostPolicy::authorized($request->user()),
            )),
        ]);
    }

    public function export(ProductWorkbookExportRequest $request)
    {
        $filters = $request->validated();
        $priceList = $this->resolvePriceList($filters['price_list_id'] ?? null);
        $scope = (string) ($filters['scope'] ?? 'filtered');

        $authorizedCost = SensitiveCostPolicy::authorized($request->user());
        if (SensitiveCostPolicy::queryBlocked(
            $filters, $filters['sort'] ?? null, $authorizedCost,
            SensitiveCostPolicy::PRODUCT_FILTER_KEYS, SensitiveCostPolicy::PRODUCT_SORT_KEYS
        )) {
            abort(403, 'تصفية أو فرز المنتجات بحقل تكلفة يحتاج صلاحية عرض التكلفة.');
        }

        $query = ProductListFilters::query();

        if ($scope === 'selected') {
            $ids = array_values(array_unique((array) ($filters['ids'] ?? [])));
            if ($ids === []) {
                abort(422, 'حدّد منتجاً واحداً على الأقل قبل تصدير «المحدد».');
            }
            $query->whereKey($ids);
        } elseif ($scope === 'filtered') {
            ProductListFilters::apply($query, $filters);
        }

        ProductListFilters::applySort($query, $filters['sort'] ?? null, true);

        $filename = 'nebrax-products-workbook-'.$scope.'-'.now()->format('Ymd-His');

        return $this->domain(fn () => $this->workbooks->export($query, $priceList, $filename, $authorizedCost));
    }
}
