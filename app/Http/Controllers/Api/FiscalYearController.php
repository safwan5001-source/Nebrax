<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\ReopenFiscalYearRequest;
use App\Http\Requests\StoreFiscalYearRequest;
use App\Http\Requests\UpdateFiscalYearRequest;
use App\Models\FiscalYear;
use App\Services\Accounting\FiscalCloseService;
use App\Services\Accounting\FiscalYearService;
use Illuminate\Http\JsonResponse;
use RuntimeException;

/**
 * FISCAL-2 — السنوات المالية والإقفال السنوي.
 *
 * أربع صلاحيات مستقلة على المسارات (`fiscal_years.view|manage|close|reopen`).
 * لا مسار حذف: سنةٌ لها تاريخ إقفال جزءٌ من السجل المحاسبي.
 */
class FiscalYearController extends ApiController
{
    public function __construct(
        private FiscalYearService $years,
        private FiscalCloseService $closes,
    ) {}

    public function index(): JsonResponse
    {
        return response()->json(['data' => ['fiscal_years' => $this->years->list()]]);
    }

    public function readiness(string $id): JsonResponse
    {
        $payload = $this->domain(function () use ($id) {
            $year = $this->find($id);

            return [
                'fiscal_year' => $this->years->describe($year),
                'readiness'   => $this->closes->readiness($year),
            ];
        });

        return response()->json(['data' => $payload]);
    }

    public function events(string $id): JsonResponse
    {
        $events = $this->domain(function () use ($id) {
            $this->find($id);

            return $this->years->events($id);
        });

        return response()->json(['data' => $events]);
    }

    public function store(StoreFiscalYearRequest $request): JsonResponse
    {
        $year = $this->domain(fn () => $this->years->create($request->validated(), $request->user()));

        return response()->json(['data' => $year], 201);
    }

    public function update(UpdateFiscalYearRequest $request, string $id): JsonResponse
    {
        $year = $this->domain(fn () => $this->years->update($id, $request->validated(), $request->user()));

        return response()->json(['data' => $year]);
    }

    public function close(string $id): JsonResponse
    {
        $year = $this->domain(fn () => $this->closes->close($id, request()->user()));

        return response()->json(['data' => $year]);
    }

    public function reopen(ReopenFiscalYearRequest $request, string $id): JsonResponse
    {
        $year = $this->domain(fn () => $this->closes->reopen($id, $request->validated('reason'), $request->user()));

        return response()->json(['data' => $year]);
    }

    /** `TenantScope` يمنع رؤية سنة مستأجرٍ آخر، فيسقط المعرّف الأجنبي هنا. */
    private function find(string $id): FiscalYear
    {
        $year = FiscalYear::query()->whereKey($id)->first();
        if ($year === null) {
            throw new RuntimeException('السنة المالية غير موجودة.');
        }

        return $year;
    }
}
