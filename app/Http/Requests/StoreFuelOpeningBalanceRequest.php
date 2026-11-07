<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * FUEL-TANKS-V2 / PR-1 — إنشاء مسودة رصيد افتتاحي للوقود. الكمية باللترات كنص (حتى ثلاث منازل) أو عدد صحيح؛ التكلفة
 * بالهللة للتر لكل **منتج** (إرسالها يتطلب سلطة التكلفة المالية — تفحصه الخدمة). لا حقل إجمالي ولا قيمة سطر: تُشتق خادمياً.
 */
class StoreFuelOpeningBalanceRequest extends FormRequest
{
    /** البوابة قبل التحقق من الجسم: مغلقةً يكون الرد 404 مهما كان الجسم (لا 422 يكشف وجود المسار). */
    public function authorize(): bool
    {
        abort_unless(\App\Services\FuelOpeningBalanceService::enabled(), 404);

        return true;
    }

    public function rules(): array
    {
        return [
            'fuel_station_id' => ['required', 'uuid'],
            'opening_date' => ['required', 'date_format:Y-m-d'],
            'idempotency_key' => ['required', 'string', 'max:128'],
            'notes' => ['nullable', 'string', 'max:1000'],
            'allow_zero_cost' => ['sometimes', 'boolean'],
            'lines' => ['required', 'array', 'min:1', 'max:50'],
            'lines.*.fuel_tank_id' => ['required', 'uuid', 'distinct'],
            'lines.*.quantity_liters' => ['required', 'regex:/^(0|[1-9][0-9]*)(?:\.[0-9]{1,3})?$/'],
            'costs' => ['sometimes', 'nullable', 'array', 'max:50'],
            'costs.*.fuel_product_id' => ['required', 'uuid', 'distinct'],
            'costs.*.unit_cost_per_liter_minor' => ['required', 'integer', 'min:0'],
        ];
    }
}
