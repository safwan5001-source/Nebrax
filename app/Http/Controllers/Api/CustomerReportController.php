<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\CustomerReportRequest;
use App\Services\Reporting\CustomerReportService;
use App\Support\Money;
use Illuminate\Http\JsonResponse;

/** تقارير العملاء التحليلية: واجهة قراءة فقط فوق CustomerReportService. */
class CustomerReportController extends ApiController
{
    public function __construct(protected CustomerReportService $reports) {}

    public function show(CustomerReportRequest $request): JsonResponse
    {
        $filters = $request->validated();
        $view = $filters['view'];
        unset($filters['view']);

        $result = $this->domain(fn () => $this->reports->report($view, $filters));

        return response()->json([
            'view' => $result['view'],
            'scope' => $result['scope'],
            'data' => array_map(fn (array $row) => $this->toDisplay($row), $result['rows']),
            'totals' => $this->toDisplay($result['totals']),
        ]);
    }

    /** طبقة العرض وحدها تحوّل الهللات إلى ريال؛ العدادات تبقى أعداداً صحيحة. */
    private function toDisplay(array $row): array
    {
        foreach (['amount', 'net_sales', 'tax', 'balance'] as $key) {
            if (array_key_exists($key, $row)) {
                $row[$key] = Money::toRiyal((int) $row[$key]);
            }
        }

        return $row;
    }
}
