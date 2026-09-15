<?php

namespace Tests\Feature;

use App\Models\ApiClient;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\PersonalAccessToken;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  Public/Mobile Commerce API V1 — PR-1 (Skeleton + Identity/Config)
 * ═══════════════════════════════════════════════════════════════
 *  يثبت العقد الأمني الكامل لـ `GET /commerce/v1/storefront`: fail-closed
 *  للتوكن/العميل/المستأجر/القناة غير الصالحة، عزل المستأجرين، وأن `/store/v1`
 *  يبقى بلا أي تغيير سلوكي.
 *
 *  تشغيل: php artisan test --filter=CommerceApiFoundationTest
 */
class CommerceApiFoundationTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function service(): ApiClientKeyService
    {
        return app(ApiClientKeyService::class);
    }

    private function makeTenant(string $slug, bool $active = true): Tenant
    {
        return Tenant::create([
            'name' => 'مستأجر '.$slug, 'slug' => $slug.'-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => $active,
        ]);
    }

    /** @return array{0: ApiClient, 1: string} [client, plainTextBearerToken] */
    private function makeClientToken(Tenant $tenant, bool $clientActive = true): array
    {
        $client = $this->service()->createClient($tenant, 'mobile-app', $clientActive);
        $key = $this->service()->issueKey($client, 'default', []);

        return [$client, $key->plainTextToken];
    }

    private function makeMobileChannel(Tenant $tenant, bool $active = true): SalesChannel
    {
        return SalesChannel::create([
            'tenant_id' => $tenant->id, 'slug' => 'mobile', 'name' => 'تطبيق الجوال',
            'type' => SalesChannel::TYPE_MOBILE, 'is_active' => $active,
        ]);
    }

    private function bearer(string $token): array
    {
        return ['Authorization' => 'Bearer '.$token];
    }

    // ── 1. المسار السعيد ──────────────────────────────────────────────

    /** @test */
    public function a_valid_token_with_an_active_mobile_channel_resolves_the_store_identity(): void
    {
        $tenant = $this->makeTenant('happy');
        $this->makeMobileChannel($tenant);
        [, $token] = $this->makeClientToken($tenant);

        $this->getJson('/commerce/v1/storefront', $this->bearer($token))
            ->assertOk()
            ->assertJsonPath('data.name', $tenant->name)
            ->assertJsonStructure(['data' => ['name'], 'meta' => ['request_id']]);
    }

    // ── 2. Token/عميل غير صالح — fail closed ────────────────────────────

    /** @test */
    public function a_missing_token_is_denied(): void
    {
        $this->getJson('/commerce/v1/storefront')
            ->assertStatus(401)
            ->assertJsonPath('error.code', 'unauthenticated');
    }

    /** @test */
    public function a_malformed_token_is_denied(): void
    {
        $this->getJson('/commerce/v1/storefront', $this->bearer('not-a-real-token'))
            ->assertStatus(401)
            ->assertJsonPath('error.code', 'unauthenticated');
    }

    /** @test */
    public function a_revoked_token_is_denied(): void
    {
        $tenant = $this->makeTenant('revoked');
        $this->makeMobileChannel($tenant);
        [$client, $token] = $this->makeClientToken($tenant);

        // إبطال فعلي: حذف صفّ التوكن نفسه (كما يفعل إلغاء مفتاح API حقيقياً).
        PersonalAccessToken::where('tokenable_type', ApiClient::class)
            ->where('tokenable_id', $client->id)
            ->delete();

        $this->getJson('/commerce/v1/storefront', $this->bearer($token))
            ->assertStatus(401)
            ->assertJsonPath('error.code', 'unauthenticated');
    }

    /** @test */
    public function an_inactive_api_client_is_denied(): void
    {
        $tenant = $this->makeTenant('inactive-client');
        $this->makeMobileChannel($tenant);
        [, $token] = $this->makeClientToken($tenant, clientActive: false);

        $this->getJson('/commerce/v1/storefront', $this->bearer($token))
            ->assertStatus(403)
            ->assertJsonPath('error.code', 'client_inactive');
    }

    /** @test */
    public function a_token_for_an_inactive_tenant_is_denied(): void
    {
        $tenant = $this->makeTenant('inactive-tenant', active: false);
        $this->makeMobileChannel($tenant);
        [, $token] = $this->makeClientToken($tenant);

        $this->getJson('/commerce/v1/storefront', $this->bearer($token))
            ->assertStatus(403)
            ->assertJsonPath('error.code', 'tenant_context_required');
    }

    // ── 3. القناة غير الصالحة — fail closed ─────────────────────────────

    /** @test */
    public function a_tenant_with_no_mobile_channel_at_all_is_denied(): void
    {
        $tenant = $this->makeTenant('no-channel');
        [, $token] = $this->makeClientToken($tenant);

        $this->getJson('/commerce/v1/storefront', $this->bearer($token))
            ->assertStatus(404)
            ->assertJsonPath('error.code', 'not_found');
    }

    /** @test */
    public function a_tenant_with_only_an_inactive_mobile_channel_is_denied(): void
    {
        $tenant = $this->makeTenant('inactive-channel');
        $this->makeMobileChannel($tenant, active: false);
        [, $token] = $this->makeClientToken($tenant);

        $this->getJson('/commerce/v1/storefront', $this->bearer($token))
            ->assertStatus(404)
            ->assertJsonPath('error.code', 'not_found');
    }

    /** @test */
    public function a_tenant_with_only_a_web_channel_is_denied_the_mobile_resolver(): void
    {
        $tenant = $this->makeTenant('web-only');
        SalesChannel::create([
            'tenant_id' => $tenant->id, 'slug' => 'web', 'name' => 'متجر الويب',
            'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        [, $token] = $this->makeClientToken($tenant);

        $this->getJson('/commerce/v1/storefront', $this->bearer($token))
            ->assertStatus(404)
            ->assertJsonPath('error.code', 'not_found');
    }

    // ── 4. عزل المستأجرين ────────────────────────────────────────────────

    /** @test */
    public function a_tenants_token_never_resolves_another_tenants_store_identity(): void
    {
        $tenantA = $this->makeTenant('cross-a');
        $this->makeMobileChannel($tenantA);
        [, $tokenA] = $this->makeClientToken($tenantA);

        $tenantB = $this->makeTenant('cross-b');
        $this->makeMobileChannel($tenantB);
        [, $tokenB] = $this->makeClientToken($tenantB);

        $this->getJson('/commerce/v1/storefront', $this->bearer($tokenA))
            ->assertOk()
            ->assertJsonPath('data.name', $tenantA->name);

        $this->getJson('/commerce/v1/storefront', $this->bearer($tokenB))
            ->assertOk()
            ->assertJsonPath('data.name', $tenantB->name);
    }

    /** @test */
    public function a_tenant_with_no_mobile_channel_is_denied_even_when_another_tenant_has_one(): void
    {
        $tenantWithChannel = $this->makeTenant('has-channel');
        $this->makeMobileChannel($tenantWithChannel);

        $tenantWithout = $this->makeTenant('lacks-channel');
        [, $tokenWithout] = $this->makeClientToken($tenantWithout);

        $this->getJson('/commerce/v1/storefront', $this->bearer($tokenWithout))
            ->assertStatus(404)
            ->assertJsonPath('error.code', 'not_found');
    }

    // ── 5. انحدار الويب — /store/v1 بلا أي تغيير سلوكي ───────────────────

    /** @test */
    public function store_v1_web_storefront_identity_is_unaffected(): void
    {
        $tenant = Tenant::create([
            'name' => 'متجر ويب أصلي', 'slug' => 'web-untouched-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        SalesChannel::create([
            'slug' => 'web', 'name' => 'المتجر الإلكتروني', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        app(TenantContext::class)->forget();

        $this->getJson("/store/v1/{$tenant->slug}/storefront")
            ->assertOk()
            ->assertJsonPath('data.name', $tenant->name);
    }

    /** @test */
    public function commerce_v1_and_store_v1_are_fully_independent_trust_boundaries(): void
    {
        $tenant = $this->makeTenant('boundary');
        $this->makeMobileChannel($tenant);
        [, $token] = $this->makeClientToken($tenant);

        // توكن Commerce Bearer لا يُخوِّل شيئاً على /store/v1 (سرّ بوابة مختلف تماماً
        // وغير مطلوب هنا أصلاً — المسار المتوارَث لا يتحقق من أي توكن).
        $this->getJson('/store/v1/no-such-store/storefront', $this->bearer($token))
            ->assertStatus(404);

        // ولا كوكي/سياق الويب يخوِّل شيئاً على /commerce/v1 — يتطلب دائماً Bearer.
        $this->getJson('/commerce/v1/storefront')
            ->assertStatus(401);
    }
}
