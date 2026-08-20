<?php

namespace App\Http\Requests;

use App\Models\Contract;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class StoreContractRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'type'               => ['required', Rule::in(Contract::TYPES)],
            'status'             => ['nullable', Rule::in(Contract::STATUSES)],
            'start_date'         => ['required', 'date'],
            'end_date'           => ['nullable', 'date', 'after_or_equal:start_date'],
            'probation_end_date' => ['nullable', 'date'],
            'notes'              => ['nullable', 'string'],

            'items'                => ['required', 'array', 'min:1'],
            'items.*.category'     => ['required', Rule::in(Contract::CATEGORIES)],
            'items.*.name'         => ['required', 'string', 'max:150'],
            'items.*.amount'       => ['required', 'integer', 'min:0'], // هللات
        ];
    }

    /** بندٌ واحدٌ بالضبط بتصنيف `basic` (الراتب الأساسي) — إلزامي لكل عقد. */
    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            $items = $this->input('items', []);
            $basicCount = collect($items)->where('category', 'basic')->count();
            if ($basicCount !== 1) {
                $validator->errors()->add('items', 'يجب أن يحتوي العقد على بند "الراتب الأساسي" واحدٍ بالضبط.');
            }
        });
    }
}
