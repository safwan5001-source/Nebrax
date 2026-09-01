<?php

namespace Tests\Feature;

use App\Http\Middleware\AuthenticateApiClient;
use App\Http\Middleware\EnsureApiScope;
use App\Http\Middleware\ForceJsonResponse;
use App\Http\Middleware\PublicApiRequestContext;
use App\Http\Middleware\PublicApiTenantGuard;
use App\Models\ApiClient;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Support\PublicApiResponse;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use InvalidArgumentException;
use Laravel\Sanctum\NewAccessToken;
use Tests\TestCase;

/**
 * حدّ الأمان لـ PR-2: مصادقة عملاء/مفاتيح الـ Public API، أمان الأسرار، عزل
 * المستأجر fail-closed، والـ scopes. تشغيل: php artisan test --filter=PublicApiAuthTest
 */
class PublicApiAuthTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const AUTH_STACK = [AuthenticateApiClient::class, PublicApiTenantGuard::class];

    private function service(): ApiClientKeyService
    {
        return app(ApiClientKeyService::class);
    }

    private function makeTenant(string $slug = 'acme'): Tenant
    {
        return Tenant::create(['name' => $slug, 'slug' => $slug.'-'.Str::random(6)]);
    }

    /** @return array{0: ApiClient, 1: string, 2: NewAccessToken} */
    private function makeClientKey(Tenant $tenant, array $scopes = ['partners:read'], bool $active = true, ?Carbon $expiresAt = null): array
    {
        $client = $this->service()->createClient($tenant, 'integration', $active);
        $key = $this->service()->issueKey($client, 'default', $scopes, $expiresAt);

        return [$client, $key->plainTextToken, $key];
    }

    private function registerProbe(array $middleware, string $uri = '__probe', ?\Closure $action = null): void
    {
        $action ??= static fn () => PublicApiResponse::success(request(), ['ok' => true]);

        Route::middleware(array_merge([ForceJsonResponse::class, PublicApiRequestContext::class], $middleware))
            ->prefix('api/v1')
            ->group(fn () => Route::match(['get', 'post'], $uri, $action));
    }

    // ── Authentication ────────────────────────────────────────────────

    /** @test */
    public function missing_key_is_denied(): void
    {
        $this->registerProbe(self::AUTH_STACK);

        $this->getJson('/api/v1/__probe')
            ->assertStatus(401)
            ->assertJsonPath('error.code', 'unauthenticated');
    }

    /** @test */
    public function malformed_key_is_denied(): void
    {
        $this->registerProbe(self::AUTH_STACK);

        $this->withToken('this-is-not-a-valid-token')->getJson('/api/v1/__probe')
            ->assertStatus(401)
            ->assertJsonPath('error.code', 'unauthenticated');
    }

    /** @test */
    public function random_unknown_key_is_denied(): void
    {
        $this->registerProbe(self::AUTH_STACK);

        $this->withToken('999|'.Str::random(40))->getJson('/api/v1/__probe')
            ->assertStatus(401)
            ->assertJsonPath('error.code', 'unauthenticated');
    }

    /** @test */
    public function valid_key_is_accepted_on_protected_probe(): void
    {
        [, $plain] = $this->makeClientKey($this->makeTenant());
        $this->registerProbe(self::AUTH_STACK);

        $this->withToken($plain)->getJson('/api/v1/__probe')
            ->assertOk()
            ->assertJsonPath('data.ok', true)
            ->assertJsonStructure(['data', 'meta' => ['request_id']]);
    }

    /** @test */
    public function revoked_key_is_denied(): void
    {
        [$client, $plain, $key] = $this->makeClientKey($this->makeTenant());
        $this->service()->revokeKey($client, $key->accessToken->getKey());
        $this->registerProbe(self::AUTH_STACK);

        $this->withToken($plain)->getJson('/api/v1/__probe')
            ->assertStatus(401)
            ->assertJsonPath('error.code', 'unauthenticated');
    }

    /** @test */
    public function expired_key_is_denied(): void
    {
        [, $plain] = $this->makeClientKey($this->makeTenant(), ['partners:read'], true, now()->subMinute());
        $this->registerProbe(self::AUTH_STACK);

        $this->withToken($plain)->getJson('/api/v1/__probe')
            ->assertStatus(401)
            ->assertJsonPath('error.code', 'unauthenticated');
    }

    /** @test */
    public function inactive_client_is_denied(): void
    {
        [, $plain] = $this->makeClientKey($this->makeTenant(), ['partners:read'], false);
        $this->registerProbe(self::AUTH_STACK);

        $this->withToken($plain)->getJson('/api/v1/__probe')
            ->assertStatus(403)
            ->assertJsonPath('error.code', 'client_inactive');
    }

    /** @test */
    public function a_user_session_token_cannot_authenticate_on_public_api(): void
    {
        // عزل: توكن مستخدم Internal لا يُقبل على الـ Public API إطلاقًا.
        $user = $this->registerTenant('internal', 'u@internal.test');
        $this->registerProbe(self::AUTH_STACK);

        $this->withToken($user['token'])->getJson('/api/v1/__probe')
            ->assertStatus(401)
            ->assertJsonPath('error.code', 'unauthenticated');
    }

    // ── Secret handling ───────────────────────────────────────────────

    /** @test */
    public function plaintext_is_returned_once_and_only_the_hash_is_persisted(): void
    {
        [$client, $plain, $key] = $this->makeClientKey($this->makeTenant());

        $this->assertNotEmpty($plain);
        $this->assertStringContainsString('|', $plain, 'صيغة Sanctum: id|secret');
        [, $secret] = explode('|', $plain, 2);

        // المخزَّن = sha256(secret)، لا النصّ الصريح ولا السرّ الخام.
        $this->assertSame(hash('sha256', $secret), $key->accessToken->token);
        $this->assertNotSame($plain, $key->accessToken->token);

        $this->assertDatabaseHas('personal_access_tokens', [
            'id' => $key->accessToken->getKey(),
            'token' => hash('sha256', $secret),
        ]);
        $this->assertDatabaseMissing('personal_access_tokens', ['token' => $plain]);
        $this->assertDatabaseMissing('personal_access_tokens', ['token' => $secret]);

        // تسلسل العميل لا يكشف أي سرّ/تجزئة.
        $this->assertArrayNotHasKey('token', $client->toArray());
        $this->assertArrayNotHasKey('secret', $client->toArray());
    }

    // ── Tenant isolation ──────────────────────────────────────────────

    /** @test */
    public function tenant_context_is_derived_from_the_authenticated_client(): void
    {
        $tenant = $this->makeTenant('alpha');
        [, $plain] = $this->makeClientKey($tenant);

        $resolved = null;
        $this->registerProbe(self::AUTH_STACK, '__probe', function () use (&$resolved) {
            $resolved = app(TenantContext::class)->id();

            return PublicApiResponse::success(request(), ['ok' => true]);
        });

        $this->withToken($plain)->getJson('/api/v1/__probe')->assertOk();
        $this->assertSame($tenant->id, $resolved);
    }

    /** @test */
    public function tenant_scoped_public_route_fails_closed_without_authentication(): void
    {
        app(TenantContext::class)->forget();
        // الحارس وحده بلا مصادقة: لا سياق مستأجر → مغلق.
        $this->registerProbe([PublicApiTenantGuard::class]);

        $this->getJson('/api/v1/__probe')
            ->assertStatus(403)
            ->assertJsonPath('error.code', 'tenant_context_required');
    }

    /** @test */
    public function a_client_without_a_valid_active_tenant_fails_closed(): void
    {
        $tenant = $this->makeTenant('beta');
        [, $plain] = $this->makeClientKey($tenant);
        $tenant->forceFill(['is_active' => false])->save();
        $this->registerProbe(self::AUTH_STACK);

        $this->withToken($plain)->getJson('/api/v1/__probe')
            ->assertStatus(403)
            ->assertJsonPath('error.code', 'tenant_context_required');
    }

    /** @test */
    public function tenant_cannot_be_switched_via_header_query_or_body(): void
    {
        $a = $this->makeTenant('t-a');
        $b = $this->makeTenant('t-b');
        [, $plain] = $this->makeClientKey($a);

        $resolved = null;
        $this->registerProbe(self::AUTH_STACK, '__probe', function () use (&$resolved) {
            $resolved = app(TenantContext::class)->id();

            return PublicApiResponse::success(request(), ['ok' => true]);
        });

        // ترويسة
        $this->withToken($plain)->withHeaders(['X-Tenant-Id' => $b->id])
            ->getJson('/api/v1/__probe')->assertOk();
        $this->assertSame($a->id, $resolved, 'الترويسة لا تبدّل المستأجر');

        // معامل استعلام
        $resolved = null;
        $this->withToken($plain)->getJson('/api/v1/__probe?tenant_id='.$b->id)->assertOk();
        $this->assertSame($a->id, $resolved, 'معامل الاستعلام لا يبدّل المستأجر');

        // جسم الطلب
        $resolved = null;
        $this->withToken($plain)->postJson('/api/v1/__probe', ['tenant_id' => $b->id])->assertOk();
        $this->assertSame($a->id, $resolved, 'الجسم لا يبدّل المستأجر');
    }

    /** @test */
    public function a_client_cannot_revoke_another_clients_key(): void
    {
        $a = $this->makeTenant('own-a');
        $b = $this->makeTenant('own-b');
        [$clientA] = $this->makeClientKey($a);
        [, $plainB, $keyB] = $this->makeClientKey($b);

        // العميل A يحاول إبطال مفتاح العميل B → لا أثر (عزل الإدارة).
        $this->service()->revokeKey($clientA, $keyB->accessToken->getKey());

        $this->registerProbe(self::AUTH_STACK);
        $this->withToken($plainB)->getJson('/api/v1/__probe')->assertOk();
    }

    // ── Scopes ────────────────────────────────────────────────────────

    private function scopeStack(string $scope = 'partners:read'): array
    {
        return [AuthenticateApiClient::class, PublicApiTenantGuard::class, EnsureApiScope::class.':'.$scope];
    }

    /** @test */
    public function required_scope_succeeds(): void
    {
        [, $plain] = $this->makeClientKey($this->makeTenant(), ['partners:read']);
        $this->registerProbe($this->scopeStack('partners:read'));

        $this->withToken($plain)->getJson('/api/v1/__probe')->assertOk();
    }

    /** @test */
    public function missing_scope_is_denied(): void
    {
        [, $plain] = $this->makeClientKey($this->makeTenant(), ['products:read']);
        $this->registerProbe($this->scopeStack('partners:read'));

        $this->withToken($plain)->getJson('/api/v1/__probe')
            ->assertStatus(403)
            ->assertJsonPath('error.code', 'insufficient_scope');
    }

    /** @test */
    public function unrelated_scope_is_denied(): void
    {
        [, $plain] = $this->makeClientKey($this->makeTenant(), ['invoices:read']);
        $this->registerProbe($this->scopeStack('partners:read'));

        $this->withToken($plain)->getJson('/api/v1/__probe')
            ->assertStatus(403)
            ->assertJsonPath('error.code', 'insufficient_scope');
    }

    /** @test */
    public function multiple_scopes_behave_deterministically(): void
    {
        [, $plain] = $this->makeClientKey($this->makeTenant(), ['partners:read', 'products:read']);

        $this->registerProbe($this->scopeStack('partners:read'), '__ok');
        $this->registerProbe($this->scopeStack('invoices:read'), '__no');

        $this->withToken($plain)->getJson('/api/v1/__ok')->assertOk();
        $this->withToken($plain)->getJson('/api/v1/__no')
            ->assertStatus(403)
            ->assertJsonPath('error.code', 'insufficient_scope');
    }

    /** @test */
    public function issuing_an_unknown_scope_is_rejected_by_the_service(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->service()->issueKey($this->service()->createClient($this->makeTenant(), 'x'), 'k', ['bogus:read']);
    }

    /** @test */
    public function a_route_requiring_an_unknown_scope_denies(): void
    {
        [, $plain] = $this->makeClientKey($this->makeTenant(), ['partners:read']);
        $this->registerProbe($this->scopeStack('not:a:scope'));

        $this->withToken($plain)->getJson('/api/v1/__probe')
            ->assertStatus(403)
            ->assertJsonPath('error.code', 'insufficient_scope');
    }

    /** @test */
    public function a_wildcard_ability_does_not_grant_explicit_scopes(): void
    {
        // تقييد الـ wildcard: حتى لو حمل مفتاحٌ `*`، لا يُمنح scope غير مُدرَج تامًّا.
        $tenant = $this->makeTenant('wild');
        $client = $this->service()->createClient($tenant, 'x');
        $plain = $client->createToken('star', ['*'])->plainTextToken; // تجاوز الخدمة عمدًا للاختبار
        $this->registerProbe($this->scopeStack('partners:read'));

        $this->withToken($plain)->getJson('/api/v1/__probe')
            ->assertStatus(403)
            ->assertJsonPath('error.code', 'insufficient_scope');
    }

    // ── Regression ────────────────────────────────────────────────────

    /** @test */
    public function pr1_health_endpoint_remains_safe(): void
    {
        $this->getJson('/api/v1/health')
            ->assertOk()
            ->assertJsonPath('data.status', 'ok')
            ->assertJsonStructure(['data' => ['status', 'service', 'version'], 'meta' => ['request_id']]);
    }
}
