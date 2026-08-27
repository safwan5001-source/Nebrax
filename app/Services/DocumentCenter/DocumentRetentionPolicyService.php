<?php

namespace App\Services\DocumentCenter;

use App\Models\DocumentRetentionPolicy;
use App\Models\DocumentRetentionRun;
use App\Models\PlatformAdministrator;

final class DocumentRetentionPolicyService
{
    /** @return array{policy:?DocumentRetentionPolicy,retention_days:int,enabled:bool,purge_mode:string,last_run:?DocumentRetentionRun} */
    public function effective(): array
    {
        $policy = DocumentRetentionPolicy::query()->where('policy_key', DocumentRetentionPolicy::DEFAULT_KEY)->first();

        return [
            'policy' => $policy,
            'retention_days' => $policy?->retention_days ?? max(1, (int) config('document_center.intake.retention_days', 365)),
            'enabled' => $policy?->enabled ?? true,
            'purge_mode' => $policy?->purge_mode ?? DocumentRetentionPolicy::PURGE_MODE_MANUAL_GOVERNED,
            'last_run' => DocumentRetentionRun::query()->latest('created_at')->first(),
        ];
    }

    public function update(int $retentionDays, bool $enabled, ?PlatformAdministrator $actor): DocumentRetentionPolicy
    {
        $policy = DocumentRetentionPolicy::query()->firstOrNew(['policy_key' => DocumentRetentionPolicy::DEFAULT_KEY]);
        $policy->fill([
            'retention_days' => max(1, min(3650, $retentionDays)),
            'enabled' => $enabled,
            'purge_mode' => DocumentRetentionPolicy::PURGE_MODE_MANUAL_GOVERNED,
            'updated_by' => $actor?->id,
        ])->save();

        return $policy->fresh();
    }
}
