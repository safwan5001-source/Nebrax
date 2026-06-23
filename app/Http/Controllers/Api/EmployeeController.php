<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreEmployeeRequest;
use App\Http\Requests\UpdateEmployeeRequest;
use App\Http\Resources\EmployeeResource;
use App\Models\Employee;
use Illuminate\Http\JsonResponse;

class EmployeeController extends ApiController
{
    public function index(): JsonResponse
    {
        return EmployeeResource::collection(Employee::latest()->get())->response();
    }

    public function store(StoreEmployeeRequest $request): JsonResponse
    {
        $data = $request->validated();
        $data['employee_no'] ??= $this->nextEmployeeNo();

        $employee = Employee::create($data);

        return (new EmployeeResource($employee))->response()->setStatusCode(201);
    }

    public function show(string $id): JsonResponse
    {
        return (new EmployeeResource(Employee::findOrFail($id)))->response();
    }

    public function update(UpdateEmployeeRequest $request, string $id): JsonResponse
    {
        $employee = Employee::findOrFail($id);
        $employee->update($request->validated());

        return (new EmployeeResource($employee))->response();
    }

    public function destroy(string $id): JsonResponse
    {
        Employee::findOrFail($id)->delete();

        return response()->json(['message' => 'تم الحذف.']);
    }

    /** توليد رقم موظف تسلسلي: EMP-00001 */
    protected function nextEmployeeNo(): string
    {
        return sprintf('EMP-%05d', Employee::count() + 1);
    }
}
