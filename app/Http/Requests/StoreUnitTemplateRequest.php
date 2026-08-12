<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreUnitTemplateRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name'            => ['required', 'string', 'max:255'],
            'base_unit'       => ['required', 'string', 'max:255'],
            'is_active'       => ['nullable', 'boolean'],
            'units'           => ['nullable', 'array', 'max:50'],
            'units.*.name'    => ['required', 'string', 'max:255'],
            // المعامل ≥ ٢: وحدةٌ بمعامل ١ هي وحدة الأساس مسمّاةً باسم آخر —
            // اسمان لشيء واحد يجعلان الشاشة تكذب. والسقف يحرس من فيض الضرب
            // في `baseQuantity` على كمية كبيرة.
            'units.*.factor'  => ['required', 'integer', 'min:2', 'max:1000000'],
        ];
    }

    public function messages(): array
    {
        return [
            'units.*.factor.min' => 'معامل التحويل يبدأ من ٢ — الوحدة بمعامل ١ هي وحدة الأساس نفسها.',
        ];
    }
}
