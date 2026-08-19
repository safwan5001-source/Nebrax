<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreAttendanceRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'employee_id'     => ['required', 'uuid'],           // ملكيته تُتحقَّق في المتحكّم
            'shift_id'        => ['nullable', 'uuid'],           // كذلك
            'attendance_date' => ['required', 'date'],
            'check_in'        => ['nullable', 'date_format:H:i'],
            'check_out'       => ['nullable', 'date_format:H:i'],
            'status'          => ['required', 'in:present,absent,late,leave'],
            'notes'           => ['nullable', 'string', 'max:500'],
        ];
    }
}
