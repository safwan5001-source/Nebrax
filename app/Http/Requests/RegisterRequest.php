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
     * يطبّع الجوال دون تخمين دولة:
     *  - كل رقم عربي/فارسي يُحوَّل إلى 0–9 (قاعدة «أرقام إنجليزية فقط» تسري على كل ما يُحفظ)، وتُزال علامات الاتجاه غير المرئية.
     *  - إن بدأ بـ`+` فهو دولي: تُزال المسافات والفواصل والأقواس ليُفحص E.164 (انظر `phoneRule`).
     *  - غير ذلك (رقم محلي قديم مثل 0500000000) يبقى حرفياً كما أُرسل — **لا يُضاف له رمز دولة ولا يُعاد تفسيره**؛
     *    كان مقبولاً قبل INTL-PHONE-V1 ويعتمد عليه مستهلكو API القائمون (PlatformTenantManagementTest).
     *  فارغ ⇒ null (الحقل اختياري كما كان).
     */
    public static function normalizePhone(string $phone): ?string
    {
        $phone = strtr($phone, [
            '٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4', '٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9',
            '۰' => '0', '۱' => '1', '۲' => '2', '۳' => '3', '۴' => '4', '۵' => '5', '۶' => '6', '۷' => '7', '۸' => '8', '۹' => '9',
            '＋' => '+',
        ]);
        $phone = trim(preg_replace('/[\x{200B}\x{200E}\x{200F}\x{061C}\x{202A}-\x{202E}\x{2066}-\x{2069}\x{FEFF}]+/u', '', $phone) ?? '');
        if ($phone === '') {
            return null;
        }
        if (str_starts_with($phone, '+')) {
            return '+' . (preg_replace('/[\s\-().]+/u', '', substr($phone, 1)) ?? '');
        }

        return $phone;
    }

    /**
     * عقد الخادم للجوال: شكل E.164 فقط للقيم الدولية (`+` ثم 7–15 رقماً أولها 1–9). **ليس تحققاً بنمط الدولة**
     * (لا libphonenumber في PHP ولا composer.json في المستودع)؛ التحقق بنمط الدولة في الواجهة، والجوال هنا بيانات
     * تواصل اختيارية غير موثَّقة (لا دخول ولا OTP ولا فريدة). القيم المحلية القديمة تمرّ كما كانت (max:255).
     */
    private function phoneRule(): \Closure
    {
        return function (string $attribute, mixed $value, \Closure $fail): void {
            if (is_string($value) && str_starts_with($value, '+') && preg_match('/^\+[1-9]\d{6,14}$/', $value) !== 1) {
                $fail('رقم الجوال الدولي يجب أن يكون بالصيغة +966512345678 (رمز الدولة ثم الرقم).');
            }
        };
    }

    public function rules(): array
    {
        return [
            'company_name' => ['required', 'string', 'max:255'],
            'slug'         => ['required', 'string', 'alpha_dash', 'max:255', 'unique:tenants,slug', Rule::notIn(ReservedTenantSlugs::all()), $this->slugNotUsedByManagedStorefrontHost()],
            'vat_number'   => ['nullable', 'string', 'size:15'],
            'name'         => ['nullable', 'string', 'max:255'], // اسم المالك — يُشتق من الاسم التجاري إن غاب
            'phone'        => ['nullable', 'string', 'max:255', $this->phoneRule()], // رقم الجوال: E.164 إن بدأ بـ+ وإلا كما كان (توافق)
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
}
