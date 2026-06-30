<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreExpenseRequest;
use App\Http\Resources\ExpenseResource;
use App\Models\Expense;
use App\Models\Partner;
use App\Services\Accounting\ExpenseService;
use Illuminate\Http\JsonResponse;

class ExpenseController extends ApiController
{
    public function __construct(protected ExpenseService $expenses) {}

    public function index(): JsonResponse
    {
        return ExpenseResource::collection(Expense::with('account')->latest()->get())->response();
    }

    public function store(StoreExpenseRequest $request): JsonResponse
    {
        $data = $request->validated();
        if (! empty($data['partner_id'])) {
            Partner::findOrFail($data['partner_id']); // عزل: المورّد يخص المستأجر
        }

        $expense = $this->domain(fn () => $this->expenses->create($data));

        return (new ExpenseResource($expense->load('account')))->response()->setStatusCode(201);
    }

    public function show(string $id): JsonResponse
    {
        return (new ExpenseResource(Expense::with('account')->findOrFail($id)))->response();
    }

    public function post(string $id): JsonResponse
    {
        $expense = Expense::findOrFail($id);
        $posted = $this->domain(fn () => $this->expenses->post($expense));

        return (new ExpenseResource($posted->load('account')))->response();
    }
}
