<?php

namespace App\Http\Requests;

use App\Tenancy\TenantContext;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateUserRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $tenantId = app(TenantContext::class)->id();

        return [
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            // يشمل النظامية والمخصَّصة معاً — انظر تعليق StoreUserRequest.
            'role' => [
                'sometimes',
                'required',
                Rule::exists('roles', 'slug')
                    ->where(fn ($q) => $q->where('tenant_id', $tenantId)->whereNull('deleted_at')),
            ],
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
