<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreAccountRequest;
use App\Http\Resources\AccountResource;
use App\Models\Account;
use App\Services\Accounting\AccountManagementService;
use Illuminate\Http\JsonResponse;

class AccountController extends ApiController
{
    /**
     * القائمة مسطحة بـ parent_id؛ تبني الواجهة الشجرة محلياً حتى تبقى قابلة للبحث
     * والفرز ولا تختفي الحسابات ذات الأب المفقود في بيانات قديمة.
     */
    public function index(): JsonResponse
    {
        return AccountResource::collection(
            Account::with('balance')->withCount(['children', 'lines'])->orderBy('code')->get()
        )->response();
    }

    public function show(string $id): JsonResponse
    {
        return (new AccountResource(
            Account::with('balance')->withCount(['children', 'lines'])->findOrFail($id)
        ))->response();
    }

    /**
     * ينشئ حساباً مخصصاً فقط؛ لا يصدر أي قيد أو يعدّل أرصدة قائمة.
     */
    public function store(StoreAccountRequest $request, AccountManagementService $accounts): JsonResponse
    {
        return $this->domain(function () use ($request, $accounts) {
            $account = $accounts->create($request->validated());

            return (new AccountResource($account))->response()->setStatusCode(201);
        });
    }

    /**
     * تعديل بنية الحساب المخصص. الخدمة تمنع تعديل الحسابات النظامية أو أي تغيير
     * بنيوي يحرّف تفسير الحركات التاريخية.
     */
    public function update(StoreAccountRequest $request, string $id, AccountManagementService $accounts): JsonResponse
    {
        // يبقى العثور خارج domain(): حساب مستأجر آخر يجب أن يرجع 404، لا 422.
        $account = Account::findOrFail($id);

        return $this->domain(function () use ($request, $account, $accounts) {
            $account = $accounts->update($account, $request->validated());

            return (new AccountResource($account))->response();
        });
    }
}
