<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreCashBankAccountRequest;
use App\Http\Requests\StoreCashBankTransferRequest;
use App\Http\Resources\CashBankAccountResource;
use App\Http\Resources\CashBankTransferResource;
use App\Models\CashBankAccount;
use App\Models\CashBankTransfer;
use App\Services\Accounting\CashBankAccountService;
use App\Services\Accounting\CashBankTransferService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CashBankAccountController extends ApiController
{
    public function __construct(
        protected CashBankAccountService $cashBankAccounts,
        protected CashBankTransferService $cashBankTransfers,
    ) {}

    public function index(): JsonResponse
    {
        return CashBankAccountResource::collection(
            CashBankAccount::with('account.balance')->orderBy('type')->orderByDesc('is_main')->orderBy('name')->get()
        )->response();
    }

    public function show(string $id): JsonResponse
    {
        return (new CashBankAccountResource($this->entity($id)->load('account.balance')))->response();
    }

    public function store(StoreCashBankAccountRequest $request): JsonResponse
    {
        $entity = $this->domain(fn () => $this->cashBankAccounts->create($request->validated(), $request->user()));
        return (new CashBankAccountResource($entity))->response()->setStatusCode(201);
    }

    public function update(StoreCashBankAccountRequest $request, string $id): JsonResponse
    {
        $entity = $this->entity($id);
        $data = $request->validated();
        if ($data['type'] !== $entity->type) {
            abort(422, 'لا يمكن تغيير نوع خزينة أو حساب بنكي قائم. أنشئ حساباً جديداً.');
        }

        $updated = $this->domain(fn () => $this->cashBankAccounts->update($entity, $data));
        return (new CashBankAccountResource($updated))->response();
    }

    public function deactivate(string $id): JsonResponse
    {
        $updated = $this->domain(fn () => $this->cashBankAccounts->deactivate($this->entity($id)));
        return (new CashBankAccountResource($updated))->response();
    }

    public function makeMain(string $id): JsonResponse
    {
        $updated = $this->domain(fn () => $this->cashBankAccounts->makeMain($this->entity($id)));
        return (new CashBankAccountResource($updated))->response();
    }

    public function destroy(string $id): JsonResponse
    {
        $this->domain(fn () => $this->cashBankAccounts->delete($this->entity($id)));
        return response()->json(['message' => 'deleted']);
    }

    public function transfers(Request $request): JsonResponse
    {
        $query = CashBankTransfer::with(['source', 'destination'])->latest('transfer_date');
        if ($request->query('cash_bank_account_id')) {
            $accountId = $request->query('cash_bank_account_id');
            $query->where(fn ($q) => $q->where('source_cash_bank_account_id', $accountId)->orWhere('destination_cash_bank_account_id', $accountId));
        }

        return CashBankTransferResource::collection($this->scopeToActiveBranch($query, $request)->get())->response();
    }

    public function transfer(StoreCashBankTransferRequest $request): JsonResponse
    {
        $data = $request->validated();
        $this->assertTenantOwned(CashBankAccount::class, $data['source_cash_bank_account_id'], 'الخزينة المصدر');
        $this->assertTenantOwned(CashBankAccount::class, $data['destination_cash_bank_account_id'], 'الخزينة الوجهة');

        $transfer = $this->domain(fn () => $this->cashBankTransfers->transfer($data, $request->user()));
        return (new CashBankTransferResource($transfer))->response()->setStatusCode(201);
    }

    private function entity(string $id): CashBankAccount
    {
        return CashBankAccount::findOrFail($id);
    }
}
