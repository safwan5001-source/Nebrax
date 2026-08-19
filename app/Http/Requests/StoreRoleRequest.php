<?php

namespace App\Http\Requests;

use App\Support\Rbac;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreRoleRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name'          => ['required', 'string', 'max:100'],
            'permissions'   => ['required', 'array', 'min:1'],
            // كل صلاحية من القائمة القانونية فقط — و`*` مرفوضة صراحةً: الوصول
            // الكامل محصورٌ في الأدوار النظامية (owner/admin) لا في دورٍ مخصَّص.
            'permissions.*' => ['string', Rule::in(Rbac::PERMISSIONS)],
        ];
    }

    public function messages(): array
    {
        return [
            'permissions.*.in' => 'صلاحية غير معروفة.',
        ];
    }
}
