<?php

namespace App\Http\Requests;

use App\Support\WebhookEventCatalog;
use App\Support\WebhookUrlException;
use App\Support\WebhookUrlValidator;
use Closure;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * عقد تحديث اشتراك Webhook — كلّ الحقول اختياريّة (تحديث جزئيّ). العنوان الجديد
 * يُعاد تحقّق SSRF له كالإنشاء تمامًا (تغيير العنوان حسّاس أمنيًّا). `status` يقبل
 * enabled/disabled فقط. لا يُقبل سرّ (التدوير عبر مسار مستقلّ).
 */
class PublicUpdateWebhookRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'url'           => ['sometimes', 'required', 'string', 'max:2048', $this->ssrfSafeUrl()],
            'event_types'   => ['sometimes', 'required', 'array', 'min:1'],
            'event_types.*' => ['string', Rule::in(WebhookEventCatalog::all())],
            'description'   => ['sometimes', 'nullable', 'string', 'max:255'],
            'status'        => ['sometimes', 'required', 'in:enabled,disabled'],
        ];
    }

    private function ssrfSafeUrl(): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail): void {
            try {
                app(WebhookUrlValidator::class)->validate((string) $value);
            } catch (WebhookUrlException $e) {
                $fail($e->getMessage());
            }
        };
    }
}
