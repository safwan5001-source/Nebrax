<?php

namespace App\Http\Requests;

use App\Models\Contract;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class UpdateContractRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'type'               => ['sometimes', Rule::in(Contract::TYPES)],
            'status'             => ['sometimes', Rule::in(Contract::STATUSES)],
            'start_date'         => ['sometimes', 'date'],
            // مقارنة after_or_equal:start_date تُترك للمتحكّم عند التحديث الجزئي —
            // start_date قد لا يصل في هذا الطلب فتُقارَن بقيمة السجلّ الحالية لا المُدخلة.
            'end_date'           => ['nullable', 'date'],
            'probation_end_date' => ['nullable', 'date'],
            'notes'              => ['nullable', 'string'],

            // غياب items يترك بنود العقد الحالية بلا تغيير (تحديثٌ جزئي لحالة/تاريخ
            // العقد فقط)؛ وجوده يستبدل المجموعة كاملةً (لا تعديل بندٍ واحد جزئياً).
            'items'                => ['sometimes', 'array', 'min:1'],
            'items.*.category'     => ['required_with:items', Rule::in(Contract::CATEGORIES)],
            'items.*.name'         => ['required_with:items', 'string', 'max:150'],
            'items.*.amount'       => ['required_with:items', 'integer', 'min:0'], // هللات
        ];
    }

    /** إن أُرسلت items، فبندٌ واحدٌ بالضبط بتصنيف `basic` إلزامي. */
    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            if (! $this->has('items')) {
                return;
            }
            $items = $this->input('items', []);
            $basicCount = collect($items)->where('category', 'basic')->count();
            if ($basicCount !== 1) {
                $validator->errors()->add('items', 'يجب أن يحتوي العقد على بند "الراتب الأساسي" واحدٍ بالضبط.');
            }
        });
    }
}
