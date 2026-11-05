<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** حفظ إقرار تحصيل الوردية. المبالغ بالهللات (عدد صحيح)؛ الهوية دائماً بمعرّف طريقة الدفع لا باسمها. */
class StoreFuelShiftCollectionRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'idempotency_key' => ['required', 'string', 'min:1', 'max:120'],
            'base_revision' => ['required', 'integer', 'min:0'],
            'lines' => ['required', 'array', 'min:1', 'max:50'],
            'lines.*.payment_method_id' => ['required', 'string', 'max:64'],
            'lines.*.amount_minor' => ['required', 'integer', 'min:0', 'max:1000000000000'],
        ];
    }
}
