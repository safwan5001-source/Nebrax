<?php

namespace App\Services;

use App\Models\WebhookEndpoint;
use App\Support\WebhookEventCatalog;
use App\Support\WebhookUrlValidator;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * دورة حياة اشتراكات الـ Webhooks (PR-7): إنشاء/تحديث/تدوير سرّ/تعطيل — بتحقّق
 * SSRF عند كلّ تغيير عنوان، وتحقّق كتالوج الأحداث، وتوليد سرٍّ آمن يُعاد **مرة
 * واحدة**. السرّ يُخزَّن مشفَّرًا (cast `encrypted`) ولا يُعاد بعد ذلك أبدًا.
 *
 * كلّ العمليات معزولة بالمستأجر: المُعرِّف يُمرَّر صراحةً، والاستعلامات تخضع لنطاق
 * المستأجر في المتحكّم. لا تُشتقّ ملكيّة من جسم الطلب.
 */
class WebhookSubscriptionService
{
    private const SECRET_PREFIX = 'whsec_';

    public function __construct(private readonly WebhookUrlValidator $validator)
    {
    }

    /**
     * ينشئ اشتراكًا ويعيد [النموذج، السرّ الخام]. السرّ الخام يُعرَض **مرة واحدة**.
     *
     * @param  array<int,string>  $eventTypes
     * @return array{0: WebhookEndpoint, 1: string}
     */
    public function create(string $tenantId, ?string $apiClientId, string $url, array $eventTypes, ?string $description): array
    {
        $this->validator->validate($url);                 // SSRF — يرمي WebhookUrlException
        $types = WebhookEventCatalog::sanitize($eventTypes); // يرمي InvalidArgumentException

        $this->assertUnderLimit($tenantId);

        [$raw, $prefix] = $this->generateSecret();

        $endpoint = new WebhookEndpoint();
        $endpoint->forceFill([
            'tenant_id'     => $tenantId,
            'api_client_id' => $apiClientId,
            'url'           => $url,
            'description'   => $description,
            'event_types'   => $types,
            'secret'        => $raw,       // يُشفَّر عبر الـ cast عند الحفظ
            'secret_prefix' => $prefix,
            'status'        => WebhookEndpoint::STATUS_ENABLED,
        ])->save();

        return [$endpoint, $raw];
    }

    /**
     * يحدّث اشتراكًا قائمًا. العنوان الجديد يُعاد تحقّق SSRF له؛ السرّ يبقى ما لم
     * يُدوَّر صراحةً. يعيد النموذج المحدَّث.
     *
     * @param  array<string,mixed>  $changes
     */
    public function update(WebhookEndpoint $endpoint, array $changes): WebhookEndpoint
    {
        if (array_key_exists('url', $changes) && $changes['url'] !== null) {
            $this->validator->validate((string) $changes['url']);
            $endpoint->url = (string) $changes['url'];
        }

        if (array_key_exists('event_types', $changes) && $changes['event_types'] !== null) {
            $endpoint->event_types = WebhookEventCatalog::sanitize((array) $changes['event_types']);
        }

        if (array_key_exists('description', $changes)) {
            $endpoint->description = $changes['description'] !== null ? (string) $changes['description'] : null;
        }

        if (array_key_exists('status', $changes) && $changes['status'] !== null) {
            $this->applyStatus($endpoint, (string) $changes['status']);
        }

        $endpoint->save();

        return $endpoint;
    }

    /** يدوّر السرّ: يولّد جديدًا ويستبدل المادّة المشفَّرة، ويعيد السرّ الخام مرّة واحدة. */
    public function rotateSecret(WebhookEndpoint $endpoint): string
    {
        [$raw, $prefix] = $this->generateSecret();

        $endpoint->forceFill([
            'secret'        => $raw,
            'secret_prefix' => $prefix,
        ])->save();

        return $raw;
    }

    public function disable(WebhookEndpoint $endpoint): WebhookEndpoint
    {
        $this->applyStatus($endpoint, WebhookEndpoint::STATUS_DISABLED);
        $endpoint->save();

        return $endpoint;
    }

    private function applyStatus(WebhookEndpoint $endpoint, string $status): void
    {
        if ($status === WebhookEndpoint::STATUS_DISABLED) {
            $endpoint->status = WebhookEndpoint::STATUS_DISABLED;
            $endpoint->disabled_at = now();
        } elseif ($status === WebhookEndpoint::STATUS_ENABLED) {
            $endpoint->status = WebhookEndpoint::STATUS_ENABLED;
            $endpoint->disabled_at = null;
        } else {
            throw new RuntimeException("حالة اشتراك غير صالحة: «{$status}».");
        }
    }

    private function assertUnderLimit(string $tenantId): void
    {
        $max = (int) config('webhooks.max_endpoints_per_tenant', 20);
        $count = WebhookEndpoint::query()->withoutGlobalScopes()->where('tenant_id', $tenantId)->count();

        if ($count >= $max) {
            throw new RuntimeException("بلغت الحدّ الأقصى لاشتراكات الـ Webhook ({$max}).");
        }
    }

    /** يولّد سرًّا قويًّا وبادئته غير السرّية. @return array{0:string,1:string} */
    private function generateSecret(): array
    {
        $raw = self::SECRET_PREFIX . bin2hex(random_bytes(32));
        $prefix = Str::substr($raw, 0, 14); // بادئة للعرض لا تكشف السرّ

        return [$raw, $prefix];
    }
}
