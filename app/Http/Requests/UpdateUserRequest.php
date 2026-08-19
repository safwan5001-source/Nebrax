<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UpdateUserRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name'      => ['sometimes', 'required', 'string', 'max:255'],
            'role'      => ['sometimes', 'required', 'in:owner,admin,accountant,staff'],
            'password'  => ['nullable', 'string', 'min:8'],
            'is_active' => ['boolean'],
            // ربط/فكّ الربط بموظف. الغياب يُبقي الحالي؛ `null` صريحة تفكّ الربط.
            'employee_id' => ['nullable', 'uuid'],
            // نطاق الوصول: **الغياب لا يعني الحرمان**. مصفوفة فارغة تُلغي
            // التقييد (وصولٌ كامل)، وعدم الإرسال يُبقي الإسناد كما هو.
            'branch_ids'      => ['nullable', 'array'],
            'branch_ids.*'    => ['uuid'],
            'warehouse_ids'   => ['nullable', 'array'],
            'warehouse_ids.*' => ['uuid'],
        ];
    }
}
