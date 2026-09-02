<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Models\WebhookDelivery;
use App\Models\WebhookEndpoint;
use App\Models\WebhookEvent;
use App\Services\ApiClientKeyService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * PR-7.5: قراءة سجلّ تسليم الـ Webhooks عبر الجلسة الداخلية. يثبت عزل نوع المستفيد،
 * وRBAC، وعزل المستأجر، وأنّ الاستجابة **بيانات آمنة فقط** (لا مقتطف استجابة مخزَّن
 * ولا سرّ ولا إيجار داخلي).
 */
class DeveloperWebhookDeliveryTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use InteractsWithWebhooks;

    private const URI = '/api/developer/webhook-deliveries';

    private function apiClientBearer(string $tenantId): string
    {
        $service = app(ApiClientKeyService::class);
        $client = $service->createClient(Tenant::findOrFail($tenantId), 'integration');

        return $service->issueKey($client, 'k', ['webhooks:read'])->plainTextToken;
    }

    /** يزرع تسليمًا لمستأجر مع مقتطف استجابة حسّاس (يجب ألّا يظهر). */
    private function seedDelivery(string $tenantId): WebhookDelivery
    {
        app(TenantContext::class)->set($tenantId);
        $endpoint = WebhookEndpoint::create([
            'tenant_id' => $tenantId, 'url' => 'https://hook.example.com/x', 'event_types' => ['partner.created'],
            'secret' => 'whsec_' . Str::random(40), 'secret_prefix' => 'whsec_abc123', 'status' => 'enabled',
        ]);
        $event = WebhookEvent::create([
            'tenant_id' => $tenantId, 'type' => 'partner.created', 'api_version' => 'v1',
            'source_type' => 'App\\Models\\Partner', 'source_id' => (string) Str::uuid(),
            'payload' => ['id' => 'p1', 'name' => 'SECRET-CUSTOMER-NAME'], 'occurred_at' => now(),
        ]);
        $delivery = WebhookDelivery::create([
            'tenant_id' => $tenantId, 'webhook_event_id' => $event->id, 'webhook_endpoint_id' => $endpoint->id,
            'status' => 'failed', 'attempts' => 3, 'last_status_code' => 500,
            'last_error' => 'http_500', 'last_duration_ms' => 42,
            'last_response_snippet' => 'SENSITIVE-RESPONSE-BODY', 'failed_at' => now(),
        ]);
        app(TenantContext::class)->forget();

        return $delivery;
    }

    #[Test]
    public function an_api_client_bearer_token_cannot_read_deliveries(): void
    {
        $owner = $this->registerTenant('acme', 'owner@acme.test');
        $this->withToken($this->apiClientBearer($owner['tenant_id']))->getJson(self::URI)->assertStatus(403);
    }

    #[Test]
    public function permission_is_required(): void
    {
        $owner = $this->registerTenant('acme', 'owner@acme.test');
        $staff = $this->tokenForRole($owner['tenant_id'], 'staff', 'staff@acme.test');
        $this->withToken($staff)->getJson(self::URI)->assertStatus(403);
    }

    #[Test]
    public function it_lists_only_safe_metadata_for_the_callers_tenant(): void
    {
        $a = $this->registerTenant('a', 'a@a.test');
        $b = $this->registerTenant('b', 'b@b.test');
        $this->seedDelivery($a['tenant_id']);
        $this->seedDelivery($b['tenant_id']);

        $res = $this->withToken($a['token'])->getJson(self::URI)->assertOk();

        // عزل المستأجر: تسليم واحد فقط (لصاحب الطلب).
        $this->assertCount(1, $res->json('data'));
        $row = $res->json('data.0');
        $this->assertSame('failed', $row['status']);
        $this->assertSame('partner.created', $row['event_type']);
        $this->assertSame(500, $row['http_status']);

        // لا تسريب: لا مقتطف استجابة، لا سرّ، لا إيجار داخلي، لا حمولة حدث حسّاسة.
        $body = $res->getContent();
        $this->assertStringNotContainsString('SENSITIVE-RESPONSE-BODY', $body);
        $this->assertStringNotContainsString('SECRET-CUSTOMER-NAME', $body);
        $this->assertStringNotContainsString('reserved_until', $body);
        $this->assertArrayNotHasKey('last_response_snippet', $row);
    }

    #[Test]
    public function it_filters_by_status_and_is_paginated(): void
    {
        $owner = $this->registerTenant('acme', 'owner@acme.test');
        $this->seedDelivery($owner['tenant_id']); // failed

        $this->withToken($owner['token'])->getJson(self::URI . '?status=failed')->assertOk()->assertJsonCount(1, 'data');
        $this->withToken($owner['token'])->getJson(self::URI . '?status=delivered')->assertOk()->assertJsonCount(0, 'data');
        // ترقيم قياسي: meta موجود.
        $this->withToken($owner['token'])->getJson(self::URI)->assertOk()->assertJsonStructure(['data', 'meta' => ['per_page']]);
    }
}
