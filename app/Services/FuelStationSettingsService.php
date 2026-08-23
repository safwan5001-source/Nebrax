<?php

namespace App\Services;

use App\Models\FuelStation;
use App\Models\FuelStationConfigurationEvent;
use App\Models\FuelStationSettingOverride;
use App\Models\User;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * مصدر قرار الإعدادات الوحيد لمحطات الوقود.
 *
 * ترتيب الحسم ثابت: System Default → Tenant → Station → Device/Terminal.
 * افتراضات النظام والمستأجر موجودة في Settings::DEFAULTS/tenants.settings؛
 * أما المحطة والجهاز فيخزنان override محدوداً ومدققاً. لا يقرأ المتحكم هذه
 * القيم مباشرة كي لا تختلف قرارات API عن خدمات المجال لاحقاً.
 */
class FuelStationSettingsService
{
    public const GROUP = 'fuel_stations';

    /** @return array<string, mixed> */
    public function forTenant(): array
    {
        $this->requireTenantContext();

        return Settings::group(self::GROUP);
    }

    /** @return array<string, mixed> */
    public function forStation(FuelStation $station, ?string $deviceKey = null): array
    {
        $this->assertStationTenant($station);
        $settings = $this->forTenant();
        $overrides = FuelStationSettingOverride::query()
            ->where('fuel_station_id', $station->id)
            ->whereIn('device_key', ['', $this->deviceKey($deviceKey)])
            ->orderByRaw("CASE WHEN device_key = '' THEN 0 ELSE 1 END")
            ->get();

        foreach ($overrides as $override) {
            $settings[$override->setting_key] = $override->value;
        }

        return $settings;
    }

    public function get(FuelStation $station, string $key, ?string $deviceKey = null): mixed
    {
        $this->assertKnownKey($key);

        return $this->forStation($station, $deviceKey)[$key];
    }

    /** @param array<string, mixed> $values @return array<string, mixed> */
    public function putTenant(array $values, ?User $actor = null, ?string $reason = null): array
    {
        $this->requireTenantContext();
        $current = Settings::group(self::GROUP);
        $known = $this->knownValues($values);
        $changed = [];
        foreach ($known as $key => $value) {
            if ($current[$key] !== $value) {
                $changed[$key] = ['before' => $current[$key], 'after' => $value];
            }
        }

        if ($changed === []) {
            return $current;
        }

        return DB::transaction(function () use ($known, $changed, $actor, $reason) {
            $saved = Settings::put(self::GROUP, $known);
            foreach ($changed as $key => $change) {
                FuelStationConfigurationEvent::create([
                    'fuel_station_id' => null,
                    'device_key' => '',
                    'setting_key' => $key,
                    'before' => ['value' => $change['before']],
                    'after' => ['value' => $change['after']],
                    'changed_by' => $actor?->id,
                    'reason' => $reason,
                    'changed_at' => now(),
                ]);
            }

            return $saved;
        });
    }

    public function putStation(FuelStation $station, string $key, mixed $value, ?User $actor = null, ?string $reason = null): FuelStationSettingOverride
    {
        return $this->putOverride($station, $key, $value, null, $actor, $reason);
    }

    public function putDevice(FuelStation $station, string $deviceKey, string $key, mixed $value, ?User $actor = null, ?string $reason = null): FuelStationSettingOverride
    {
        if (trim($deviceKey) === '') {
            throw new RuntimeException('معرّف الجهاز مطلوب لإعداد override على مستوى الجهاز.');
        }

        return $this->putOverride($station, $key, $value, $deviceKey, $actor, $reason);
    }

    private function putOverride(FuelStation $station, string $key, mixed $value, ?string $deviceKey, ?User $actor, ?string $reason): FuelStationSettingOverride
    {
        $this->assertStationTenant($station);
        $this->assertKnownKey($key);
        $deviceKey = $this->deviceKey($deviceKey);

        return DB::transaction(function () use ($station, $key, $value, $deviceKey, $actor, $reason) {
            $existing = FuelStationSettingOverride::query()
                ->where('fuel_station_id', $station->id)
                ->where('device_key', $deviceKey)
                ->where('setting_key', $key)
                ->lockForUpdate()
                ->first();
            $before = $existing?->value;

            if ($existing !== null && $before === $value) {
                return $existing;
            }

            $override = $existing ?? new FuelStationSettingOverride([
                'fuel_station_id' => $station->id,
                'device_key' => $deviceKey,
                'setting_key' => $key,
            ]);
            $override->value = $value;
            $override->updated_at = now();
            $override->save();

            FuelStationConfigurationEvent::create([
                'fuel_station_id' => $station->id,
                'device_key' => $deviceKey,
                'setting_key' => $key,
                'before' => ['value' => $before],
                'after' => ['value' => $value],
                'changed_by' => $actor?->id,
                'reason' => $reason,
                'changed_at' => now(),
            ]);

            return $override->fresh();
        });
    }

    /** @param array<string, mixed> $values @return array<string, mixed> */
    private function knownValues(array $values): array
    {
        $known = [];
        foreach ($values as $key => $value) {
            $this->assertKnownKey($key);
            $known[$key] = $value;
        }

        return $known;
    }

    private function assertKnownKey(string $key): void
    {
        if (! array_key_exists($key, Settings::DEFAULTS[self::GROUP])) {
            throw new RuntimeException('مفتاح إعداد محطات الوقود غير معروف.');
        }
    }

    private function requireTenantContext(): void
    {
        if (! app(TenantContext::class)->has()) {
            throw new RuntimeException('إعدادات محطات الوقود تتطلب سياق مستأجر موثوقاً.');
        }
    }

    private function assertStationTenant(FuelStation $station): void
    {
        $this->requireTenantContext();
        if ($station->tenant_id !== app(TenantContext::class)->id()) {
            throw new RuntimeException('المحطة لا تنتمي إلى المستأجر النشط.');
        }
    }

    private function deviceKey(?string $deviceKey): string
    {
        return trim((string) $deviceKey);
    }
}
