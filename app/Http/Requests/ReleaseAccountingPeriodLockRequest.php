<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** ACC-6: تحرير القفل يوجب سبباً — هو الأثر التدقيقي الذي يبقى بعد رفع المنع. */
class ReleaseAccountingPeriodLockRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'reason' => ['required', 'string', 'max:1000'],
        ];
    }
}
