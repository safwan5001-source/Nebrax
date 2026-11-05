<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * سعر لتر وقود جديد. `approved_by` لم يعد يُقبل من الطلب (كان يسمح بنسب الموافقة لمعرّف مستخدم اعتباطي)؛
 * الموافق هو الفاعل المصادَق دائماً. الحقول الجديدة كلها اختيارية فلا ينكسر عميل قائم.
 */
class StoreFuelStationProductPriceRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'fuel_station_id' => ['nullable', 'uuid'],
            'fuel_product_id' => ['required', 'uuid'],
            // سقف عقلاني (10,000 ريال/لتر) يمنع خطأ إدخال بحجم وحدة مختلفة؛ ليس سياسة تسعير.
            'price_per_liter_minor' => ['required', 'integer', 'min:1', 'max:1000000'],
            'start_now' => ['sometimes', 'boolean'],
            'effective_from' => ['required_without:start_now', 'nullable', 'date'],
            'effective_until' => ['nullable', 'date'],
            'reason' => ['nullable', 'string', 'max:1000'],
            'idempotency_key' => ['nullable', 'string', 'regex:/^[A-Za-z0-9_-]{8,64}$/'],
            'supersede' => ['sometimes', 'boolean'],
            'source' => ['nullable', 'array'],
            'source.type' => ['required_with:source', 'in:product_card'],
            'source.confirm_tax_mode' => ['required_with:source', 'in:tax_inclusive,tax_exclusive'],
            'source.confirm_unit' => ['required_with:source', 'in:L'],
        ];
    }

    protected function prepareForValidation(): void
    {
        // start_now يتقدّم على effective_from: لا ساعة عميل عند «ابدأ الآن».
        if ($this->boolean('start_now')) {
            $this->merge(['effective_from' => null]);
        }
    }

    public function withValidator($validator): void
    {
        $validator->after(function ($validator) {
            $from = $this->input('effective_from');
            $until = $this->input('effective_until');
            if ($from !== null && $until !== null && strtotime((string) $until) <= strtotime((string) $from)) {
                $validator->errors()->add('effective_until', 'effective_until يجب أن يكون بعد effective_from.');
            }
        });
    }
}
