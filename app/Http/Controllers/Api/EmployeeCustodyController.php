<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreEmployeeCustodyRequest;
use App\Http\Resources\EmployeeCustodyResource;
use App\Models\Account;
use App\Models\Employee;
use App\Models\EmployeeCustody;
use App\Services\Accounting\EmployeeCustodyService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class EmployeeCustodyController extends ApiController
{
    public function __construct(protected EmployeeCustodyService $custodies) {}

    public function index(Request $request): JsonResponse
    {
        $query = EmployeeCustody::query()->with('employee');

        if (in_array($request->query('status'), ['draft', 'posted'], true)) {
            $query->where('status', $request->query('status'));
        }
        if ($request->filled('employee_id')) {
            $query->where('employee_id', $request->query('employee_id'));
        }
        if ($request->filled('search')) {
            $search = trim((string) $request->query('search'));
            $query->where(function ($builder) use ($search) {
                $builder->where('number', 'like', "%{$search}%")
                    ->orWhereHas('employee', fn ($employees) => $employees
                        ->where('name', 'like', "%{$search}%")
                        ->orWhere('employee_no', 'like', "%{$search}%"));
            });
        }

        return EmployeeCustodyResource::collection(
            $this->scopeToActiveBranch($query->latest('custody_date'), $request)->get()
        )->response();
    }

    public function store(StoreEmployeeCustodyRequest $request): JsonResponse
    {
        $data = $request->validated();
        $this->assertReferences($data);

        $custody = $this->domain(fn () => $this->custodies->create($data));

        return (new EmployeeCustodyResource($this->loadRelations($custody)))
            ->response()
            ->setStatusCode(201);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        return (new EmployeeCustodyResource($this->loadRelations($this->visibleCustody($request, $id))))->response();
    }

    public function update(StoreEmployeeCustodyRequest $request, string $id): JsonResponse
    {
        $custody = $this->visibleCustody($request, $id);
        $data = $request->validated();
        $this->assertReferences($data);

        $updated = $this->domain(fn () => $this->custodies->update($custody, $data));

        return (new EmployeeCustodyResource($this->loadRelations($updated)))->response();
    }

    public function duplicate(Request $request, string $id): JsonResponse
    {
        $custody = $this->visibleCustody($request, $id);
        $copy = $this->domain(fn () => $this->custodies->duplicate($custody, $request->user()?->id));

        return (new EmployeeCustodyResource($this->loadRelations($copy)))
            ->response()
            ->setStatusCode(201);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $custody = $this->visibleCustody($request, $id);
        if (! $custody->isDraft()) {
            abort(422, 'لا يمكن حذف عهدة مرحّلة.');
        }

        $this->domain(fn () => $custody->delete());

        return response()->json(['message' => 'deleted']);
    }

    public function post(Request $request, string $id): JsonResponse
    {
        $custody = $this->visibleCustody($request, $id);
        $posted = $this->domain(fn () => $this->custodies->post($custody, $request->user()));

        return (new EmployeeCustodyResource($this->loadRelations($posted)))->response();
    }

    /** العُهَد مستندات مالية موسومة بالفرع؛ كل عملية تلتزم بفرع العرض الفعّال. */
    private function visibleCustody(Request $request, string $id): EmployeeCustody
    {
        return $this->scopeToActiveBranch(EmployeeCustody::query(), $request)->whereKey($id)->firstOrFail();
    }

    private function loadRelations(EmployeeCustody $custody): EmployeeCustody
    {
        return $custody->load(['employee', 'custodyAccount', 'cashAccount', 'journalEntry']);
    }

    private function assertReferences(array $data): void
    {
        $this->assertTenantOwned(Employee::class, $data['employee_id'], 'الموظف');
        $this->assertTenantOwned(Account::class, $data['custody_account_id'] ?? null, 'حساب العهدة');
        $this->assertTenantOwned(Account::class, $data['cash_account_id'] ?? null, 'الخزينة أو الحساب البنكي');
    }
}
