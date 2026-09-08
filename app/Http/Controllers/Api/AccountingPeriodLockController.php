<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\ReleaseAccountingPeriodLockRequest;
use App\Http\Requests\StoreAccountingPeriodLockRequest;
use App\Services\Accounting\AccountingPeriodLockService;
use Illuminate\Http\JsonResponse;

/**
 * ACC-6 — أقفال الفترات المحاسبية: عرض · إنشاء · تحرير.
 *
 * **لا مسار حذف ولا تعديل في المكان** بقرارٍ من عقد ACC-6: تصحيح نطاق قائم
 * يتمّ بتحريره بسببٍ مسجَّل ثم إنشاء البديل، فيبقى التاريخ الإداري كاملاً.
 * ولا مسار «تجاوز» لعملية واحدة — الترحيل داخل فترة مقفلة يوجب تحريرها.
 */
class AccountingPeriodLockController extends ApiController
{
    public function __construct(private AccountingPeriodLockService $locks) {}

    public function index(): JsonResponse
    {
        return response()->json(['data' => $this->locks->list()]);
    }

    public function events(string $id): JsonResponse
    {
        return response()->json(['data' => $this->locks->events($id)]);
    }

    public function store(StoreAccountingPeriodLockRequest $request): JsonResponse
    {
        $lock = $this->domain(fn () => $this->locks->create(
            $request->validated('start_date'),
            $request->validated('end_date'),
            $request->validated('reason'),
            $request->user(),
        ));

        return response()->json(['data' => $lock], 201);
    }

    public function release(ReleaseAccountingPeriodLockRequest $request, string $id): JsonResponse
    {
        $lock = $this->domain(fn () => $this->locks->release(
            $id,
            $request->validated('reason'),
            $request->user(),
        ));

        return response()->json(['data' => $lock]);
    }
}
