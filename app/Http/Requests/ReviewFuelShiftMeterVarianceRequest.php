<?php

namespace App\Http\Requests;

use App\Models\FuelShiftMeterVarianceReview;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/** تصنيف فرق عدّاد فوهة ومراجعته (TANKER-PR8) — الفوهة والتصنيف فقط؛ الكميات والحالة من لقطة الخادم المجمَّدة. */
class ReviewFuelShiftMeterVarianceRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'nozzle_id' => ['required', 'uuid'],
            'classification' => ['required', 'string', Rule::in(FuelShiftMeterVarianceReview::ALL)],
            'note' => ['nullable', 'string', 'max:500'],
        ];
    }

    protected function prepareForValidation(): void
    {
        // مفتاح مجهول ⇒ يُرفض (لا قيمة كمية/حالة من العميل).
        $unknown = array_diff(array_keys($this->all()), ['nozzle_id', 'classification', 'note']);
        if ($unknown !== []) {
            $this->merge(['__unknown' => 1]);
        }
    }

    public function withValidator($validator): void
    {
        $validator->after(function ($v) {
            if ($this->has('__unknown')) {
                $v->errors()->add('payload', 'حقول غير مسموحة.');
            }
        });
    }
}
