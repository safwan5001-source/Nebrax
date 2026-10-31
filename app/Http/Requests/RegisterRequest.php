<?php

namespace App\Http\Requests;

use App\Services\Commerce\ManagedHostnameAvailability;
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

        if (is_string($this->phone)) {
            $this->merge(['phone' => self::normalizePhone($this->phone)]);
        }
    }

    /**
     * يطبّع الجوال إلى أرقام إنجليزية 0–9 بلا مسافات/فواصل/علامات اتجاه، مع تحويل `00` البادئة إلى `+`.
     * الواجهة ترسل E.164 أصلاً؛ هذا يحمي من عملاء API يرسلون أرقاماً عربية/فارسية أو مسافات.
     * فارغ ⇒ null (الحقل اختياري كما كان).
     */
    public static function normalizePhone(string $phone): ?string
    {
        $phone = strtr($phone, [
            '٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4', '٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9',
            '۰' => '0', '۱' => '1', '۲' => '2', '۳' => '3', '۴' => '4', '۵' => '5', '۶' => '6', '۷' => '7', '۸' => '8', '۹' => '9',
            '＋' => '+',
        ]);
        $phone = preg_replace('/[\x{200B}\x{200E}\x{200F}\x{061C}\x{202A}-\x{202E}\x{2066}-\x{2069}\x{FEFF}\s\-().]+/u', '', $phone) ?? '';
        if (str_starts_with($phone, '00')) {
            $phone = '+' . substr($phone, 2);
        }

        return $phone === '' ? null : $phone;
    }

    public function rules(): array
    {
        return [
            'company_name' => ['required', 'string', 'max:255'],
            'slug'         => ['required', 'string', 'alpha_dash', 'max:255', 'unique:tenants,slug', Rule::notIn(ReservedTenantSlugs::all()), $this->slugNotUsedByManagedStorefrontHost()],
            'vat_number'   => ['nullable', 'string', 'size:15'],
            'name'         => ['nullable', 'string', 'max:255'], // اسم المالك — يُشتق من الاسم التجاري إن غاب
            'phone'        => ['nullable', 'string', 'regex:/^\+[1-9]\d{6,14}$/'], // رقم الجوال بصيغة E.164 (+9665XXXXXXXX)
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
            if (is_string($value) && $value !== ''
                && app(ManagedHostnameAvailability::class)->tenantSlugCollidesWithManagedHost($value)) {
                $fail('هذا المعرّف غير متاح.');
            }
        };
    }

    public function messages(): array
    {
        return [
            'phone.regex' => 'رقم الجوال يجب أن يكون بالصيغة الدولية مثل +966512345678.',
        ];
    }
}
