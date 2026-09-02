<?php

namespace App\Http\Requests;

use App\Support\PublicApiScope;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * إنشاء عميل Public API + إصدار مفتاحه الأوّل عبر سطح إدارة المطوّرين الداخلي
 * (PR-7.5). قائمة سماح صريحة: الاسم والـ scopes (من السجلّ القانوني) وانتهاء اختياري.
 * `tenant_id` وأي حقل آخر يُسقَط بنيويًّا عبر `validated()` — المستأجر من الجلسة.
 */
class StoreDeveloperApiClientRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // التفويض عبر السلسلة: auth:sanctum + EnsureUserPrincipal + RBAC.
    }

    public function rules(): array
    {
        return [
            'name'            => ['required', 'string', 'max:255'],
            'scopes'          => ['required', 'array', 'min:1'],
            'scopes.*'        => ['string', Rule::in(PublicApiScope::all())],
            'expires_in_days' => ['nullable', 'integer', 'min:1', 'max:3650'],
        ];
    }
}
