<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\UpdateAccountRoleMappingRequest;
use App\Services\Accounting\AccountRoutingService;
use Illuminate\Http\JsonResponse;

/**
 * ACC-2: توجيه الحسابات — عرض/تعديل/إعادة ضبط تعيينات الأدوار المحاسبية
 * الدلالية لكل مستأجر. لا علاقة له بأي مسار ترحيل بعد (zero posting consumers).
 */
class AccountRoutingController extends ApiController
{
    public function __construct(private AccountRoutingService $routing) {}

    public function index(): JsonResponse
    {
        return response()->json(['data' => $this->routing->list()]);
    }

    public function update(UpdateAccountRoleMappingRequest $request, string $roleKey): JsonResponse
    {
        $mapping = $this->domain(
            fn () => $this->routing->setMapping($roleKey, $request->validated('account_id'), $request->user())
        );

        return response()->json(['data' => $mapping]);
    }

    public function reset(string $roleKey): JsonResponse
    {
        $mapping = $this->domain(fn () => $this->routing->reset($roleKey, request()->user()));

        return response()->json(['data' => $mapping]);
    }
}
