<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\SalesReportRequest;
use App\Services\Reporting\SalesReportService;
use App\Support\Money;
use Illuminate\Http\JsonResponse;

/** تقارير المبيعات التحليلية: واجهة قراءة فقط فوق SalesReportService. */
class SalesReportController extends ApiController
{
    public function __construct(protected SalesReportService $reports) {}

    public function show(SalesReportRequest $request): JsonResponse
    {
        $filters = $request->validated();
        $view = $filters['view'];
        unset($filters['view']);

        $result = $this->domain(fn () => $this->reports->report($view, $filters));

        return response()->json([
            'view'   => $result['view'],
            'scope'  => $result['scope'],
            'data'   => array_map(fn (array $row) => $this->toDisplay($row), $result['rows']),
            'totals' => $this->toDisplay($result['totals']),
        ]);
    }

    /**
     * طبقة العرض وحدها تتعامل بالريال. العدادات والنسبة بنقاط الأساس تبقى أعداداً.
     *
     * @param  array<string,mixed>  $row
     * @return array<string,mixed>
     */
    private function toDisplay(array $row): array
    {
        foreach (['amount', 'net_sales', 'tax', 'revenue', 'cost', 'profit'] as $key) {
            if (array_key_exists($key, $row)) {
                $row[$key] = Money::toRiyal((int) $row[$key]);
            }
        }

        return $row;
    }
}
