<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreAccountRequest;
use App\Http\Resources\AccountResource;
use App\Http\Resources\AccountWorkspaceResource;
use App\Models\Account;
use App\Services\Accounting\AccountManagementService;
use App\Services\Accounting\AccountWorkspaceService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class AccountController extends ApiController
{
    /**
     * القائمة القديمة تبقى مسطحة بـ parent_id للتوافق مع المستهلكين القائمين.
     */
    public function index(): JsonResponse
    {
        return AccountResource::collection(
            Account::with('balance')->withCount(['children', 'lines'])->orderBy('code')->get()
        )->response();
    }

    /**
     * القراءة الغنية لمساحة عمل دليل الحسابات. تظل البنية CompanyWide، بينما
     * يتغير الرصيد فقط عند اختيار فرع القيود.
     */
    public function workspace(Request $request, AccountWorkspaceService $workspace): JsonResponse
    {
        $data = $request->validate([
            'branch_id' => ['nullable', 'uuid'],
        ]);

        return AccountWorkspaceResource::collection(
            $workspace->accounts($data['branch_id'] ?? null)
        )->response();
    }

    /**
     * اقتراح قابل للتحرير لكود حساب جديد. لا ينشئ هذا المسار حساباً ولا يحجز
     * رقماً؛ القيد الفريد وخدمة الإنشاء يظلان مصدر الحماية عند الحفظ.
     */
    public function suggestCode(Request $request, AccountManagementService $accounts): JsonResponse
    {
        $data = $request->validate([
            'parent_id' => ['nullable', 'uuid'],
            'type' => ['required', Rule::in(['asset', 'liability', 'equity', 'revenue', 'expense'])],
        ]);

        return response()->json([
            'data' => [
                'code' => $accounts->suggestNextCode($data['parent_id'] ?? null, $data['type']),
            ],
        ]);
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
