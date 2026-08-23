<?php

namespace App\Services;

use App\Models\FuelStation;
use App\Models\FuelStationDevice;
use App\Models\User;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * مالك دورة حياة أجهزة محطات الوقود. لا يتصل بأي جهاز ولا يفك اعتماداً؛
 * يقبل فقط metadata آمنة ومرجع credential غير قابل للاستخدام بذاته.
 */
class FuelStationDeviceService
{
    /** @var list<string> */
    private const TYPES = [
        FuelStationDevice::TYPE_FORECOURT_CONTROLLER,
        FuelStationDevice::TYPE_ATG,
        FuelStationDevice::TYPE_RFID_READER,
        FuelStationDevice::TYPE_PAYMENT_TERMINAL,
        FuelStationDevice::TYPE_STATION_GATEWAY,
    ];

    /** @var list<string> */
    private const STATUSES = [
        FuelStationDevice::STATUS_ACTIVE,
        FuelStationDevice::STATUS_DISABLED,
        FuelStationDevice::STATUS_RETIRED,
    ];

    public function create(array $data, User $actor): FuelStationDevice
    {
        $station = $this->station($data['fuel_station_id']);
        $deviceKey = $this->key($data['device_key'], 'معرف الجهاز');
        $type = $this->deviceType($data['device_type']);
        $adapterKey = $this->key($data['adapter_key'], 'معرف المحول');
        $this->assertDeviceKeyAvailable($deviceKey);

        return FuelStationDevice::create([
            'tenant_id' => $station->tenant_id,
            'branch_id' => $station->branch_id,
            'fuel_station_id' => $station->id,
            'device_key' => $deviceKey,
            'name' => $this->requiredText($data['name'], 'اسم الجهاز', 160),
            'device_type' => $type,
            'status' => $this->status($data['status'] ?? FuelStationDevice::STATUS_ACTIVE),
            'adapter_key' => $adapterKey,
            'manufacturer' => $this->nullableText($data['manufacturer'] ?? null, 120),
            'model' => $this->nullableText($data['model'] ?? null, 120),
            'serial_number' => $this->nullableText($data['serial_number'] ?? null, 160),
            'firmware_version' => $this->nullableText($data['firmware_version'] ?? null, 120),
            'protocol' => $this->nullableText($data['protocol'] ?? null, 64),
            'external_identifier' => $this->nullableText($data['external_identifier'] ?? null, 160),
            'endpoint_metadata' => $this->safeMetadata($data['endpoint_metadata'] ?? null),
            'credential_reference' => $this->credentialReference($data['credential_reference'] ?? null),
            'created_by' => $actor->id,
        ]);
    }

    public function update(FuelStationDevice $device, array $data, User $actor): FuelStationDevice
    {
        $this->assertDeviceTenant($device);

        return DB::transaction(function () use ($device, $data, $actor) {
            $device = FuelStationDevice::lockForUpdate()->findOrFail($device->id);
            $nextType = array_key_exists('device_type', $data) ? $this->deviceType($data['device_type']) : $device->device_type;
            $nextStatus = array_key_exists('status', $data) ? $this->status($data['status']) : $device->status;
            $nextKey = array_key_exists('device_key', $data) ? $this->key($data['device_key'], 'معرف الجهاز') : $device->device_key;
            $this->assertDeviceKeyAvailable($nextKey, $device->id);

            if ($device->events()->exists() && $nextKey !== $device->device_key) {
                throw new RuntimeException('لا يمكن تغيير معرف مصدر جهاز له أحداث تكامل مسجلة؛ عطّل الجهاز أو سجّل جهازاً جديداً.');
            }
            if ($device->status === FuelStationDevice::STATUS_RETIRED && $nextStatus !== FuelStationDevice::STATUS_RETIRED) {
                throw new RuntimeException('لا يمكن إعادة تفعيل جهاز متقاعد؛ أنشئ سجلاً جديداً لحفظ تاريخ المصدر.');
            }

            $device->update([
                'device_key' => $nextKey,
                'name' => array_key_exists('name', $data) ? $this->requiredText($data['name'], 'اسم الجهاز', 160) : $device->name,
                'device_type' => $nextType,
                'status' => $nextStatus,
                'adapter_key' => array_key_exists('adapter_key', $data) ? $this->key($data['adapter_key'], 'معرف المحول') : $device->adapter_key,
                'manufacturer' => array_key_exists('manufacturer', $data) ? $this->nullableText($data['manufacturer'], 120) : $device->manufacturer,
                'model' => array_key_exists('model', $data) ? $this->nullableText($data['model'], 120) : $device->model,
                'serial_number' => array_key_exists('serial_number', $data) ? $this->nullableText($data['serial_number'], 160) : $device->serial_number,
                'firmware_version' => array_key_exists('firmware_version', $data) ? $this->nullableText($data['firmware_version'], 120) : $device->firmware_version,
                'protocol' => array_key_exists('protocol', $data) ? $this->nullableText($data['protocol'], 64) : $device->protocol,
                'external_identifier' => array_key_exists('external_identifier', $data) ? $this->nullableText($data['external_identifier'], 160) : $device->external_identifier,
                'endpoint_metadata' => array_key_exists('endpoint_metadata', $data) ? $this->safeMetadata($data['endpoint_metadata']) : $device->endpoint_metadata,
                'credential_reference' => array_key_exists('credential_reference', $data) ? $this->credentialReference($data['credential_reference']) : $device->credential_reference,
            ]);

            return $device->fresh(['station', 'createdBy']);
        });
    }

    public function delete(FuelStationDevice $device): void
    {
        $this->assertDeviceTenant($device);
        $device->delete();
    }

