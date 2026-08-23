<?php

namespace App\Services;

use App\Models\CommercialProductVersion;
use App\Models\CommercialProductVersionCapability;
use App\Support\ApplicationCatalog;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use LogicException;

class CommercialProductVersionService
{
    /** @param list<string> $capabilityKeys */
    public function setCapabilities(CommercialProductVersion $version, array $capabilityKeys): void
    {
        if ($version->published_at !== null) throw new LogicException('A published product composition is immutable.');
        $keys = array_values($capabilityKeys);
        if (count($keys) !== count(array_unique($keys))) {
            throw ValidationException::withMessages(['capability_keys' => 'A product version cannot contain duplicate capabilities.']);
        }
        $invalid = array_values(array_filter($keys, fn (string $key): bool => ! ApplicationCatalog::isActivatable($key)));
        if ($invalid !== []) throw ValidationException::withMessages(['capability_keys' => 'Unknown or unbuilt capabilities: '.implode(', ', $invalid)]);

        $missingDependencies = [];
        foreach ($keys as $key) {
            foreach (ApplicationCatalog::dependenciesFor($key) as $dependency) {
                if (! in_array($dependency, $keys, true)) $missingDependencies[] = "{$key} requires {$dependency}";
            }
        }
        if ($missingDependencies !== []) throw ValidationException::withMessages(['capability_keys' => 'Dependency closure is incomplete: '.implode(', ', $missingDependencies)]);

        DB::transaction(function () use ($version, $keys): void {
            $version->capabilities()->delete();
            foreach ($keys as $key) {
                CommercialProductVersionCapability::create([
                    'commercial_product_version_id' => $version->getKey(), 'capability_key' => $key,
                ]);
            }
        });
    }

    public function publish(CommercialProductVersion $version): CommercialProductVersion
    {
        if ($version->published_at !== null) return $version;
        if (! $version->capabilities()->exists()) throw ValidationException::withMessages(['capabilities' => 'A product version must contain capabilities before publication.']);
        $version->forceFill(['published_at' => now('UTC')])->save();

        return $version->refresh();
    }

    public function retire(CommercialProductVersion $version): CommercialProductVersion
    {
        if ($version->published_at === null) {
            throw ValidationException::withMessages(['product_version' => 'Only published product versions may be retired.']);
        }
        if ($version->retired_at !== null) return $version;

        $version->forceFill(['retired_at' => now('UTC')])->save();

        return $version->refresh();
    }
}
