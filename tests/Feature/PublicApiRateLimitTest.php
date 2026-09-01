<?php

namespace Tests\Feature;

use App\Http\Middleware\AuthenticateApiClient;
use App\Http\Middleware\EnforcePublicApiRateLimit;
use App\Http\Middleware\ForceJsonResponse;
use App\Http\Middleware\PublicApiRequestContext;
use App\Http\Middleware\PublicApiTenantGuard;
use App\Models\ApiClient;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Support\PublicApiRateLimits;
use App\Support\PublicApiResponse;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * PR-4: حدّ معدّل الـ Public API لكل عميل API. يغطّي: بلوغ الحدّ، عزل الفئات
 * بين عميلين (نفس المستأجر وعبر المستأجرين)، مقاومة الترويسات المزوَّرة، عقد
 * 429، الترويسات، حفظ request_id، حدّ مسارات القراءة الحقيقية، وحماية IP للطلب
 * غير المصادَق. بلا انتظار زمني (wall-clock).
 * تشغيل: php artisan test --filter=PublicApiRateLimitTest
 */
class PublicApiRateLimitTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function service(): ApiClientKeyService
    {
        return app(ApiClientKeyService::class);
    }

    private function makeTenant(string $slug = 'acme'): Tenant
    {
        return Tenant::create(['name' => $slug, 'slug' => $slug . '-' . Str::random(6)]);
    }

    /** @return array{0: ApiClient, 1: string} */
    private function makeClientKey(Tenant $tenant, string $name = 'integration'): array
    {
        $client = $this->service()->createClient($tenant, $name);
        $key = $this->service()->issueKey($client, 'default', ['partners:read']);

        return [$client, $key->plainTextToken];
    }

    /** مسبار محميّ بحدّ الفئة المعطاة (افتراضيًا sensitive = 10 لاختباراتٍ صغيرة). */
    private function registerProbe(string $rateClass = PublicApiRateLimits::CLASS_SENSITIVE, string $uri = '__rl'): void
    {
        Route::middleware([
            ForceJsonResponse::class,
            PublicApiRequestContext::class,
            AuthenticateApiClient::class,
            PublicApiTenantGuard::class,
            EnforcePublicApiRateLimit::class . ':' . $rateClass,
        ])->prefix('api/v1')->group(fn () => Route::get($uri, fn () => PublicApiResponse::success(request(), ['ok' => true])));
    }

    // ── بلوغ الحدّ ────────────────────────────────────────────────────

    /** @test */
    public function a_client_is_limited_after_its_class_limit(): void
    {
        [, $token] = $this->makeClientKey($this->makeTenant());
        $this->registerProbe(PublicApiRateLimits::CLASS_SENSITIVE);
        $limit = PublicApiRateLimits::limitFor(PublicApiRateLimits::CLASS_SENSITIVE);

        for ($i = 0; $i < $limit; $i++) {
            $this->withToken($token)->getJson('/api/v1/__rl')->assertOk();
        }

        $this->withToken($token)->getJson('/api/v1/__rl')
            ->assertStatus(429)
            ->assertJsonPath('error.code', 'rate_limited')
            ->assertHeader('X-RateLimit-Limit', (string) $limit)
            ->assertHeader('X-RateLimit-Remaining', '0')
            ->assertHeader('Retry-After');
    }

    /** @test */
    public function rate_limit_headers_are_present_on_success(): void
    {
        [, $token] = $this->makeClientKey($this->makeTenant());
        $this->registerProbe(PublicApiRateLimits::CLASS_SENSITIVE);
        $limit = PublicApiRateLimits::limitFor(PublicApiRateLimits::CLASS_SENSITIVE);

        $this->withToken($token)->getJson('/api/v1/__rl')
            ->assertOk()
            ->assertHeader('X-RateLimit-Limit', (string) $limit)
            ->assertHeader('X-RateLimit-Remaining', (string) ($limit - 1));
    }

    // ── عزل بين العملاء ───────────────────────────────────────────────

    /** @test */
    public function a_second_client_in_the_same_tenant_is_not_blocked_by_the_first(): void
    {
        $tenant = $this->makeTenant('shared');
        [, $tokenA] = $this->makeClientKey($tenant, 'client-a');
        [, $tokenB] = $this->makeClientKey($tenant, 'client-b');
        $this->registerProbe(PublicApiRateLimits::CLASS_SENSITIVE);
        $limit = PublicApiRateLimits::limitFor(PublicApiRateLimits::CLASS_SENSITIVE);

        for ($i = 0; $i < $limit; $i++) {
            $this->withToken($tokenA)->getJson('/api/v1/__rl')->assertOk();
        }
        $this->withToken($tokenA)->getJson('/api/v1/__rl')->assertStatus(429);

        // عميل آخر في المستأجر نفسه لا يتأثّر — الحدّ لكل عميل لا لكل مستأجر.
        $this->withToken($tokenB)->getJson('/api/v1/__rl')->assertOk();
    }

    /** @test */
    public function cross_tenant_clients_do_not_share_a_bucket(): void
    {
        [, $tokenA] = $this->makeClientKey($this->makeTenant('t-a'));
        [, $tokenB] = $this->makeClientKey($this->makeTenant('t-b'));
        $this->registerProbe(PublicApiRateLimits::CLASS_SENSITIVE);
        $limit = PublicApiRateLimits::limitFor(PublicApiRateLimits::CLASS_SENSITIVE);

        for ($i = 0; $i < $limit; $i++) {
            $this->withToken($tokenA)->getJson('/api/v1/__rl')->assertOk();
        }
        $this->withToken($tokenA)->getJson('/api/v1/__rl')->assertStatus(429);

        $this->withToken($tokenB)->getJson('/api/v1/__rl')->assertOk();
    }

    // ── مقاومة الترويسات المزوَّرة ────────────────────────────────────

    /** @test */
    public function spoofed_headers_cannot_change_the_limiter_identity(): void
    {
        [, $token] = $this->makeClientKey($this->makeTenant());
        $this->registerProbe(PublicApiRateLimits::CLASS_SENSITIVE);
        $limit = PublicApiRateLimits::limitFor(PublicApiRateLimits::CLASS_SENSITIVE);

        for ($i = 0; $i < $limit; $i++) {
            $this->withToken($token)->getJson('/api/v1/__rl')->assertOk();
        }

        // ترويسات مزوَّرة لا تُنشئ دلوًا جديدًا — الهوية من العميل المصادَق لا الترويسة.
        $this->withToken($token)
            ->withHeaders([
                'X-Forwarded-For' => '203.0.113.9',
                'X-Real-IP'       => '203.0.113.9',
                'X-Client-Id'     => 'spoofed',
            ])
            ->getJson('/api/v1/__rl')
            ->assertStatus(429);
    }

    // ── عقد 429 ───────────────────────────────────────────────────────

    /** @test */
    public function request_id_is_preserved_on_a_429(): void
    {
        [, $token] = $this->makeClientKey($this->makeTenant());
        $this->registerProbe(PublicApiRateLimits::CLASS_SENSITIVE);
        $limit = PublicApiRateLimits::limitFor(PublicApiRateLimits::CLASS_SENSITIVE);

        for ($i = 0; $i < $limit; $i++) {
            $this->withToken($token)->getJson('/api/v1/__rl')->assertOk();
        }

        $response = $this->withToken($token)->getJson('/api/v1/__rl')->assertStatus(429);
        $response->assertHeader('X-Request-Id');
        $this->assertNotEmpty($response->json('meta.request_id'));
    }

    // ── مسارات القراءة الحقيقية محدودة ────────────────────────────────

    /** @test */
    public function real_read_routes_are_rate_limited(): void
    {
        [$client, $token] = $this->makeClientKey($this->makeTenant());
        $readLimit = PublicApiRateLimits::limitFor(PublicApiRateLimits::CLASS_READ);

        // إشباع دلو القراءة لهذا العميل مباشرةً (بلا إطلاق 100 طلب HTTP).
        $key = EnforcePublicApiRateLimit::keyFor(
            PublicApiRateLimits::CLASS_READ, (string) $client->tenant_id, (string) $client->getKey(),
        );
        for ($i = 0; $i < $readLimit; $i++) {
            RateLimiter::hit($key, PublicApiRateLimits::WINDOW_SECONDS);
        }

        $this->withToken($token)->getJson('/api/v1/partners')
            ->assertStatus(429)
            ->assertJsonPath('error.code', 'rate_limited');
    }

    // ── حماية IP للطلب غير المصادَق ───────────────────────────────────

    /** @test */
    public function unauthenticated_requests_are_limited_by_ip(): void
    {
        // مسبار بلا مصادقة: الهوية IP (لا عميل) — بذرة حماية المسارات العامة.
        Route::middleware([
            ForceJsonResponse::class,
            PublicApiRequestContext::class,
            EnforcePublicApiRateLimit::class . ':' . PublicApiRateLimits::CLASS_UNAUTH,
        ])->prefix('api/v1')->group(fn () => Route::get('__rl_pub', fn () => PublicApiResponse::success(request(), ['ok' => true])));

        $limit = PublicApiRateLimits::limitFor(PublicApiRateLimits::CLASS_UNAUTH);
        for ($i = 0; $i < $limit; $i++) {
            $this->getJson('/api/v1/__rl_pub')->assertOk();
        }

        $this->getJson('/api/v1/__rl_pub')
            ->assertStatus(429)
            ->assertJsonPath('error.code', 'rate_limited');
    }
}
