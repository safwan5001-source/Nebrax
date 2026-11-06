<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;

/**
 * FUEL-B5.1: التكلفة صارت سلطة مالية مستقلة؛ اختبارات أدوار المحطة المحدودة تنشئ الاستلام **بلا تكلفة** ثم تضعها كما تفعل المالية.
 * وضع التكلفة هنا مباشر في القاعدة (تجهيز بيانات) لأن هذه الاختبارات لا تختبر سلطة التكلفة نفسها (يختبرها FuelDeliveryCostAndAttachmentsTest).
 */
trait GivesFuelDeliveryCost
{
    /** @param array<string, mixed> $payload @return array<string, mixed> */
    protected function withoutCost(array $payload): array
    {
        unset($payload['received_total_cost_minor']);

        return $payload;
    }

    protected function setCostDirectly(string $deliveryId, int $totalMinor = 2345): void
    {
        $ml = (int) DB::table('fuel_deliveries')->where('id', $deliveryId)->value('received_milliliters');
        DB::table('fuel_deliveries')->where('id', $deliveryId)->update([
            'received_total_cost_minor' => $totalMinor,
            'received_unit_cost_minor' => intdiv($totalMinor, max(1, $ml)),
        ]);
    }
}
