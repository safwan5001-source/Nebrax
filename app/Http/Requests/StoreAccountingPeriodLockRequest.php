<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** ACC-6: نطاق مغلق الطرفين بسببٍ إلزامي. لا نطاق مفتوح النهاية في V1. */
class StoreAccountingPeriodLockRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'start_date' => ['required', 'date_format:Y-m-d'],
            'end_date'   => ['required', 'date_format:Y-m-d'],
            'reason'     => ['required', 'string', 'max:1000'],
        ];
    }
}
