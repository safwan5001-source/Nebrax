<?php

namespace App\Http\Controllers\Api\Concerns;

use App\Models\FuelStation;
use Illuminate\Database\Eloquent\Builder;

/**
 * FS-05 (PR-2a): نطاق الفرع/المخزن للعمليات المرتبطة بمحطة وقود.
 *
 * `FuelStation` مصنَّفة CompanyWide، فلا تصفية آلية تمنع مستخدماً مقيَّداً بفرع أو مخزن من
 * الكتابة على محطة خارج نطاقه بتمرير معرّفها في الجسم (قراءات/تسليم/تسوية). هذا الحارس يطبّق
 * عقد `ApiController::assertRecordAccessible` القائم (404 موحّد) على المحطة: الفرع ضمن
 * `allowedBranchIds()` والمخزن ضمن `allowedWarehouseIds()`. غير المقيَّد (null) لا يتأثر إطلاقاً.
 *
 * يُستعمل داخل متحكمات `ApiController` فقط (يعتمد على `assertRecordAccessible`/`scopeToAccessibleWarehouses`).
 * حارس HTTP لا حارس خدمة: مسارات الخدمة الداخلية (أوامر/مهام) بلا مستخدم ولا تتأثر.
 */
trait AuthorizesFuelStationScope
{
    /** يحلّ المحطة داخل المستأجر ويرفض (404) إن كانت خارج فروع/مخازن المستخدم — قبل أي أثر جانبي. */
    protected function accessibleStation(?string $stationId): FuelStation
    {
        $station = FuelStation::findOrFail($stationId);
        $this->assertRecordAccessible($station->branch_id, [$station->warehouse_id]);

        return $station;
    }

    /** قيد قراءة للسجلات المرتبطة بمحطة (بلا عمود مخزن): تُخفى سجلات محطات مخزنها خارج نطاق المستخدم. */
    protected function restrictToAccessibleWarehouseStations(Builder $query, string $stationColumn = 'fuel_station_id'): Builder
    {
        $allowed = request()->user()?->allowedWarehouseIds();
        if ($allowed === null) {
            return $query;
        }

        return $query->whereIn($stationColumn, FuelStation::query()->select('id')->where(function (Builder $q) use ($allowed) {
            $q->whereNull('warehouse_id')->orWhereIn('warehouse_id', $allowed);
        }));
    }
}
