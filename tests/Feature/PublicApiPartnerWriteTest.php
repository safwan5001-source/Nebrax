<?php

namespace Tests\Feature;

use App\Models\ApiClient;
use App\Models\Partner;
use App\Models\PublicApiIdempotencyKey;
use App\Models\PublicApiRequestLog;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Support\PublicApiIdempotency;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * PR-5: إنشاء طرف عبر الـ Public API (كتابة محكومة). يغطّي المصادقة/عزل الـ scope،
 * الإنشاء الصحيح والعقد المُنتقى، رفض حقن tenant_id، idempotency (إعادة/تعارض/مفتاح
 * مفقود)، والتدقيق وحدّ المعدّل. تشغيل: php artisan test --filter=PublicApiPartnerWriteTest
 */
class PublicApiPartnerWriteTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const URI = '/api/v1/partners';

    private function service(): ApiClientKeyService
    {
        return app(ApiClientKeyService::class);
    }

    private function makeTenant(string $slug = 'acme'): Tenant
    {
        return Tenant::create(['name' => $slug, 'slug' => $slug . '-' . Str::random(6)]);
    }

    private function key(Tenant $tenant, array $scopes): string
    {
        $client = $this->service()->createClient($tenant, 'integration');

        return $this->service()->issueKey($client, 'k', $scopes)->plainTextToken;
    }

    /** @return array<string, mixed> */
    private function payload(array $overrides = []): array
    {
        return array_merge([
            'name'       => 'شركة الاختبار',
            'type'       => 'customer',
            'vat_number' => '300000000000003',
            'email'      => 'c@test.test',
        ], $overrides);
    }

    private function idem(string $key = 'partner-key-1'): array
    {
        return ['Idempotency-Key' => $key];
    }

    // ── auth / scope isolation ────────────────────────────────────────

    /** @test */
    public function no_api_key_is_denied(): void
    {
        $this->postJson(self::URI, $this->payload(), $this->idem())->assertStatus(401);
    }

    /** @test */
    public function a_human_user_token_is_denied(): void
    {
        $user = $this->registerTenant('internal', 'u@internal.test');
        $this->withToken($user['token'])->postJson(self::URI, $this->payload(), $this->idem())
            ->assertStatus(401)->assertJsonPath('error.code', 'unauthenticated');
    }

    /** @test */
    public function a_read_scope_cannot_write(): void
    {
        $token = $this->key($this->makeTenant(), ['partners:read']);
        $this->withToken($token)->postJson(self::URI, $this->payload(), $this->idem())
            ->assertStatus(403)->assertJsonPath('error.code', 'insufficient_scope');
        $this->assertSame(0, Partner::count());
    }

    /** @test */
    public function an_unrelated_write_scope_is_denied(): void
    {
        $token = $this->key($this->makeTenant(), ['products:write']);
        $this->withToken($token)->postJson(self::URI, $this->payload(), $this->idem())
            ->assertStatus(403)->assertJsonPath('error.code', 'insufficient_scope');
    }

    /** @test */
    public function an_inactive_client_is_denied(): void
    {
        $tenant = $this->makeTenant();
        $client = $this->service()->createClient($tenant, 'x', false);
        $token = $this->service()->issueKey($client, 'k', ['partners:write'])->plainTextToken;

        $this->withToken($token)->postJson(self::URI, $this->payload(), $this->idem())
            ->assertStatus(403)->assertJsonPath('error.code', 'client_inactive');
    }

    // ── create ────────────────────────────────────────────────────────

    /** @test */
    public function a_valid_request_creates_a_partner_with_a_curated_contract(): void
    {
        $tenant = $this->makeTenant();
        $token = $this->key($tenant, ['partners:write']);

        $res = $this->withToken($token)->postJson(self::URI, $this->payload(), $this->idem())
            ->assertStatus(201)
            ->assertJsonPath('data.name', 'شركة الاختبار')
            ->assertJsonPath('data.type', 'customer')
            ->assertJsonStructure(['data' => ['id', 'name', 'type', 'address'], 'meta' => ['request_id']]);

        // العقد المُنتقى لا يكشف الداخليّ (رصيد/حدّ ائتمان/تصنيف).
        $data = $res->json('data');
        foreach (['credit_limit', 'opening_balance', 'customer_classification_id', 'tenant_id'] as $hidden) {
            $this->assertArrayNotHasKey($hidden, $data);
        }

        $this->assertSame(1, Partner::count());
        $partner = Partner::withoutGlobalScopes()->firstOrFail();
        $this->assertSame($tenant->id, $partner->tenant_id);
    }

    /** @test */
    public function tenant_id_injection_is_ignored(): void
    {
        $tenant = $this->makeTenant('a');
        $other = $this->makeTenant('b');
        $token = $this->key($tenant, ['partners:write']);

        $res = $this->withToken($token)->postJson(self::URI, $this->payload(['tenant_id' => $other->id]), $this->idem())
            ->assertStatus(201);

        $partner = Partner::withoutGlobalScopes()->findOrFail($res->json('data.id'));
        $this->assertSame($tenant->id, $partner->tenant_id, 'المستأجر من العميل لا من الجسم');
    }

    /** @test */
    public function missing_required_fields_are_rejected(): void
    {
        $token = $this->key($this->makeTenant(), ['partners:write']);
        $this->withToken($token)->postJson(self::URI, ['type' => 'customer'], $this->idem())
            ->assertStatus(422)->assertJsonPath('error.code', 'validation_failed');
        $this->assertSame(0, Partner::count());
    }

    /** @test */
    public function opening_balance_creates_no_journal_entry(): void
    {
        // الرصيد الافتتاحي خارج العقد العام؛ حتى لو أُرسل يُسقَط، فلا قيد يُولَّد.
        $token = $this->key($this->makeTenant(), ['partners:write']);
        $this->withToken($token)->postJson(self::URI, $this->payload(['opening_balance' => 500000]), $this->idem())
            ->assertStatus(201);

        $this->assertSame(0, \App\Models\JournalEntry::count());
    }

    // ── idempotency ───────────────────────────────────────────────────

    /** @test */
    public function missing_idempotency_key_is_rejected(): void
    {
        $token = $this->key($this->makeTenant(), ['partners:write']);
        $this->withToken($token)->postJson(self::URI, $this->payload())
            ->assertStatus(400)->assertJsonPath('error.code', 'idempotency_key_required');
        $this->assertSame(0, Partner::count());
    }

    /** @test */
    public function a_duplicate_request_replays_and_does_not_create_twice(): void
    {
        $token = $this->key($this->makeTenant(), ['partners:write']);
        $payload = $this->payload(['name' => 'مكرّر']);

        $a = $this->withToken($token)->postJson(self::URI, $payload, $this->idem('replay-key-1'))->assertStatus(201);
        $b = $this->withToken($token)->postJson(self::URI, $payload, $this->idem('replay-key-1'))
            ->assertStatus(201)->assertHeader('Idempotency-Replayed', 'true');

        $this->assertSame($a->json('data.id'), $b->json('data.id'));
        $this->assertSame(1, Partner::count());
    }

    /** @test */
    public function same_key_with_changed_payload_conflicts(): void
    {
        $token = $this->key($this->makeTenant(), ['partners:write']);

        $this->withToken($token)->postJson(self::URI, $this->payload(['name' => 'أول']), $this->idem('conflict-key-1'))->assertStatus(201);
        $this->withToken($token)->postJson(self::URI, $this->payload(['name' => 'ثانٍ']), $this->idem('conflict-key-1'))
            ->assertStatus(409)->assertJsonPath('error.code', 'idempotency_conflict');

        $this->assertSame(1, Partner::count());
    }

    /** @test */
    public function a_concurrent_duplicate_in_progress_does_not_create_a_second_partner(): void
    {
        $tenant = $this->makeTenant();
        $client = $this->service()->createClient($tenant, 'integration');
        $token = $this->service()->issueKey($client, 'k', ['partners:write'])->plainTextToken;
        $payload = $this->payload();

        // يحاكي طلبًا متزامنًا سبق أن طالب بالمفتاح ولا يزال قيد التنفيذ.
        $fingerprint = PublicApiIdempotency::fingerprintParts(
            'POST', 'api/v1/partners', [], json_encode($payload), 'application/json',
        );
        app(TenantContext::class)->set($tenant->id);
        PublicApiIdempotencyKey::create([
            'tenant_id' => $tenant->id, 'api_client_id' => $client->getKey(),
            'key_hash' => PublicApiIdempotency::hashKey('concurrent-key-1'), 'method' => 'POST',
            'route_identity' => 'public.v1.partners.store', 'request_fingerprint' => $fingerprint,
            'status' => PublicApiIdempotencyKey::STATUS_IN_PROGRESS, 'locked_at' => now(),
            'expires_at' => now()->addSeconds(PublicApiIdempotency::IN_PROGRESS_LEASE_SECONDS),
        ]);
        app(TenantContext::class)->forget();

        $this->withToken($token)->postJson(self::URI, $payload, $this->idem('concurrent-key-1'))
            ->assertStatus(409)->assertJsonPath('error.code', 'idempotency_in_progress');

        $this->assertSame(0, Partner::count(), 'لم يُنشأ طرفٌ ثانٍ بينما الأول قيد التنفيذ');
    }

    // ── audit / rate-limit ────────────────────────────────────────────

    /** @test */
    public function the_write_is_audited_and_rate_limited_by_the_write_class(): void
    {
        $token = $this->key($this->makeTenant(), ['partners:write']);

        $this->withToken($token)->postJson(self::URI, $this->payload(), $this->idem())
            ->assertStatus(201)
            ->assertHeader('X-RateLimit-Limit', '30'); // فئة الكتابة

        $log = PublicApiRequestLog::withoutGlobalScopes()->first();
        $this->assertNotNull($log);
        $this->assertSame('POST', $log->method);
        $this->assertSame(201, $log->response_status);
        $this->assertSame('created', $log->idempotency_status);
    }
}
