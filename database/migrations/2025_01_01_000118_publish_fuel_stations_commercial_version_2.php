<?php

use App\Models\CommercialProduct;
use App\Models\CommercialProductVersion;
use App\Services\CommercialProductVersionService;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    private const PRODUCT_CODE = 'fuel-stations';

    /** @var list<string> */
    private const CAPABILITY_KEYS = [
        'fuel_stations.core',
        'fuel_stations.avi',
        'fuel_stations.integrations',
        'fuel_stations.maintenance',
    ];

    public function up(): void
    {
        DB::transaction(function (): void {
            $product = CommercialProduct::query()
                ->where('code', self::PRODUCT_CODE)
                ->first();

            if ($product === null) {
                throw new LogicException('Fuel Stations commercial Version 1 must exist before publishing Version 2.');
            }

            $v1 = $product->versions()->where('version', 1)->first();
            if ($v1 === null || $v1->published_at === null) {
                throw new LogicException('Fuel Stations commercial Version 1 must remain published before Version 2 is introduced.');
            }

            $version = $product->versions()->where('version', 2)->first();
            if ($version === null) {
                $version = CommercialProductVersion::create([
                    'commercial_product_id' => $product->id,
                    'version' => 2,
                ]);
            }

            $expected = self::CAPABILITY_KEYS;
            sort($expected);
            $actual = $version->capabilities()->pluck('capability_key')->all();
            sort($actual);

            if ($version->published_at !== null) {
                if ($actual !== $expected) {
                    throw new LogicException('Published Fuel Stations commercial Version 2 has an unexpected immutable capability composition.');
                }

                return;
            }

            $versions = app(CommercialProductVersionService::class);
            $versions->setCapabilities($version, self::CAPABILITY_KEYS);
            $versions->publish($version);
        });
    }

    public function down(): void
    {
        // Commercial history is intentionally retained: Version 2 may be referenced by
        // later Platform Admin assignments, entitlement grants, or audit records.
    }
};