    public function activeSource(string $stationId, string $deviceKey, string $adapterKey): FuelStationDevice
    {
        $station = $this->station($stationId);
        $device = FuelStationDevice::query()->where('fuel_station_id', $station->id)->where('device_key', trim($deviceKey))->first();
        if ($device === null) {
            throw new RuntimeException('مصدر حدث جهاز الساحة غير مسجل للمحطة.');
        }
        if ($device->status !== FuelStationDevice::STATUS_ACTIVE) {
            throw new RuntimeException('مصدر حدث جهاز الساحة غير نشط.');
        }
        if (! hash_equals($device->adapter_key, trim($adapterKey))) {
            throw new RuntimeException('محول مصدر جهاز الساحة لا يطابق السجل المعتمد.');
        }

        return $device;
    }

    public function markObserved(FuelStationDevice $device, \DateTimeInterface $observedAt): void
    {
        $device->update([
            'health' => FuelStationDevice::HEALTH_ONLINE,
            'sync_status' => FuelStationDevice::SYNC_IDLE,
            'last_seen_at' => $observedAt,
            'last_event_at' => $observedAt,
            'last_failure_reason' => null,
        ]);
    }

    public function markFailed(FuelStationDevice $device, string $reason): void
    {
        $device->update([
            'health' => FuelStationDevice::HEALTH_DEGRADED,
            'sync_status' => FuelStationDevice::SYNC_FAILED,
            'last_failure_at' => now(),
            'last_failure_reason' => mb_substr(trim($reason), 0, 500),
        ]);
    }

    private function station(string $id): FuelStation
    {
        $this->requireTenant();
        $station = FuelStation::query()->findOrFail($id);
        if ($station->tenant_id !== app(TenantContext::class)->id()) {
            throw new RuntimeException('المحطة لا تنتمي إلى المستأجر النشط.');
        }

        return $station;
    }

    private function assertDeviceTenant(FuelStationDevice $device): void
    {
        $this->requireTenant();
        if ($device->tenant_id !== app(TenantContext::class)->id()) {
            throw new RuntimeException('الجهاز لا ينتمي إلى المستأجر النشط.');
        }
    }

    private function assertDeviceKeyAvailable(string $deviceKey, ?string $exceptId = null): void
    {
        $query = FuelStationDevice::withoutGlobalScopes()->where('tenant_id', app(TenantContext::class)->id())->where('device_key', $deviceKey);
        if ($exceptId !== null) {
            $query->whereKeyNot($exceptId);
        }
        if ($query->exists()) {
            throw new RuntimeException('معرف جهاز الساحة مستخدم مسبقاً داخل المستأجر.');
        }
    }

    private function requireTenant(): void
    {
        if (! app(TenantContext::class)->has()) {
            throw new RuntimeException('سجل جهاز محطات الوقود يتطلب سياق مستأجر موثوقاً.');
        }
    }

    private function deviceType(mixed $value): string
    {
        if (! is_string($value) || ! in_array($value, self::TYPES, true)) {
            throw new RuntimeException('نوع جهاز محطة الوقود غير مدعوم.');
        }

        return $value;
    }

    private function status(mixed $value): string
    {
        if (! is_string($value) || ! in_array($value, self::STATUSES, true)) {
            throw new RuntimeException('حالة جهاز محطة الوقود غير صالحة.');
        }

        return $value;
    }

    private function key(mixed $value, string $label): string
    {
        $value = trim((string) $value);
        if (! preg_match('/^[a-z0-9][a-z0-9._:-]{0,127}$/', $value)) {
            throw new RuntimeException("{$label} يجب أن يبدأ بحرف/رقم صغير ويحتوي أحرفاً وأرقاماً و . _ : - فقط.");
        }

        return $value;
    }

    private function requiredText(mixed $value, string $label, int $max): string
    {
        $value = trim((string) $value);
        if ($value === '' || mb_strlen($value) > $max) {
            throw new RuntimeException("{$label} مطلوب وبحد أقصى {$max} حرفاً.");
        }

        return $value;
    }

    private function nullableText(mixed $value, int $max): ?string
    {
        $value = trim((string) $value);
        if ($value === '') {
            return null;
        }
        if (mb_strlen($value) > $max) {
            throw new RuntimeException("القيمة تتجاوز الحد الأقصى {$max} حرفاً.");
        }

        return $value;
    }

    /** @return array<string, mixed>|null */
    private function safeMetadata(mixed $value): ?array
    {
        if ($value === null || $value === []) {
            return null;
        }
        if (! is_array($value) || array_is_list($value)) {
            throw new RuntimeException('بيانات نقطة اتصال الجهاز يجب أن تكون كائناً منظماً غير سري.');
        }
        $this->assertSafeMetadata($value);

        return $value;
    }

    /** @param array<string, mixed> $metadata */
    private function assertSafeMetadata(array $metadata): void
    {
        foreach ($metadata as $key => $value) {
            if (preg_match('/(password|secret|token|api[_-]?key|private[_-]?key|authorization)/i', (string) $key)) {
                throw new RuntimeException('بيانات نقطة اتصال الجهاز لا تقبل كلمة مرور أو token أو secret؛ استخدم credential_reference فقط.');
            }
            if (is_array($value)) {
                $this->assertSafeMetadata($value);
            }
        }
    }

    private function credentialReference(mixed $value): ?string
    {
        $value = trim((string) $value);
        if ($value === '') {
            return null;
        }
        if (! preg_match('/^[a-z][a-z0-9._:\/-]{0,159}$/', $value)) {
            throw new RuntimeException('مرجع اعتماد الجهاز يجب أن يكون معرف vault/مرجعاً منطقياً آمناً لا secret خاماً.');
        }

        return $value;
    }
}
