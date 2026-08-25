<?php

namespace App\Services\DocumentCenter;

use App\Contracts\DraftBuildOptions;

/** خيارات غير مالية تخص تطبيق مسودة الشراء فقط. */
final readonly class PurchaseDraftBuildOptions implements DraftBuildOptions
{
    public function __construct(
        public ?string $warehouseId,
        public ?string $costCenterId,
    ) {
    }
}
