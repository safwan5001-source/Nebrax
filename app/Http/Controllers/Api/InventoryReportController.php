<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\InventoryReportRequest;
use App\Services\Reporting\InventoryReportService;
use App\Support\Money;
use App\Support\SensitiveCostPolicy;
use Illuminate\Http\JsonResponse;

/** تقارير المخزون التحليلية: واجهة قراءة فقط فوق InventoryReportService. */
class InventoryReportController extends ApiController
{
    public function __construct(protected InventoryReportService $reports) {}

    public function show(InventoryReportRequest $request): JsonResponse
    {
        $filters = $request->validated();
        $view = $filters['view'];
        unset($filters['view']);

        $result = $this->domain(fn () => $this->reports->report($view, $filters));
        // PR-INV-1: `reports.view` وحدها كانت تكفي للوصول إلى avg_cost/stock_value/
        // unit_cost/total_cost/in_cost/out_cost/difference_value — نفس الفجوة
        // المؤكدة في المنتج والمخزون، بالسياسة المركزية نفسها لا بقائمة موازية.
        $authorizedCost = SensitiveCostPolicy::authorized($request->user());

        return response()->json([
            'view' => $result['view'],
            'scope' => $result['scope'],
            'data' => array_map(fn (array $row) => $this->toDisplay($row, $authorizedCost), $result['rows']),
            'totals' => $this->toDisplay($result['totals'], $authorizedCost),
        ]);
    }

    /** طبقة العرض وحدها تحول حقول النقد من الهللات؛ الكميات والفروق تبقى صحيحة. */
    private function toDisplay(array $row, bool $authorizedCost): array
    {
        $row = SensitiveCostPolicy::redactRow($row, $authorizedCost, SensitiveCostPolicy::INVENTORY_REPORT_FIELDS);

        foreach (['avg_cost', 'stock_value', 'unit_cost', 'total_cost', 'in_cost', 'out_cost', 'difference_value'] as $key) {
            if (array_key_exists($key, $row) && $row[$key] !== null) {
                $row[$key] = Money::toRiyal((int) $row[$key]);
            }
        }

        return $row;
    }
}
