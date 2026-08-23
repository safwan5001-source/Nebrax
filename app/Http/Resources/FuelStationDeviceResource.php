<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class FuelStationDeviceResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'fuel_station_id' => $this->fuel_station_id,
            'branch_id' => $this->branch_id,
            'device_key' => $this->device_key,
            'name' => $this->name,
            'device_type' => $this->device_type,
            'status' => $this->status,
            'adapter_key' => $this->adapter_key,
            'manufacturer' => $this->manufacturer,
            'model' => $this->model,
            'serial_number' => $this->serial_number,
            'firmware_version' => $this->firmware_version,
            'protocol' => $this->protocol,
            'external_identifier' => $this->external_identifier,
            // لا نعيد credential_reference ولا endpoint metadata؛ تستخدم الواجهة
            // مؤشرات الصحة لا تفاصيل شبكة أو بيانات اعتماد.
            'health' => $this->health,
            'sync_status' => $this->sync_status,
            'last_seen_at' => $this->last_seen_at?->toIso8601String(),
            'last_event_at' => $this->last_event_at?->toIso8601String(),
            'last_failure_at' => $this->last_failure_at?->toIso8601String(),
            'last_failure_reason' => $this->last_failure_reason,
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
