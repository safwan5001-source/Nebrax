<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** مرشحات القراءة لتقارير القيود والأستاذ والتدفقات والضريبة. */
class GeneralReportRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'from'        => ['nullable', 'date'],
            'to'          => ['nullable', 'date', 'after_or_equal:from'],
            'branch_id'   => ['nullable', 'array'],
            'branch_id.*' => ['uuid'],
            'account_id'  => ['nullable', 'uuid'],
        ];
    }
}
