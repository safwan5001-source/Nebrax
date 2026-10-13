<?php

namespace App\Http\Requests;

use App\Models\StorefrontDomain;
use App\Support\ManagedStorefrontHostname;
use App\Support\StorefrontBaseDomainMisconfiguredException;
use App\Tenancy\ReservedTenantSlugs;
use App\Tenancy\TenantScope;
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
            'slug'         => ['required', 'string', 'alpha_dash', 'max:255', 'unique:tenants,slug', Rule::notIn(ReservedTenantSlugs::all()), $this->slugNotUsedByManagedStorefrontHost()],
            'vat_number'   => ['nullable', 'string', 'size:15'],
            'name'         => ['nullable', 'string', 'max:255'], // اسم المالك — يُشتق من الاسم التجاري إن غاب
            'phone'        => ['nullable', 'string', 'max:255'], // رقم الجوال
            'email'        => ['required', 'email', 'max:255', 'unique:users,email'], // فريد عالمياً (الدخول بالبريد)
            'password'     => ['required', 'string', 'min:8'],
        ];
    }

    /**
     * المتجر الأول يملك `{slug}.{managed-base}`؛ سلاج يطابق شريحة مضيف متجر إضافي قائم
     * (`{tenant}-{store}`، نوع awj_subdomain فقط — صفوف custom لا تغيّر عقد التسجيل القائم) يُرفض هنا بدل أن يفشل تزويد المتجر لاحقاً بتعارض مضيف.
     */
    private function slugNotUsedByManagedStorefrontHost(): \Closure
    {
        return function (string $attribute, mixed $value, \Closure $fail): void {
            if (! is_string($value) || $value === '') {
                return;
            }
            try {
                $hostname = ManagedStorefrontHostname::forSlug($value);
            } catch (StorefrontBaseDomainMisconfiguredException) {
                return; // بيئة بلا نطاق متاجر مضبوط: لا مضيفات مُدارة أصلاً
            }
            if (StorefrontDomain::withoutGlobalScope(TenantScope::class)->where('hostname', $hostname)
                ->where('type', StorefrontDomain::TYPE_AWJ_SUBDOMAIN)->exists()) {
                $fail('هذا المعرّف غير متاح.');
            }
        };
    }
}
