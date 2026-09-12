<?php

namespace App\Http\Requests;

use App\Tenancy\ReservedTenantSlugs;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class RegisterRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        if (is_string($this->slug)) {
            $this->merge(['slug' => mb_strtolower(trim($this->slug))]);
        }
    }

    public function rules(): array
    {
        return [
            'company_name' => ['required', 'string', 'max:255'],
            'slug'         => ['required', 'string', 'alpha_dash', 'max:255', 'unique:tenants,slug', Rule::notIn(ReservedTenantSlugs::all())],
            'vat_number'   => ['nullable', 'string', 'size:15'],
            'name'         => ['nullable', 'string', 'max:255'], // اسم المالك — يُشتق من الاسم التجاري إن غاب
            'phone'        => ['nullable', 'string', 'max:255'], // رقم الجوال
            'email'        => ['required', 'email', 'max:255', 'unique:users,email'], // فريد عالمياً (الدخول بالبريد)
            'password'     => ['required', 'string', 'min:8'],
        ];
    }
}
