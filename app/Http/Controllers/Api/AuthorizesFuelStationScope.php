<?php

namespace App\Http\Controllers\Api;

use App\Models\FuelStation;
use App\Tenancy\BranchScope;
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
        // FUEL-B3: المستخدم المقيَّد بمحطات مسنَدة صراحةً (`users.fuel_station_scope = assigned`) لا يصل إلا إليها (404 موحّد)، والفراغ = لا شيء.
        $assigned = request()->user()?->allowedFuelStationIds();
        if ($assigned !== null && ! in_array($station->id, $assigned, true)) {
            abort(404);
        }

        return $station;
    }

    /**
     * محطات المستخدم المتاحة (فرعاً ومخزناً) كاستعلام فرعي، أو null إن كان غير مقيَّد (لا تصفية).
     * الفرع/المخزن الفارغان على المحطة يبقيانها مرئية (عقد whereBranchIn القائم لما قبل الفروع).
     */
    protected function accessibleStationsQuery(): ?Builder
    {
        $user = request()->user();
        $branches = $user?->allowedBranchIds();
        $warehouses = $user?->allowedWarehouseIds();
        $assigned = $user?->allowedFuelStationIds();
        if ($branches === null && $warehouses === null && $assigned === null) {
            return null;
        }

        $stations = FuelStation::query()->select('id');
        if ($assigned !== null) {
            // تقاطع مع الفرع/المخزن أدناه: المحطة المسنَدة خارج فرعه لا تظهر. `[]` ⇒ لا محطة (whereIn الفارغة false).
            $stations->whereIn('id', $assigned);
        }
        if ($branches !== null) {
            $stations->where(function (Builder $q) use ($branches) {
                $q->whereIn('branch_id', $branches)->orWhereNull('branch_id');
            });
        }
        if ($warehouses !== null) {
            $stations->where(function (Builder $q) use ($warehouses) {
                $q->whereNull('warehouse_id')->orWhereIn('warehouse_id', $warehouses);
            });
        }

        return $stations;
    }

    /** يصفّي سجلات مرتبطة بمحطة (أو المحطات نفسها بـ `$stationColumn = 'id'`) إلى ما يصله المستخدم. */
    protected function restrictToAccessibleStations(Builder $query, string $stationColumn = 'fuel_station_id'): Builder
    {
        $stations = $this->accessibleStationsQuery();

        return $stations === null ? $query : $query->whereIn($stationColumn, $stations);
    }

    /** معرّفات المحطات المتاحة للمستخدم، أو null إن كان غير مقيَّد (لتمريرها لخدمات التقارير). */
    protected function accessibleStationIds(): ?array
    {
        $stations = $this->accessibleStationsQuery();

        return $stations === null ? null : $stations->pluck('id')->all();
    }

    /** يصفّي سجلاً لا يرتبط بمحطة (كتنبيه مالي) إلى فروع المستخدم المسموحة؛ الفرع الفارغ يبقى مرئياً (عقد whereBranchIn). */
    protected function restrictToAllowedBranches(Builder $query): Builder
    {
        $allowed = request()->user()?->allowedBranchIds();
        if ($allowed === null) {
            return $query;
        }
        $table = $query->getModel()->getTable();

        return $query->where(function (Builder $q) use ($table, $allowed) {
            $q->whereIn($table . '.branch_id', $allowed)->orWhereNull($table . '.branch_id');
        });
    }

    /** قيد قراءة للسجلات المرتبطة بمحطة (بلا عمود مخزن): تُخفى سجلات محطات مخزنها خارج نطاق المستخدم. */
    protected function restrictToAccessibleWarehouseStations(Builder $query, string $stationColumn = 'fuel_station_id'): Builder
    {
        $assigned = request()->user()?->allowedFuelStationIds();
        if ($assigned !== null) {
            $query->whereIn($stationColumn, $assigned);
        }
        $allowed = request()->user()?->allowedWarehouseIds();
        if ($allowed === null) {
            return $query;
        }

        return $query->whereIn($stationColumn, FuelStation::query()->select('id')->where(function (Builder $q) use ($allowed) {
            $q->whereNull('warehouse_id')->orWhereIn('warehouse_id', $allowed);
        }));
    }

    /**
     * B1: فاتورة المورد `CompanyWide` ولا تحمل محطة — وجودها بين محطات المستخدم يُستدلّ عليه من **مطابقاتها** (كل مطابقة تحمل محطتها).
     * المستخدم المقيَّد (فرعاً أو مخزناً) يرى الفاتورة فقط إن:
     *   1) لم يكن لها أي مطابقة على محطة خارج نطاقه (وإلا لكشفت إجمالياتها أو حالتها محطاتٍ لا يراها)، و
     *   2) أنشأها هو، أو لها مطابقة واحدة على الأقل ضمن محطاته.
     * فالفاتورة غير المطابَقة لا يراها إلا منشئها (فشل مغلق: لا محطة تحدد مَن يملكها). غير المقيَّد لا تُصفّى له.
     *
     * استعلام المطابقات يتجاوز عزل الفرع النشط عمداً (مع بقاء عزل المستأجر): مطابقة في فرع آخر يجب أن تُحتسب «خارج النطاق»
     * لا أن تختفي فتُظهر الفاتورة كأنها نظيفة.
     */
    protected function restrictInvoicesToAccessibleStations(Builder $query): Builder
    {
        $stationIds = $this->accessibleStationIds();
        if ($stationIds === null) {
            return $query;
        }
        $userId = request()->user()?->id;

        return $query
            ->whereDoesntHave('matches', fn (Builder $m) => $m->withoutGlobalScope(BranchScope::class)->whereNotIn('fuel_station_id', $stationIds))
            ->where(function (Builder $q) use ($stationIds, $userId) {
                $q->where('created_by', $userId)
                    ->orWhereHas('matches', fn (Builder $m) => $m->withoutGlobalScope(BranchScope::class)->whereIn('fuel_station_id', $stationIds));
            });
    }
}
