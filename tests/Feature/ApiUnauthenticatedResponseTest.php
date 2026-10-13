<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/**
 * مسارات /api/* المحمية تعيد 401 JSON لأي طلب مجهول مهما كان ترويس Accept
 * (كان يعيد 500 «Route [login] not defined» عند غياب Accept: application/json).
 * تشغيل:  php artisan test --filter=ApiUnauthenticatedResponseTest
 */
class ApiUnauthenticatedResponseTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const PROTECTED = ['/api/me', '/api/invoices', '/api/partners'];

    /** @return array<string, array{0: array<string, string>}> */
    public static function acceptHeaders(): array
    {
        return [
            'no Accept header'  => [[]],
            'Accept json'       => [['Accept' => 'application/json']],
            'Accept text/html'  => [['Accept' => 'text/html']],
            'Accept wildcard'   => [['Accept' => '*/*']],
        ];
    }

    /**
     * @test
     * @dataProvider acceptHeaders
     */
    public function anonymous_protected_api_requests_get_401_json(array $headers): void
    {
        foreach (self::PROTECTED as $uri) {
            $res = $this->call('GET', $uri, [], [], [], $this->transformHeadersToServerVars($headers));

            $res->assertStatus(401);
            $this->assertStringContainsString('application/json', (string) $res->headers->get('Content-Type'), $uri);
            $this->assertSame(['message' => 'Unauthenticated.'], $res->json(), $uri);
            $this->assertFalse($res->isRedirection(), $uri);
        }
    }

    /** @test */
    public function an_invalid_token_also_gets_401_json_without_accept(): void
    {
        $res = $this->call('GET', '/api/me', [], [], [], $this->transformHeadersToServerVars([
            'Authorization' => 'Bearer not-a-real-token',
        ]));

        $res->assertStatus(401);
        $this->assertSame(['message' => 'Unauthenticated.'], $res->json());
    }

    /** @test */
    public function unauthenticated_response_leaks_no_tenant_data(): void
    {
        $this->registerTenant('nibras', 'owner@nibras.test');

        $res = $this->call('GET', '/api/invoices');

        $res->assertStatus(401);
        $this->assertSame(['message' => 'Unauthenticated.'], $res->json());
        $body = $res->getContent();
        $this->assertStringNotContainsString('nibras', $body);
        $this->assertStringNotContainsString('tenant', strtolower($body));
        $this->assertStringNotContainsString('Route [login]', $body);
    }

    /** @test */
    public function authenticated_access_remains_valid_without_accept(): void
    {
        $auth = $this->registerTenant();

        $this->call('GET', '/api/me', [], [], [], $this->transformHeadersToServerVars([
            'Authorization' => 'Bearer ' . $auth['token'],
        ]))->assertOk();
    }

    /** @test */
    public function authorization_denied_remains_403(): void
    {
        $auth  = $this->registerTenant();
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@acme.test');

        $this->withToken($staff)->postJson('/api/partners', [
            'name' => 'عميل', 'type' => 'customer',
        ])->assertForbidden();
    }

    /** @test */
    public function validation_errors_keep_their_422_contract(): void
    {
        $this->postJson('/api/login', [])->assertStatus(422);
    }

    /** @test */
    public function non_api_guarded_routes_keep_the_web_redirect(): void
    {
        Route::get('/login', fn () => 'login')->name('login');
        Route::middleware(['web', 'auth'])->get('/__web-guarded', fn () => 'ok');
        $this->app['router']->getRoutes()->refreshNameLookups();

        $this->get('/__web-guarded', ['Accept' => 'text/html'])
            ->assertRedirect(route('login'));

        // طلب JSON صريح خارج /api يبقى 401 JSON كما كان.
        $this->getJson('/__web-guarded')->assertStatus(401);
    }
}
