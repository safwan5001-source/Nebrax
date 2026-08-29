<?php

namespace App\Services\DocumentCenter;

use App\Models\DocumentBatch;
use App\Models\User;
use Illuminate\Support\Collection;

/** يحسب مرشحي المراجعة بشرط واحد مع `DocumentReviewService::assign()`. */
final class DocumentReviewerEligibilityService
{
    /** @return Collection<int, User> */
    public function forBatch(DocumentBatch $batch): Collection
    {
        return $this->eligible($batch->tenant_id, $batch->branch_id);
    }

    /** @return Collection<int, User> */
    public function forBranch(string $tenantId, ?string $branchId): Collection
    {
        return $this->eligible($tenantId, $branchId);
    }

    /** @return Collection<int, User> */
    private function eligible(string $tenantId, ?string $branchId): Collection
    {
        return User::query()
            ->where('tenant_id', $tenantId)
            ->where('is_active', true)
            ->orderBy('name')
            ->get()
            ->filter(fn (User $user): bool => $user->hasPermission('documents.center.review') && $user->canAccessBranch($branchId))
            ->values();
    }
}
