<?php

namespace App\Services\DocumentCenter;

use App\Contracts\DraftBuildOptions;

/**
 * خيارات غير مالية يختارها المراجع من سجلات موجودة؛ مبلغ المصروف وضريبته
 * وتاريخه ومورده لا تمر من المتصفح بل من الدليل المراجع والسياق الموثوق.
 */
final readonly class ExpenseDraftBuildOptions implements DraftBuildOptions
{
    public function __construct(
        public string $accountId,
        public ?string $categoryId,
        public ?string $costCenterId,
        public string $paymentMethod,
    ) {
    }
}
