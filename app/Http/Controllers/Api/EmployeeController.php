<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreEmployeeRequest;
use App\Http\Requests\UpdateEmployeeRequest;
use App\Http\Resources\EmployeeResource;
use App\Models\Branch;
use App\Models\Employee;
use App\Models\Shift;
use App\Tenancy\BranchScope;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class EmployeeController extends ApiController
{
    public function index(): JsonResponse
    {
        return EmployeeResource::collection(Employee::with('manager')->latest()->get())->response();
    }

    public function store(StoreEmployeeRequest $request): JsonResponse
    {
        $data = $request->validated();
        $this->assertTenantOwned(Branch::class, $data['branch_id'] ?? null, 'الفرع');
        $this->assertTenantOwned(Employee::class, $data['manager_id'] ?? null, 'المدير المباشر');
        $this->assertOwnedShift($data['shift_id'] ?? null);
        // الترقيم داخل معاملة: قفل المِرساة في طبقة الترقيم لا يُسلسِل شيئاً بدونها.
        $employee = DB::transaction(function () use ($data) {
            $data['employee_no'] ??= Employee::nextDocumentNumber('EMP');

            return Employee::create($data);
        });

        return (new EmployeeResource($employee->load('manager')))->response()->setStatusCode(201);
    }

    public function show(string $id): JsonResponse
    {
        return (new EmployeeResource(Employee::with('manager')->findOrFail($id)))->response();
    }

    public function update(UpdateEmployeeRequest $request, string $id): JsonResponse
    {
        $employee = Employee::findOrFail($id);
        $data = $request->validated();

        if (($data['manager_id'] ?? null) === $id) {
            abort(422, 'لا يمكن أن يكون الموظف مديره المباشر.');
        }

        $this->assertTenantOwned(Branch::class, $data['branch_id'] ?? null, 'الفرع');
        $this->assertTenantOwned(Employee::class, $data['manager_id'] ?? null, 'المدير المباشر');
        $this->assertOwnedShift($data['shift_id'] ?? null);
        $employee->update($data);

        return (new EmployeeResource($employee->load('manager')))->response();
    }

    /**
     * `Shift` مصنَّفٌ `BranchScoped`، فـ`assertTenantOwned` العادي يُصفّى
     * بالفرع النشط ويُخطئ رفض ورديةٍ صحيحة تخصّ فرعاً آخر. الموظف `CompanyWide`
     * يجوز ربطه بوردية أيّ فرع، فالتحقّق هنا **مرجعٌ** يتجاوز عزل الفرع عمداً
     * (نمط `BranchScope::reference`) ويبقي عزل المستأجر وحده.
     */
    private function assertOwnedShift(?string $shiftId): void
    {
        if ($shiftId !== null && ! BranchScope::reference(Shift::class)->whereKey($shiftId)->exists()) {
            abort(422, 'الوردية غير موجودة.');
        }
    }

    public function destroy(string $id): JsonResponse
    {
        Employee::findOrFail($id)->delete();

        return response()->json(['message' => 'تم الحذف.']);
    }
}
