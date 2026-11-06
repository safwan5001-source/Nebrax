<?php

namespace App\Http\Requests;

use App\Models\Tenant;
use App\Support\Iso4217;
use App\Tenancy\TenantContext;
use Closure;
use Illuminate\Foundation\Http\FormRequest;

class UpdateCompanyRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** CUR-1: الرمز يُطبَّع إلى أحرف كبيرة قبل التحقق؛ الغائب/الفارغ يبقى كما هو (لا تغيير مطلوب). */
    protected function prepareForValidation(): void
    {
        $currency = $this->input('currency');
        if (is_string($currency) && trim($currency) !== '') {
            $this->merge(['currency' => Iso4217::normalize($currency)]);
        }
    }

    /**
     * CUR-1: رمز ISO 4217 صالح — **إلا** إن كان هو نفسه العملة المخزّنة بعد التطبيع (ليس تغييراً، فلا يُرفض بقية الحفظ
     * بسبب رمز تاريخي غير ISO). المنع بعد الترحيل لا يقع هنا بل داخل المعاملة المقفولة في `CompanyController`.
     */
    private function isoCurrencyRule(): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail): void {
            if (! is_string($value) || $value === '') {
                return;
            }
            $stored = Tenant::query()->whereKey(app(TenantContext::class)->id())->value('currency');
            if (Iso4217::normalize($value) === Iso4217::normalize((string) $stored)) {
                return;
            }
            if (! Iso4217::isValid($value)) {
                $fail('رمز العملة غير صالح؛ يجب أن يكون رمز ISO 4217 معتمداً (مثل SAR).');
            }
        };
    }

    public function rules(): array
    {
        return [
            'name'       => ['required', 'string', 'max:255'],
            'vat_number' => ['nullable', 'string', 'max:20'],
            'cr_number'  => ['nullable', 'string', 'max:50'],
            'currency'   => ['nullable', 'string', 'size:3', 'regex:/^[A-Za-z]{3}$/', $this->isoCurrencyRule()],
            'country'    => ['nullable', 'string', 'max:2'],
            'phone'      => ['nullable', 'string', 'max:30'],
            'mobile'     => ['nullable', 'string', 'max:30'],
            'building_no'   => ['nullable', 'string', 'max:20'],
            'street'        => ['nullable', 'string', 'max:255'],
            'additional_no' => ['nullable', 'string', 'max:20'],
            'district'      => ['nullable', 'string', 'max:120'],
            'city'          => ['nullable', 'string', 'max:120'],
            'postal_code'   => ['nullable', 'string', 'max:20'],
            'short_address' => ['nullable', 'string', 'max:50'],
            // يحوّل العميل الصورة إلى PNG مصغّر قبل الإرسال؛ نحصرها في data URL
            // لتبقى إعدادات المؤسسة خالية من مسارات أو محتوى غير صورة.
            'logo' => ['nullable', 'string', 'max:512000', 'regex:/^data:image\\/png;base64,[A-Za-z0-9+\\/=]+$/'],
            'clear_logo' => ['sometimes', 'boolean'],
        ];
    }
}
