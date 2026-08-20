<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StorePayrollRunRequest;
use App\Http\Resources\PayrollRunResource;
use App\Models\PayrollRun;
use App\Services\Accounting\PayrollService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PayrollController extends ApiController
{
    public function __construct(protected PayrollService $payroll) {}

    public function index(Request $request): JsonResponse
    {
        $query = PayrollRun::latest();

        // تصفية اختيارية بموظفٍ واحد — لعرض سجلّ رواتبه في صفحة ملفّه، بلا
        // جلب كل السطور (`items`) لبقية الموظفين في كل مسيّر.
        if ($employeeId = $request->query('employee_id')) {
            $query->whereHas('items', fn ($q) => $q->where('employee_id', $employeeId))
                ->with(['items' => fn ($q) => $q->where('employee_id', $employeeId)->with('employee')]);
        }

        return PayrollRunResource::collection($query->get())->response();
    }

    public function store(StorePayrollRunRequest $request): JsonResponse
    {
        $data = $request->validated();
        $data['created_by'] = $request->user()?->id;

        $run = $this->domain(fn () => $this->payroll->create($data, $data['employee_ids'] ?? null));

        return (new PayrollRunResource($run->load('items.employee')))->response()->setStatusCode(201);
    }

    public function show(string $id): JsonResponse
    {
        return (new PayrollRunResource(
            PayrollRun::with('items.employee')->findOrFail($id)
        ))->response();
    }

    public function post(string $id): JsonResponse
    {
        $run = PayrollRun::findOrFail($id);
        $posted = $this->domain(fn () => $this->payroll->post($run));

        return (new PayrollRunResource($posted->load('items.employee')))->response();
    }

    public function pay(Request $request, string $id): JsonResponse
    {
        $request->validate(['method' => ['nullable', 'in:cash,bank']]);
        $method = $request->input('method', 'bank');
        $run = PayrollRun::findOrFail($id);
        $paid = $this->domain(fn () => $this->payroll->pay($run, $method));

        return (new PayrollRunResource($paid->load('items.employee')))->response();
    }
}
