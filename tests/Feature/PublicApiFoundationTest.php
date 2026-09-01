<?php

namespace Tests\Feature;

use App\Http\Middleware\ForceJsonResponse;
use App\Http\Middleware\PublicApiRequestContext;
use App\Http\Middleware\PublicApiTenantGuard;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\Route;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

/**
 * اختبارات أساس الـ Public API (v1) — PR-1.
 *
 * لا تلمس قاعدة البيانات إطلاقًا (لا RefreshDatabase): الأساس بلا استعلامات،
 * فيبقى الاختبار مستقرًّا على SQLite وPostgreSQL معًا. يغطّي: عقد الاستجابة،
 * معرّف الطلب، عدم تصادم الـ namespace مع الـ Internal API، عدم كشف بيانات،
 * حدود الأخطاء، والحارس fail-closed للمستأجر (شرط ما قبل مسارات PR-3).
 *
 * تشغيل:  php artisan test --filter=PublicApiFoundationTest
 */
class PublicApiFoundationTest extends TestCase
{
    /** يسجّل مسارًا مؤقتًا داخل مجموعة الـ Public API نفسها (وسائطها الحقيقية). */
    private function registerPublicRoute(string $uri, \Closure $action, array $extraMiddleware = []): void
    {
        Route::middleware(array_merge([ForceJsonResponse::class, PublicApiRequestContext::class], $extraMiddleware))
            ->prefix('api/v1')
            ->group(fn () => Route::get($uri, $action));
    }

    /** @test */
    public function health_returns_ok_with_the_unified_envelope(): void
    {
        $response = $this->getJson('/api/v1/health');

        $response->assertOk()
            ->assertJsonStructure([
                'data' => ['status', 'service', 'version'],
                'meta' => ['request_id'],
            ])
            ->assertJsonPath('data.status', 'ok')
            ->assertJsonPath('data.service', 'awj-public-api')
            ->assertJsonPath('data.version', 'v1');
    }

    /** @test */
    public function health_carries_a_request_id_in_both_meta_and_header(): void
    {
        $response = $this->getJson('/api/v1/health');

        $response->assertOk()->assertHeader('X-Request-Id');

        $metaId   = $response->json('meta.request_id');
        $headerId = $response->headers->get('X-Request-Id');

        $this->assertNotEmpty($metaId);
        $this->assertSame($metaId, $headerId, 'meta.request_id يجب أن يطابق ترويسة الاستجابة.');
    }

    /** @test */
    public function a_valid_client_request_id_is_echoed_back(): void
    {
        $clientId = 'req_ABC-123.def';

        $response = $this->withHeaders(['X-Request-Id' => $clientId])->getJson('/api/v1/health');

        $response->assertOk()
            ->assertJsonPath('meta.request_id', $clientId)
            ->assertHeader('X-Request-Id', $clientId);
    }

    /** @test */
    public function an_unsafe_client_request_id_is_rejected_and_replaced(): void
    {
        // يحوي مسافات ومحارف غير آمنة → لا يوثَق به، يُستبدَل بمعرّف مولَّد.
        $unsafe = 'not a safe id !! <script>';

        $response = $this->withHeaders(['X-Request-Id' => $unsafe])->getJson('/api/v1/health');

        $response->assertOk();
        $this->assertNotSame($unsafe, $response->json('meta.request_id'));
        $this->assertNotEmpty($response->json('meta.request_id'));

        // وكذلك القيمة الأقصر من الحد الأدنى (طول < 8) تُستبدَل.
        $short = $this->withHeaders(['X-Request-Id' => 'abc'])->getJson('/api/v1/health');
        $this->assertNotSame('abc', $short->json('meta.request_id'));
    }

    /** @test */
    public function the_public_v1_namespace_does_not_collide_with_internal_api(): void
    {
        // الـ Internal health يبقى بعقده الخام (بلا مغلّف) — لم يتغيّر.
        $this->getJson('/api/health')
            ->assertOk()
            ->assertExactJson(['status' => 'ok']);

        // الـ Public health بعقده المغلّف — مستقل تمامًا.
        $this->getJson('/api/v1/health')
            ->assertOk()
            ->assertJsonStructure(['data', 'meta' => ['request_id']]);
    }

    /** @test */
    public function health_exposes_no_tenant_or_secret_or_internal_data(): void
    {
        $response = $this->getJson('/api/v1/health');
        $body = $response->getContent();

        // بنية الاستجابة محصورة في المفاتيح المسموح بها فقط.
        $this->assertSame(['status', 'service', 'version'], array_keys($response->json('data')));

        foreach (['password', 'secret', 'APP_KEY', 'DB_', 'tenant_id', 'vat_number', 'credential', 'token', 'trace'] as $needle) {
            $this->assertStringNotContainsStringIgnoringCase($needle, $body, "الاستجابة يجب ألّا تكشف: {$needle}");
        }
    }

    /** @test */
    public function tenant_scoped_public_route_fails_closed_without_tenant_context(): void
    {
        // شرط PR-3 المعماري: بلا TenantContext يُرفض الطلب قبل أي بيانات.
        app(TenantContext::class)->forget();

        $this->registerPublicRoute(
            '__tenant_probe',
            fn () => response()->json(['reached' => true]),
            [PublicApiTenantGuard::class],
        );

        $this->getJson('/api/v1/__tenant_probe')
            ->assertStatus(403)
            ->assertJsonPath('error.code', 'tenant_context_required')
            ->assertJsonStructure(['error' => ['code', 'message'], 'meta' => ['request_id']]);
    }

    /** @test */
    public function tenant_scoped_public_route_passes_when_tenant_context_present(): void
    {
        $this->registerPublicRoute(
            '__tenant_probe_ok',
            fn () => response()->json(['reached' => true]),
            [PublicApiTenantGuard::class],
        );

        app(TenantContext::class)->set('11111111-1111-1111-1111-111111111111');

        $this->getJson('/api/v1/__tenant_probe_ok')
            ->assertOk()
            ->assertJsonPath('reached', true);

        app(TenantContext::class)->forget();
    }

    /** @test */
    public function unexpected_exceptions_are_enveloped_without_leaking_internals(): void
    {
        $this->registerPublicRoute('__boom', function () {
            throw new \RuntimeException('super secret internal detail');
        });

        $response = $this->getJson('/api/v1/__boom');
        $response->assertStatus(500)
            ->assertJsonPath('error.code', 'internal_error')
            ->assertJsonPath('error.message', 'حدث خطأ غير متوقع.')
            ->assertJsonStructure(['error' => ['code', 'message'], 'meta' => ['request_id']]);

        $body = $response->getContent();
        $this->assertStringNotContainsString('super secret internal detail', $body);
        $this->assertStringNotContainsStringIgnoringCase('RuntimeException', $body);
    }

    /** @test */
    public function validation_exceptions_map_to_a_422_envelope_with_details(): void
    {
        $this->registerPublicRoute('__validate', function () {
            throw ValidationException::withMessages(['name' => 'الاسم مطلوب.']);
        });

        $this->getJson('/api/v1/__validate')
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'validation_failed')
            ->assertJsonStructure(['error' => ['code', 'message', 'details' => ['name']], 'meta' => ['request_id']]);
    }
}
