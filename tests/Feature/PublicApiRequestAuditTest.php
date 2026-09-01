<?php

namespace Tests\Feature;

use App\Http\Middleware\AuthenticateApiClient;
use App\Http\Middleware\EnforceApiIdempotency;
use App\Http\Middleware\EnforcePublicApiRateLimit;
use App\Http\Middleware\ForceJsonResponse;
use App\Http\Middleware\PublicApiRequestAudit;
use App\Http\Middleware\PublicApiRequestContext;
use App\Http\Middleware\PublicApiTenantGuard;
use App\Models\ApiClient;
use App\Models\PublicApiRequestLog;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Support\PublicApiRateLimits;
use App\Support\PublicApiResponse;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * PR-4: تدقيق طلبات الـ Public API (تشغيلي/أمني، بيانات وصفية فقط). يغطّي:
 * التقاط البيانات الوصفية، تنقية الأسرار (لا مفتاح/Authorization/جسم)، تدقيق
 * الرفض 4xx و429، ربط request_id، استثناء الصحّة، حدّ User-Agent، عزل المستأجر،
 * وربط حالة idempotency. الجدول داخلي للمنصة — لا يُكشف عبر أيّ مسار Public.
 * تشغيل: php artisan test --filter=PublicApiRequestAuditTest
 */
class PublicApiRequestAuditTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function service(): ApiClientKeyService
    {
        return app(ApiClientKeyService::class);
    }

    /** @return array{0: Tenant, 1: ApiClient, 2: string} */
    private function seedClient(string $slug = 'acme', array $scopes = ['partners:read']): array
    {
        $tenant = Tenant::create(['name' => $slug, 'slug' => $slug . '-' . Str::random(6)]);
        $client = $this->service()->createClient($tenant, 'integration');
        $token = $this->service()->issueKey($client, 'default', $scopes)->plainTextToken;

        return [$tenant, $client, $token];
    }

    private function logs()
    {
        return PublicApiRequestLog::withoutGlobalScopes();
    }

    // ── التقاط البيانات الوصفية ───────────────────────────────────────

    /** @test */
    public function a_successful_request_is_audited_with_metadata(): void
    {
        [$tenant, $client, $token] = $this->seedClient();

        $response = $this->withToken($token)
            ->withHeaders(['User-Agent' => 'IntegrationBot/1.0'])
            ->getJson('/api/v1/partners?page=1&per_page=10')
            ->assertOk();

        $this->assertSame(1, $this->logs()->count());
        $log = $this->logs()->first();

        $this->assertSame($tenant->id, $log->tenant_id);
        $this->assertSame($client->getKey(), $log->api_client_id);
        $this->assertSame('GET', $log->method);
        $this->assertSame(200, $log->response_status);
        $this->assertSame('partners:read', $log->scope);
        $this->assertFalse($log->rate_limited);
        $this->assertNotNull($log->duration_ms);
        $this->assertGreaterThanOrEqual(0, $log->duration_ms);
        $this->assertNotNull($log->ip);
        $this->assertSame('IntegrationBot/1.0', $log->user_agent);
        $this->assertSame(['page' => '1', 'per_page' => '10'], $log->query_params);

        // ربط request_id بين الاستجابة والسجلّ.
        $this->assertSame($response->headers->get('X-Request-Id'), $log->request_id);
        $this->assertSame($response->json('meta.request_id'), $log->request_id);
    }

    // ── تنقية الأسرار ─────────────────────────────────────────────────

    /** @test */
    public function secrets_and_bodies_are_never_persisted(): void
    {
        [, , $token] = $this->seedClient();

        $this->withToken($token)
            ->withHeaders(['User-Agent' => 'UA', 'X-Custom-Secret' => 'top-secret-value'])
            ->getJson('/api/v1/partners')
            ->assertOk();

        $log = $this->logs()->first();
        $serialized = json_encode($log->getAttributes(), JSON_UNESCAPED_UNICODE);

        // لا مفتاح خام، ولا سرّ ترويسة، ولا صيغة Bearer، ولا Authorization.
        [, $secret] = explode('|', $token, 2);
        $this->assertStringNotContainsString($token, $serialized);
        $this->assertStringNotContainsString($secret, $serialized);
        $this->assertStringNotContainsString('top-secret-value', $serialized);
        $this->assertStringNotContainsString('Bearer', $serialized);

        // لا عمود لجسم الطلب/الاستجابة.
        $keys = array_keys($log->getAttributes());
        $this->assertNotContains('body', $keys);
        $this->assertNotContains('request_body', $keys);
        $this->assertNotContains('response_body', $keys);
        $this->assertNotContains('authorization', $keys);
    }

    // ── تدقيق الرفض ───────────────────────────────────────────────────

    /** @test */
    public function a_scope_denied_request_is_audited(): void
    {
        // مفتاح بلا partners:read يطرق مورد الشركاء ⇒ 403.
        [, , $token] = $this->seedClient('a', ['products:read']);

        $this->withToken($token)->getJson('/api/v1/partners')
            ->assertStatus(403)->assertJsonPath('error.code', 'insufficient_scope');

        $this->assertSame(1, $this->logs()->count());
        $log = $this->logs()->first();
        $this->assertSame(403, $log->response_status);
        $this->assertSame('partners:read', $log->scope); // الـ scope المطلوب سُجِّل رغم الرفض.
        $this->assertFalse($log->rate_limited);
    }

    /** @test */
    public function a_rate_limited_request_is_audited(): void
    {
        [$tenant, $client, $token] = $this->seedClient();

        $key = EnforcePublicApiRateLimit::keyFor(
            PublicApiRateLimits::CLASS_READ, (string) $client->tenant_id, (string) $client->getKey(),
        );
        $readLimit = PublicApiRateLimits::limitFor(PublicApiRateLimits::CLASS_READ);
        for ($i = 0; $i < $readLimit; $i++) {
            RateLimiter::hit($key, PublicApiRateLimits::WINDOW_SECONDS);
        }

        $this->withToken($token)->getJson('/api/v1/partners')->assertStatus(429);

        $log = $this->logs()->first();
        $this->assertSame(429, $log->response_status);
        $this->assertTrue($log->rate_limited);
    }

    // ── استثناء الصحّة ────────────────────────────────────────────────

    /** @test */
    public function the_health_endpoint_is_not_audited(): void
    {
        $this->getJson('/api/v1/health')->assertOk();

        $this->assertSame(0, $this->logs()->count());
    }

    // ── حدود ──────────────────────────────────────────────────────────

    /** @test */
    public function user_agent_is_length_bounded(): void
    {
        [, , $token] = $this->seedClient();

        $this->withToken($token)
            ->withHeaders(['User-Agent' => str_repeat('A', 300)])
            ->getJson('/api/v1/partners')->assertOk();

        $log = $this->logs()->first();
        $this->assertLessThanOrEqual(255, mb_strlen((string) $log->user_agent));
    }

    // ── عزل المستأجر ──────────────────────────────────────────────────

    /** @test */
    public function audit_records_are_tenant_isolated(): void
    {
        [$tenantA, , $tokenA] = $this->seedClient('t-a');
        [$tenantB, , $tokenB] = $this->seedClient('t-b');

        $this->withToken($tokenA)->getJson('/api/v1/partners')->assertOk();
        $this->withToken($tokenB)->getJson('/api/v1/partners')->assertOk();

        $this->assertSame(2, $this->logs()->count());

        app(TenantContext::class)->set($tenantA->id);
        $this->assertSame(1, PublicApiRequestLog::count()); // نطاق المستأجر يقصر الرؤية على A.
        app(TenantContext::class)->set($tenantB->id);
        $this->assertSame(1, PublicApiRequestLog::count());
        app(TenantContext::class)->forget();
    }

    // ── ربط حالة idempotency ──────────────────────────────────────────

    /** @test */
    public function idempotency_replay_is_recorded_in_audit(): void
    {
        [, , $token] = $this->seedClient();
        $exec = 0;
        // ملاحظة: يُنشأ الفعل **خارج** الدالة السهمية — فالتقاط `&$exec` يرتبط
        // بمتغيّر الاختبار لا بنسخةٍ قيمية داخل `fn ()`.
        $action = function () use (&$exec) {
            $exec++;

            return PublicApiResponse::success(request(), ['n' => $exec], 201);
        };

        Route::middleware([
            ForceJsonResponse::class,
            PublicApiRequestContext::class,
            AuthenticateApiClient::class,
            PublicApiTenantGuard::class,
            PublicApiRequestAudit::class,
            EnforceApiIdempotency::class,
        ])->prefix('api/v1')->group(fn () => Route::post('__audit_idem', $action));

        $this->withToken($token)
            ->postJson('/api/v1/__audit_idem', ['amount' => 5], ['Idempotency-Key' => 'audit-idem-key'])
            ->assertStatus(201);
        $this->withToken($token)
            ->postJson('/api/v1/__audit_idem', ['amount' => 5], ['Idempotency-Key' => 'audit-idem-key'])
            ->assertStatus(201)->assertHeader('Idempotency-Replayed', 'true');

        $statuses = $this->logs()->orderBy('created_at')->pluck('idempotency_status')->all();
        $this->assertContains('created', $statuses);
        $this->assertContains('replayed', $statuses);
        $this->assertSame(1, $exec, 'الإعادة لم تُنفِّذ العملية ثانية');
    }
}
