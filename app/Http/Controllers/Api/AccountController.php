<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\AccountResource;
use App\Models\Account;
use Illuminate\Http\JsonResponse;

class AccountController extends ApiController
{
    public function index(): JsonResponse
    {
        return AccountResource::collection(
            Account::with('balance')->orderBy('code')->get()
        )->response();
    }

    public function show(string $id): JsonResponse
    {
        return (new AccountResource(Account::with('balance')->findOrFail($id)))->response();
    }
}
