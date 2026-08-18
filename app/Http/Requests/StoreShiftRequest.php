<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreShiftRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name'          => ['required', 'string', 'max:255'],
            'branch_id'     => ['nullable', 'uuid'],                 // وسم وصفي — يتحقق من ملكيته المتحكّم
            'start_time'    => ['required', 'date_format:H:i'],
            'end_time'      => ['required', 'date_format:H:i'],
            'break_minutes' => ['nullable', 'integer', 'min:0', 'max:1440'],
            'work_days'     => ['required', 'array', 'min:1'],       // أيام العمل، 0=الأحد .. 6=السبت
            'work_days.*'   => ['integer', 'between:0,6'],
            'is_active'     => ['boolean'],
        ];
    }
}
