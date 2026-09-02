<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Models\WebhookEndpoint;
use App\Services\ApiClientKeyService;
use App\Support\WebhookHostResolver;
use App\Support\WebhookUrlValidator;
use App\Tenancy\TenantContext;
use Illuminate\Support\Str;

/**
 * مساعدات اختبارات الـ Webhooks (PR-7): مُحلِّل DNS حتميّ (بذرة SSRF)، ربط
 * المتحقّق، وتهيئة مستأجر + عميل API + مفتاح بـ scopes، وإنشاء اشتراك مباشر.
 */
trait InteractsWithWebhooks
{
    /**
     * مُحلِّل حتميّ: يعيد عنوان IP الحرفيّ كما هو، ويطابق أسماء المضيفين المعطاة،
     * وإلّا عنوانًا عموميًّا افتراضيًّا — فيصحّ للسماح والرفض معًا.
     *
     * @param  array<string,list<string>>  $map
     */
    protected function fakeWebhookResolver(array $map = [], string $default = '93.184.216.34'): WebhookHostResolver
    {
        return new class($map, $default) implements WebhookHostResolver {
            public function __construct(private array $map, private string $default)
            {
            }

            public function resolve(string $host): array
            {
                if (filter_var($host, FILTER_VALIDATE_IP) !== false) {
                    return [$host];
                }

                return $this->map[$host] ?? [$this->default];
            }
        };
    }

    /** يربط متحقّق SSRF بمُحلِّلٍ حتميّ (وسياسة http اختيارية). */
    protected function bindWebhookValidator(?WebhookHostResolver $resolver = null, bool $allowInsecure = false): void
    {
        $resolver ??= $this->fakeWebhookResolver();
        $this->app->bind(WebhookUrlValidator::class, fn () => new WebhookUrlValidator($resolver, $allowInsecure));
    }

    /**
     * يهيّئ مستأجرًا + عميل API + مفتاحًا بـ scopes. يضبط سياق المستأجر ثم ينساه.
     *
     * @param  array<int,string>  $scopes
     * @return array{tenant: Tenant, token: string, client: \App\Models\ApiClient}
     */
    protected function webhookTenant(string $slug = 'acme', array $scopes = ['webhooks:read', 'webhooks:write']): array
    {
        $tenant = Tenant::create(['name' => $slug, 'slug' => $slug . '-' . Str::random(6)]);

        $service = app(ApiClientKeyService::class);
        $client = $service->createClient($tenant, 'integration');
        $token = $service->issueKey($client, 'k', $scopes)->plainTextToken;

        return compact('tenant', 'token', 'client');
    }

    /**
     * ينشئ اشتراكًا مباشرًا (يتجاوز SSRF/الخدمة) لاختبارات التسليم/الإصدار.
     *
     * @param  array<int,string>  $eventTypes
     */
    protected function makeEndpoint(Tenant $tenant, array $eventTypes, string $secret = 'whsec_test_secret_value', string $url = 'https://hook.example.com/receive', string $status = WebhookEndpoint::STATUS_ENABLED): WebhookEndpoint
    {
        $previous = app(TenantContext::class)->id();
        app(TenantContext::class)->set($tenant->id);

        $endpoint = new WebhookEndpoint();
        $endpoint->forceFill([
            'tenant_id'     => $tenant->id,
            'url'           => $url,
            'event_types'   => $eventTypes,
            'secret'        => $secret,
            'secret_prefix' => Str::substr($secret, 0, 14),
            'status'        => $status,
        ])->save();

        if ($previous !== null) {
            app(TenantContext::class)->set($previous);
        } else {
            app(TenantContext::class)->forget();
        }

        return $endpoint;
    }
}
