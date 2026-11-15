<?php

namespace App\Services;

use App\Models\FuelSale;
use App\Models\FuelShift;
use App\Models\FuelTankerFill;

/**
 * لترات كل فوهة في وردية، مفصولةً بنوع العملية — **قراءة فقط** (بلا قفل ولا كتابة).
 *
 * مصدر واحد مشترك لثلاثة مستهلكين كي لا يتشعّب الحكم: معاينة التسوية، مُقيِّم التسوية، ومطابقة العدّادات عند الإغلاق (TANKER-PR8).
 *
 *   direct  : مبيعات الوقود المباشرة **النهائية** بمصدر `station` (بيع التسوية `source = settlement` ليس بيع ERP فلا يُحسب)
 *   tanker  : سندات تعبئة الصهاريج بحالة `recorded` (الملغاة مستبعدة)
 *   draft   : مبيعات مباشرة لم تُنجَز بعد (معلومة، لا تدخل أي مجموع)
 *
 * كل القيم mL صحيحة. تعبئة الصهريج **ليست بيعاً** (لا فاتورة ولا تحصيل): تُخصم بترحيل سندها وحده، فلا تدخل بقية التسوية.
 */
class FuelShiftNozzleLiters
{
    /**
     * لترات سندات التعبئة فقط (مصدر استبعادها من بقية التسوية): استعلام واحد على `fuel_tanker_fills`، بلا قراءة لـ`fuel_sales`.
     *
     * @return array<string,int>  معرّف الفوهة ⇒ mL
     */
    public function tankerByNozzle(FuelShift|string $shift): array
    {
        $shiftId = $shift instanceof FuelShift ? $shift->id : $shift;

        return FuelTankerFill::query()->where('fuel_shift_id', $shiftId)->where('status', FuelTankerFill::STATUS_RECORDED)
            ->selectRaw('fuel_nozzle_id, SUM(quantity_milliliters) as ml')->groupBy('fuel_nozzle_id')->pluck('ml', 'fuel_nozzle_id')
            ->map(fn ($v) => (int) $v)->all();
    }

    /**
     * @return array{direct:array<string,int>, tanker:array<string,int>, tanker_count:array<string,int>, draft:array<string,int>}
     */
    public function forShift(FuelShift|string $shift): array
    {
        $shiftId = $shift instanceof FuelShift ? $shift->id : $shift;

        $direct = FuelSale::query()->where('fuel_shift_id', $shiftId)->where('status', FuelSale::STATUS_FINALIZED)->where('source', 'station')
            ->selectRaw('fuel_nozzle_id, SUM(quantity_milliliters) as ml')->groupBy('fuel_nozzle_id')->pluck('ml', 'fuel_nozzle_id');
        $draft = FuelSale::query()->where('fuel_shift_id', $shiftId)->where('status', FuelSale::STATUS_DRAFT)
            ->selectRaw('fuel_nozzle_id, SUM(quantity_milliliters) as ml')->groupBy('fuel_nozzle_id')->pluck('ml', 'fuel_nozzle_id');
        $tanker = FuelTankerFill::query()->where('fuel_shift_id', $shiftId)->where('status', FuelTankerFill::STATUS_RECORDED)
            ->selectRaw('fuel_nozzle_id, SUM(quantity_milliliters) as ml, COUNT(*) as n')->groupBy('fuel_nozzle_id')->get();

        return [
            'direct' => $direct->map(fn ($v) => (int) $v)->all(),
            'draft' => $draft->map(fn ($v) => (int) $v)->all(),
            'tanker' => $tanker->mapWithKeys(fn ($row) => [$row->fuel_nozzle_id => (int) $row->ml])->all(),
            'tanker_count' => $tanker->mapWithKeys(fn ($row) => [$row->fuel_nozzle_id => (int) $row->n])->all(),
        ];
    }
}
