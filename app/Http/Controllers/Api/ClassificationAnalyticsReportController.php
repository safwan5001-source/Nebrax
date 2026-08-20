<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\ClassificationAnalyticsReportRequest;
use App\Services\Reporting\ClassificationAnalyticsReportService;
use App\Support\Money;
use Illuminate\Http\JsonResponse;

class ClassificationAnalyticsReportController extends ApiController
{
    public function __construct(protected ClassificationAnalyticsReportService $reports) {}

    public function show(ClassificationAnalyticsReportRequest $request): JsonResponse
    {
        $result = $this->domain(fn () => $this->reports->report($request->validated()));

        return response()->json([
            'scope' => $result['scope'],
            'data' => array_map(fn (array $row) => $this->toDisplay($row), $result['rows']),
            'totals' => $this->toDisplay($result['totals']),
        ]);
    }

    /** @param array<string,mixed> $row @return array<string,mixed> */
    private function toDisplay(array $row): array
    {
        if (array_key_exists('amount', $row)) {
            $row['amount'] = Money::toRiyal((int) $row['amount']);
        }

        return $row;
    }
}
