<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class PosDeviceResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $drawer = is_array($this->cash_drawer_config) ? $this->cash_drawer_config : [];

        return [
            'id'           => $this->id,
            'branch_id'    => $this->branch_id,
            'warehouse_id' => $this->warehouse_id,
            'warehouse'    => $this->whenLoaded('warehouse', fn () => [
                'id'   => $this->warehouse?->id,
                'code' => $this->warehouse?->code,
                'name' => $this->warehouse?->name,
            ]),
            'name'         => $this->name,
            'code'         => $this->code,
            'notes'        => $this->notes,
            'cash_drawer'  => [
                'configured' => isset($drawer['bridge_url'], $drawer['pairing_secret']),
                'bridge_url' => $drawer['bridge_url'] ?? null,
                'printer_identifier' => $drawer['printer_identifier'] ?? null,
                'drawer_channel' => $drawer['drawer_channel'] ?? null,
                'pulse_on_ms' => $drawer['pulse_on_ms'] ?? null,
                'pulse_off_ms' => $drawer['pulse_off_ms'] ?? null,
                'paired_at' => $drawer['paired_at'] ?? null,
                'last_result' => $drawer['last_result'] ?? null,
                'last_success_at' => $drawer['last_success_at'] ?? null,
            ],
            'is_active'    => (bool) $this->is_active,
        ];
    }
}
