<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;

/**
 * TANKER-PR4: تسجيل تعبئة صهريج. **لا `tenant_id` ولا `branch_id` ولا أي حقل مشتق** من العميل (المستأجر من الجلسة، والفرع والمضخة والخزان والمنتج من الفوهة/المحطة): أي مفتاح
 * غير معلن يُرفض 422. الكمية بحقل واحد (`quantity_liters` نصاً/عدداً بثلاث منازل، أو `quantity_milliliters` صحيحاً) — تحقق الدقة في الخدمة بلا float.
 */
class StoreFuelTankerFillRequest extends FormRequest
{
    private const ALLOWED_KEYS = [
        'fuel_station_id', 'fuel_nozzle_id', 'fuel_tanker_owner_id', 'fuel_tanker_id', 'fuel_shift_id', 'fuel_product_id',
        'voucher_number', 'quantity_liters', 'quantity_milliliters', 'confirm_capacity_overrun', 'notes', 'idempotency_key',
    ];

    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'fuel_station_id' => ['required', 'uuid'],
            'fuel_nozzle_id' => ['required', 'uuid'],
            'fuel_tanker_owner_id' => ['required', 'uuid'],
            'fuel_tanker_id' => ['nullable', 'uuid'],
            'fuel_shift_id' => ['nullable', 'uuid'],
            'fuel_product_id' => ['nullable', 'uuid'],
            'voucher_number' => ['required', 'string', 'max:64'],
            'quantity_liters' => ['nullable'],
            'quantity_milliliters' => ['nullable'],
            'confirm_capacity_overrun' => ['sometimes', 'boolean'],
            'notes' => ['nullable', 'string', 'max:1000'],
            'idempotency_key' => ['required', 'string', 'min:8', 'max:128'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $unknown = array_values(array_diff(array_keys($this->all()), self::ALLOWED_KEYS));
            if ($unknown !== []) {
                $validator->errors()->add('request', 'حقول غير مسموحة: ' . implode(', ', $unknown));
            }
        });
    }

    /** @return array<string,mixed> */
    public function intent(): array
    {
        return array_merge($this->validated(), ['confirm_capacity_overrun' => $this->boolean('confirm_capacity_overrun')]);
    }
}
