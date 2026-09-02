<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\Tenant;
use App\Models\WebhookEndpoint;
use App\Services\ApiClientKeyService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * PR-7.5 (حرِج للدمج): إدارة اشتراكات الـ Webhooks عبر الجلسة الداخلية — يعيد
 * استخدام حمايات PR-7. يثبت عزل نوع المستفيد، وRBAC، وبقاء تحقّق SSRF وكتالوج
 * الأحداث، وإظهار السرّ **مرّة واحدة**، وعزل المستأجر المغلق.
 */
class DeveloperWebhookManagementTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use InteractsWithWebhooks;

    private const URI = '/api/developer/webhooks';

    protected function setUp(): void
    {
        parent::setUp();
        $this->bindWebhookValidator(); // مُحلِّل حتميّ: أسماء → IP عموميّ، حرفيّ كما هو
    }

    private function viewerToken(string $tenantId, string $email): string
    {
        app(TenantContext::class)->set($tenantId);
        Role::create(['tenant_id' => $tenantId, 'slug' => 'dev_viewer', 'name' => 'Dev Viewer', 'permissions' => ['developer.view']]);
        app(TenantContext::class)->forget();

        return $this->tokenForRole($tenantId, 'dev_viewer', $email);
    }

    private function apiClientBearer(string $tenantId): string
    {
        $service = app(ApiClientKeyService::class);
        $client = $service->createClient(Tenant::findOrFail($tenantId), 'integration');

        return $service->issueKey($client, 'k', ['webhooks:read'])->plainTextToken;
    }

    private function payload(array $overrides = []): array
    {
        return array_merge([
            'url'         => 'https://hook.example.com/receive',
            'event_types' => ['invoice.created', 'partner.created'],
            'description' => 'Billing',
        ], $overrides);
    }

    #[Test]
    public function an_api_client_bearer_token_cannot_manage_webhooks(): void
    {
        $owner = $this->registerTenant('acme', 'owner@acme.test');
        $bearer = $this->apiClientBearer($owner['tenant_id']);

        $this->withToken($bearer)->getJson(self::URI)->assertStatus(403);
        $this->withToken($bearer)->postJson(self::URI, $this->payload())->assertStatus(403);
    }

    #[Test]
    public function rbac_is_enforced_for_view_and_manage(): void
    {
        $owner = $this->registerTenant('acme', 'owner@acme.test');
        $staff = $this->tokenForRole($owner['tenant_id'], 'staff', 'staff@acme.test');
        $viewer = $this->viewerToken($owner['tenant_id'], 'viewer@acme.test');

        $this->withToken($staff)->getJson(self::URI)->assertStatus(403);
        $this->withToken($viewer)->getJson(self::URI)->assertOk();
        $this->withToken($viewer)->postJson(self::URI, $this->payload())->assertStatus(403);
    }

    #[Test]
    public function owner_creates_a_subscription_and_receives_the_secret_once(): void
    {
        $owner = $this->registerTenant('acme', 'owner@acme.test');

        $res = $this->withToken($owner['token'])->postJson(self::URI, $this->payload())
            ->assertStatus(201)
            ->assertJsonPath('webhook.status', 'enabled');

        $secret = $res->json('secret');
        $this->assertStringStartsWith('whsec_', $secret);
        $id = $res->json('webhook.id');

        $show = $this->withToken($owner['token'])->getJson(self::URI . '/' . $id)->assertOk();
        $this->assertStringNotContainsString($secret, $show->getContent());
        $this->assertArrayNotHasKey('secret', $show->json('data'));
        $this->assertNotEmpty($show->json('data.secret_prefix'));
    }

    #[Test]
    public function pr7_ssrf_and_event_catalog_protections_are_preserved(): void
    {
        $owner = $this->registerTenant('acme', 'owner@acme.test');

        $this->withToken($owner['token'])->postJson(self::URI, $this->payload(['url' => 'https://10.0.0.5/x']))->assertStatus(422);
        $this->withToken($owner['token'])->postJson(self::URI, $this->payload(['url' => 'http://hook.example.com/x']))->assertStatus(422);
        $this->withToken($owner['token'])->postJson(self::URI, $this->payload(['event_types' => ['invoice.posted']]))->assertStatus(422);
        $this->assertSame(0, WebhookEndpoint::withoutGlobalScopes()->count());
    }

    #[Test]
    public function rotate_secret_returns_a_new_secret_once(): void
    {
        $owner = $this->registerTenant('acme', 'owner@acme.test');
        $create = $this->withToken($owner['token'])->postJson(self::URI, $this->payload());
        $id = $create->json('webhook.id');
        $old = $create->json('secret');

        $rotated = $this->withToken($owner['token'])->postJson(self::URI . "/{$id}/rotate-secret")->assertOk();
        $this->assertStringStartsWith('whsec_', $rotated->json('secret'));
        $this->assertNotSame($old, $rotated->json('secret'));
    }

    #[Test]
    public function it_updates_disables_and_deletes(): void
    {
        $owner = $this->registerTenant('acme', 'owner@acme.test');
        $id = $this->withToken($owner['token'])->postJson(self::URI, $this->payload())->json('webhook.id');

        $this->withToken($owner['token'])->patchJson(self::URI . '/' . $id, ['status' => 'disabled'])
            ->assertOk()->assertJsonPath('data.status', 'disabled');
        $this->withToken($owner['token'])->patchJson(self::URI . '/' . $id, ['url' => 'https://127.0.0.1/x'])->assertStatus(422); // SSRF on update
        $this->withToken($owner['token'])->deleteJson(self::URI . '/' . $id)->assertOk();
        $this->assertNull(WebhookEndpoint::withoutGlobalScopes()->find($id));
    }

    #[Test]
    public function a_tenant_cannot_manage_another_tenants_webhook(): void
    {
        $a = $this->registerTenant('a', 'a@a.test');
        $b = $this->registerTenant('b', 'b@b.test');
        $bId = $this->withToken($b['token'])->postJson(self::URI, $this->payload())->json('webhook.id');

        $this->withToken($a['token'])->getJson(self::URI . '/' . $bId)->assertStatus(404);
        $this->withToken($a['token'])->patchJson(self::URI . '/' . $bId, ['status' => 'disabled'])->assertStatus(404);
        $this->withToken($a['token'])->deleteJson(self::URI . '/' . $bId)->assertStatus(404);
        $this->withToken($a['token'])->postJson(self::URI . "/{$bId}/rotate-secret")->assertStatus(404);
        $this->assertNotNull(WebhookEndpoint::withoutGlobalScopes()->find($bId));
    }
}
