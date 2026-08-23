<?php

namespace App\Services;

use App\Models\Account;
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
            // Settings::put لا يكتب null (يعني «اتركه»)، لذا الفراغ الصريح هو
            // مسح mapping الحساب والعودة إلى fallback الموثق لمحرك الجرد.
            $normalized = in_array($key, ['inventory_variance_account_id', 'inventory_gain_account_id', 'grni_account_id'], true) && $value === null ? '' : $value;
            $known[$key] = $normalized;
            if ($current[$key] !== $normalized) {
                $changed[$key] = ['before' => $current[$key], 'after' => $normalized];
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

    /** @param array<string, mixed> $values @return array<string, mixed> */
    public function putStationValues(FuelStation $station, array $values, ?User $actor = null, ?string $reason = null): array
    {
        $this->assertStationTenant($station);
        $known = [];
        foreach ($values as $key => $value) {
            $this->assertKnownKey($key);
            if ($value !== null) {
                $this->assertValue($key, $value);
            }
            $known[$key] = $value;
        }

        return DB::transaction(function () use ($station, $known, $actor, $reason) {
            foreach ($known as $key => $value) {
                if ($value === null) {
                    $this->clearStation($station, $key, $actor, $reason);
                    continue;
                }
                $this->putStation($station, $key, $value, $actor, $reason);
            }

            return $this->forStation($station);
        });
    }

    public function clearStation(FuelStation $station, string $key, ?User $actor = null, ?string $reason = null): void
    {
        $this->assertStationTenant($station);
        $this->assertKnownKey($key);

        DB::transaction(function () use ($station, $key, $actor, $reason) {
            $existing = FuelStationSettingOverride::query()
                ->where('fuel_station_id', $station->id)
                ->where('device_key', '')
                ->where('setting_key', $key)
                ->lockForUpdate()
                ->first();
            if ($existing === null) {
                return;
            }

            $before = $existing->value;
            $existing->delete();
            FuelStationConfigurationEvent::create([
                'fuel_station_id' => $station->id,
                'device_key' => '',
                'setting_key' => $key,
                'before' => ['value' => $before],
                'after' => ['value' => null],
                'changed_by' => $actor?->id,
                'reason' => $reason,
                'changed_at' => now(),
            ]);
        });
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
        $this->assertValue($key, $value);
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
            $this->assertValue($key, $value);
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

    private function assertValue(string $key, mixed $value): void
    {
        if (in_array($key, ['reconciliation_tolerance_absolute_milliliters', 'reconciliation_tolerance_basis_points'], true)) {
            if (! is_int($value) || $value < 0 || ($key === 'reconciliation_tolerance_basis_points' && $value > 1000000)) {
                throw new RuntimeException('حدود تسوية الوقود يجب أن تكون أعداداً صحيحة غير سالبة ضمن المدى المسموح.');
            }

            return;
        }

        if (in_array($key, ['inventory_variance_account_id', 'inventory_gain_account_id', 'grni_account_id'], true)) {
            if ($value === null || $value === '') {
                return;
            }
            if (! is_string($value) || ! $this->accountAllowedFor($key, $value)) {
                throw new RuntimeException('حساب الوقود يجب أن يكون نشطاً وقابلاً للترحيل ومن نفس المستأجر وباتجاهه المحاسبي الصحيح.');
            }
        }
    }

    private function accountAllowedFor(string $key, string $id): bool
    {
        $account = Account::whereKey($id)->first();
        if (! $account || $account->is_group || ! $account->is_active) {
            return false;
        }

        return match ($key) {
            'inventory_variance_account_id' => $account->type === 'expense',
            'inventory_gain_account_id' => in_array($account->type, ['expense', 'revenue'], true),
            'grni_account_id' => $account->type === 'liability',
            default => false,
        };
    }

    /**
     * GRNI لا يملك fallback: الاستلام المعتمد لا يثبت التزاماً مؤقتاً في حساب
     * افتراضي أو عام. يلزم أن يحدد المستأجر أو المحطة حساب التزام صريحاً.
     */
    public function grniAccountFor(FuelStation $station): Account
    {
        $id = $this->get($station, 'grni_account_id');
        if (! is_string($id) || $id === '' || ! $this->accountAllowedFor('grni_account_id', $id)) {
            throw new RuntimeException('لا يمكن اعتماد استلام الوقود قبل تعيين حساب GRNI / مخزون مستلم غير مفوتر صالح للمحطة أو المستأجر.');
        }

        return Account::findOrFail($id);
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
