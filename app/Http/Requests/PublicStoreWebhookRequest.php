<?php

namespace App\Http\Requests;

use App\Support\WebhookEventCatalog;
use App\Support\WebhookUrlException;
use App\Support\WebhookUrlValidator;
use Closure;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * عقد إنشاء اشتراك Webhook عبر الـ Public API — قائمة سماح صريحة. العنوان يُتحقَّق
 * SSRF (يُرفض loopback/private/link-local… + http في الإنتاج) فيُعاد 422 لا 500،
 * وأنواع الأحداث تُقيَّد بكتالوج السماح. لا يُقبل سرّ من العميل (الخادم يولّده).
 */
class PublicStoreWebhookRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'url'           => ['required', 'string', 'max:2048', $this->ssrfSafeUrl()],
            'event_types'   => ['required', 'array', 'min:1'],
            'event_types.*' => ['string', Rule::in(WebhookEventCatalog::all())],
            'description'   => ['nullable', 'string', 'max:255'],
        ];
    }

    /** قاعدة تحقّق SSRF: تُرجم استثناء المتحقّق إلى فشل تحقّق (422). */
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
