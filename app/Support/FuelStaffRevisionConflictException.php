<?php

namespace App\Support;

use Exception;
use Illuminate\Http\JsonResponse;

/**
 * FUEL-B3: تعارض تعديل إسناد موظف وقود — `expected_revision` لا يطابق الحالة الحالية (عدّل مدير آخر في الأثناء).
 * 409 بجسم `{message, reason: "staff_revision_conflict", current_revision}` وبلا أي كتابة. لا يرث `RuntimeException` عمداً
 * (وإلا حوّله `ApiController::domain()` إلى 422).
 */
class FuelStaffRevisionConflictException extends Exception
{
    public function __construct(public readonly string $currentRevision)
    {
        parent::__construct('تغيّر إسناد هذا الموظف منذ قراءتك له. أعد التحميل وراجع الحالة الحالية قبل الحفظ.');
    }

    public function render(): JsonResponse
    {
        return response()->json([
            'message' => $this->getMessage(),
            'reason' => 'staff_revision_conflict',
            'current_revision' => $this->currentRevision,
        ], 409);
    }
}
