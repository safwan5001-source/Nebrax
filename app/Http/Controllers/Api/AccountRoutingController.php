<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\UpdateAccountRoleMappingRequest;
use App\Services\Accounting\AccountRoutingService;
use App\Services\Accounting\VatRoleMappingException;
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
        return $this->mappingResponse(
            fn () => $this->routing->setMapping($roleKey, $request->validated('account_id'), $request->user())
        );
    }

    public function reset(string $roleKey): JsonResponse
    {
        return $this->mappingResponse(fn () => $this->routing->reset($roleKey, request()->user()));
    }

    /**
     * رفضُ تعيينٍ ضريبي غير مؤهَّل ⇒ 422 بنفس شكل `domain()` (`message`) مع `reason` إضافي ثابت.
     * أيّ RuntimeException آخر يبقى على مساره القائم (422 برسالته).
     */
    private function mappingResponse(\Closure $fn): JsonResponse
    {
        $result = $this->domain(function () use ($fn) {
            try {
                return $fn();
            } catch (VatRoleMappingException $e) {
                return response()->json(['message' => $e->getMessage(), 'reason' => $e->reason], 422);
            }
        });

        return $result instanceof JsonResponse ? $result : response()->json(['data' => $result]);
    }
}
