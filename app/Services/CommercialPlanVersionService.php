<?php

namespace App\Services;

use App\Models\CommercialPlanVersion;
use App\Models\CommercialPlanVersionProduct;
use App\Models\CommercialProductVersion;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use LogicException;

class CommercialPlanVersionService
{
    /** @param list<CommercialProductVersion> $productVersions */
    public function setProducts(CommercialPlanVersion $planVersion, array $productVersions): void
    {
        if ($planVersion->published_at !== null) throw new LogicException('A published plan composition is immutable.');
        $ids = [];
        foreach ($productVersions as $productVersion) {
            if ($productVersion->published_at === null) throw ValidationException::withMessages(['products' => 'Plan versions may reference only published product versions.']);
            $ids[$productVersion->getKey()] = true;
        }
        DB::transaction(function () use ($planVersion, $ids): void {
            $planVersion->products()->delete();
            foreach (array_keys($ids) as $id) {
                CommercialPlanVersionProduct::create(['commercial_plan_version_id' => $planVersion->getKey(), 'commercial_product_version_id' => $id]);
            }
        });
    }

    public function publish(CommercialPlanVersion $planVersion): CommercialPlanVersion
    {
        if ($planVersion->published_at !== null) return $planVersion;
        if (! $planVersion->products()->exists()) throw ValidationException::withMessages(['products' => 'A plan version must contain products before publication.']);
        $planVersion->forceFill(['published_at' => now('UTC')])->save();
        return $planVersion->refresh();
    }
}
