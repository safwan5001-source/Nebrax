<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreUserRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name'      => ['required', 'string', 'max:255'],
            'email'     => ['required', 'email', 'max:255'],
            'password'  => ['required', 'string', 'min:8'],
            'role'      => ['required', 'in:owner,admin,accountant,staff'],
            'is_active' => ['boolean'],
            // ربط اختياري بسجلّ موظف قائم (المستخدم موظفٌ يدخل النظام).
            // ملكية المعرّف وعدم ارتباطه بمستخدم آخر يُتحقّقان في المتحكّم.
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
