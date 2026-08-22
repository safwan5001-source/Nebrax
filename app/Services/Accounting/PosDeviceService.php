<?php

namespace App\Services\Accounting;

use App\Models\PosDevice;
use App\Models\PosSession;
use App\Models\Warehouse;
use App\Tenancy\BranchContext;
use App\Tenancy\BranchScope;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * أجهزة نقطة البيع — إعداد تشغيلي للفرع يحدد مخزن خروج البضائع. لا ينشئ أثراً
 * محاسبياً؛ تلتقط جلسة POS الجهاز والمخزن لحظة فتحها كي تبقى المستندات التاريخية
 * ثابتة إن تغيّر إعداد الجهاز لاحقاً.
 */
class PosDeviceService
{
    public function create(array $data): PosDevice
    {
        $branchId = app(BranchContext::class)->id();
        $warehouse = $this->resolveWarehouse($data['warehouse_id'], $branchId);
        $code = $this->nullableTrim($data['code'] ?? null);
        $this->assertCodeAvailable($code);

        return PosDevice::create([
            'branch_id'    => $branchId,
            'warehouse_id' => $warehouse->id,
            'name'         => trim($data['name']),
            'code'         => $code,
            'notes'        => $this->nullableTrim($data['notes'] ?? null),
            'is_active'    => $data['is_active'] ?? true,
        ]);
    }

    public function update(PosDevice $device, array $data): PosDevice
    {
        return DB::transaction(function () use ($device, $data) {
            $device = PosDevice::lockForUpdate()->findOrFail($device->id);
            $nextWarehouseId = array_key_exists('warehouse_id', $data)
                ? $data['warehouse_id']
                : $device->warehouse_id;
            $nextActive = array_key_exists('is_active', $data)
                ? (bool) $data['is_active']
                : $device->is_active;
            $nextCode = array_key_exists('code', $data)
                ? $this->nullableTrim($data['code'])
                : $device->code;

            if ($nextWarehouseId !== $device->warehouse_id || ! $nextActive) {
                $this->assertNoOpenSession($device);
            }

            $warehouse = $this->resolveWarehouse($nextWarehouseId, $device->branch_id);
            $this->assertCodeAvailable($nextCode, $device->id);
            $device->update([
                'warehouse_id' => $warehouse->id,
                'name'         => array_key_exists('name', $data) ? trim($data['name']) : $device->name,
                'code'         => $nextCode,
                'notes'        => array_key_exists('notes', $data) ? $this->nullableTrim($data['notes']) : $device->notes,
                'is_active'    => $nextActive,
            ]);

            return $device->fresh('warehouse');
        });
    }

    public function delete(PosDevice $device): void
    {
        if (PosSession::where('pos_device_id', $device->id)->exists()) {
            throw new RuntimeException('لا يمكن حذف جهاز له جلسات مسجلة — عطّله بدلاً من ذلك.');
        }

        $device->delete();
    }

    private function resolveWarehouse(string $warehouseId, ?string $branchId): Warehouse
    {
        $warehouse = Warehouse::whereKey($warehouseId)->first();
        if (! $warehouse) {
            throw new RuntimeException('المستودع غير موجود.');
        }
        if (! $warehouse->is_active) {
            throw new RuntimeException('لا يمكن ربط جهاز POS بمستودع غير نشط.');
        }
        if ($warehouse->branch_id !== null && $warehouse->branch_id !== $branchId) {
            throw new RuntimeException('المستودع المحدد لا يخص الفرع النشط.');
        }

        return $warehouse;
    }

    private function assertNoOpenSession(PosDevice $device): void
    {
        if (PosSession::where('pos_device_id', $device->id)->where('status', 'open')->exists()) {
            throw new RuntimeException('لا يمكن تعديل مخزن الجهاز أو تعطيله أثناء وجود وردية مفتوحة.');
        }
    }

    private function assertCodeAvailable(?string $code, ?string $exceptId = null): void
    {
        if ($code === null) {
            return;
        }

        $taken = PosDevice::withoutGlobalScope(BranchScope::class)
            ->where('code', $code)
            ->when($exceptId, fn ($query) => $query->where('id', '!=', $exceptId))
            ->exists();
        if ($taken) {
            throw new RuntimeException('كود جهاز نقطة البيع مستخدم مسبقاً.');
        }
    }

    private function nullableTrim(?string $value): ?string
    {
        $value = trim((string) $value);

        return $value === '' ? null : $value;
    }
}
