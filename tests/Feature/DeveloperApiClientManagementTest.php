<?php

namespace Tests\Feature;

use App\Models\ApiClient;
use App\Models\Role;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * PR-7.5 (حرِج للدمج): إدارة عملاء Public API ومفاتيحها عبر الجلسة الداخلية.
 * يثبت عزل نوع المستفيد (توكن ApiClient مرفوض)، وRBAC (view مقابل manage)، وعزل
 * المستأجر المغلق، وإظهار السرّ **مرّة واحدة**، وملكية التوكن عند الإبطال.
 */
class DeveloperApiClientManagementTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const URI = '/api/developer/api-clients';

    /** توكن مستخدم بدور مخصّص يملك developer.view فقط. */
    private function viewerToken(string $tenantId, string $email): string
    {
        app(TenantContext::class)->set($tenantId);
        Role::create(['tenant_id' => $tenantId, 'slug' => 'dev_viewer', 'name' => 'Dev Viewer', 'permissions' => ['developer.view']]);
        app(TenantContext::class)->forget();

        return $this->tokenForRole($tenantId, 'dev_viewer', $email);
    }

    /** توكن Bearer لعميل Public API (مفتاح M2M) — يجب ألّا يبلغ سطح الإدارة الداخلي. */
    private function apiClientBearer(string $tenantId): string
    {
        $service = app(ApiClientKeyService::class);
        $client = $service->createClient(Tenant::findOrFail($tenantId), 'integration');

        return $service->issueKey($client, 'k', ['partners:read'])->plainTextToken;
    }

    private function payload(array $overrides = []): array
    {
        return array_merge(['name' => 'CI integration', 'scopes' => ['partners:read', 'invoices:read']], $overrides);
    }

    // ── principal-type isolation (merge-critical) ─────────────────────

    #[Test]
    public function it_requires_authentication(): void
    {
        $this->getJson(self::URI)->assertStatus(401);
    }

    #[Test]
    public function an_api_client_bearer_token_cannot_reach_the_internal_developer_surface(): void
    {
        $owner = $this->registerTenant('acme', 'owner@acme.test');
        $bearer = $this->apiClientBearer($owner['tenant_id']);

        $this->withToken($bearer)->getJson(self::URI)->assertStatus(403);
        $this->withToken($bearer)->postJson(self::URI, $this->payload())->assertStatus(403);
    }

    // ── RBAC ──────────────────────────────────────────────────────────

    #[Test]
    public function a_user_without_developer_permission_is_denied(): void
    {
        $owner = $this->registerTenant('acme', 'owner@acme.test');
        $staff = $this->tokenForRole($owner['tenant_id'], 'staff', 'staff@acme.test');

        $this->withToken($staff)->getJson(self::URI)->assertStatus(403);
        $this->withToken($staff)->postJson(self::URI, $this->payload())->assertStatus(403);
    }

    #[Test]
    public function developer_view_can_read_but_not_mutate(): void
    {
        $owner = $this->registerTenant('acme', 'owner@acme.test');
        $viewer = $this->viewerToken($owner['tenant_id'], 'viewer@acme.test');

        $this->withToken($viewer)->getJson(self::URI)->assertOk();
        $this->withToken($viewer)->postJson(self::URI, $this->payload())->assertStatus(403);
    }

    // ── create + one-time secret ──────────────────────────────────────

    #[Test]
    public function owner_creates_a_client_and_receives_a_working_secret_exactly_once(): void
    {
        $owner = $this->registerTenant('acme', 'owner@acme.test');

        $res = $this->withToken($owner['token'])->postJson(self::URI, $this->payload())
            ->assertStatus(201)
            ->assertJsonPath('client.name', 'CI integration')
            ->assertJsonPath('key.scopes', ['partners:read', 'invoices:read']);

        $secret = $res->json('secret');
        $this->assertIsString($secret);
        $this->assertStringContainsString('|', $secret); // توكن Sanctum: id|plain
        $clientId = $res->json('client.id');

        // القراءة اللاحقة لا تُعيد السرّ ولا التجزئة إطلاقًا.
        $show = $this->withToken($owner['token'])->getJson(self::URI . '/' . $clientId)->assertOk();
        $this->assertStringNotContainsString($secret, $show->getContent());
        $this->assertStringNotContainsString('token', json_encode($show->json('data.keys')));
        $this->assertSame(['partners:read', 'invoices:read'], $show->json('data.keys.0.scopes'));

        // السرّ مفتاحٌ حقيقي فعّال على الـ Public API (بنطاقه)، لا قيمة وهمية.
        $this->withToken($secret)->getJson('/api/v1/partners')->assertOk();
    }

    #[Test]
    public function an_unknown_scope_is_rejected(): void
    {
        $owner = $this->registerTenant('acme', 'owner@acme.test');
        $this->withToken($owner['token'])->postJson(self::URI, $this->payload(['scopes' => ['partners:read', 'bogus:scope']]))
            ->assertStatus(422);
        $this->assertSame(0, ApiClient::withoutGlobalScopes()->count());
    }

    #[Test]
    public function additional_keys_can_be_issued_and_revoked_with_ownership_enforced(): void
    {
        $owner = $this->registerTenant('acme', 'owner@acme.test');
        $clientId = $this->withToken($owner['token'])->postJson(self::URI, $this->payload())->json('client.id');

        // إصدار مفتاح إضافي.
        $issue = $this->withToken($owner['token'])->postJson(self::URI . "/{$clientId}/keys", ['scopes' => ['products:read']])
            ->assertStatus(201);
        $tokenId = $issue->json('key.id');
        $this->assertNotEmpty($issue->json('secret'));

        // إبطاله.
        $this->withToken($owner['token'])->deleteJson(self::URI . "/{$clientId}/keys/{$tokenId}")->assertOk();
        // إبطاله ثانيةً ⇒ 404 (لم يعد موجودًا لهذا العميل).
        $this->withToken($owner['token'])->deleteJson(self::URI . "/{$clientId}/keys/{$tokenId}")->assertStatus(404);
    }

    #[Test]
    public function a_client_can_be_deactivated(): void
    {
        $owner = $this->registerTenant('acme', 'owner@acme.test');
        $clientId = $this->withToken($owner['token'])->postJson(self::URI, $this->payload())->json('client.id');

        $this->withToken($owner['token'])->postJson(self::URI . "/{$clientId}/deactivate")
            ->assertOk()->assertJsonPath('data.is_active', false);
        $this->assertFalse(ApiClient::withoutGlobalScopes()->findOrFail($clientId)->is_active);
    }

    // ── tenant isolation (merge-critical) ─────────────────────────────

    #[Test]
    public function a_tenant_cannot_touch_another_tenants_client_or_keys(): void
    {
        $a = $this->registerTenant('a', 'a@a.test');
        $b = $this->registerTenant('b', 'b@b.test');
        $bClientId = $this->withToken($b['token'])->postJson(self::URI, $this->payload())->json('client.id');
        $bTokenId = $this->withToken($b['token'])->postJson(self::URI . "/{$bClientId}/keys", ['scopes' => ['products:read']])->json('key.id');

        $this->withToken($a['token'])->getJson(self::URI . '/' . $bClientId)->assertStatus(404);
        $this->withToken($a['token'])->postJson(self::URI . "/{$bClientId}/keys", ['scopes' => ['products:read']])->assertStatus(404);
        $this->withToken($a['token'])->deleteJson(self::URI . "/{$bClientId}/keys/{$bTokenId}")->assertStatus(404);
        $this->withToken($a['token'])->postJson(self::URI . "/{$bClientId}/deactivate")->assertStatus(404);

        // قائمة A لا تكشف عميل B.
        $this->assertSame(0, count($this->withToken($a['token'])->getJson(self::URI)->json('data')));
    }

    #[Test]
    public function a_body_supplied_tenant_id_is_ignored(): void
    {
        $a = $this->registerTenant('a', 'a@a.test');
        $b = $this->registerTenant('b', 'b@b.test');

        $clientId = $this->withToken($a['token'])->postJson(self::URI, $this->payload(['tenant_id' => $b['tenant_id']]))
            ->assertStatus(201)->json('client.id');

        $this->assertSame($a['tenant_id'], ApiClient::withoutGlobalScopes()->findOrFail($clientId)->tenant_id);
    }
}
