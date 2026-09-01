<?php

namespace Tests\Feature;

use App\Models\ApiClient;
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
 * PR-4: احتفاظ/تقليم سجلّات حماية الـ Public API عبر أمر Artisan `public-api:prune`
 * (بلا طابور خلفي). يغطّي: حذف idempotency المنتهية وإبقاء الفعّالة، حذف التدقيق
 * الأقدم من النافذة وإبقاء الحديث، و`--dry-run` يَعُدّ دون حذف.
 * تشغيل: php artisan test --filter=PublicApiRetentionTest
 */
class PublicApiRetentionTest extends TestCase
{
    use RefreshDatabase;

    private function seedClient(): ApiClient
    {
        $tenant = Tenant::create(['name' => 'acme', 'slug' => 'acme-' . Str::random(6)]);
        app(TenantContext::class)->set($tenant->id);

        return app(ApiClientKeyService::class)->createClient($tenant, 'integration');
    }

    /** @test */
    public function prune_deletes_expired_idempotency_keys_and_old_audit_rows(): void
    {
        $client = $this->seedClient();

        // مفتاح منتهٍ + مفتاح فعّال.
        $this->makeKey($client, 'expired', now()->subHour());
        $this->makeKey($client, 'active', now()->addHour());

        // سجلّ تدقيق قديم (100 يومًا) + حديث.
        $old = $this->makeLog($client);
        $old->forceFill(['created_at' => now()->subDays(100)])->saveQuietly();
        $this->makeLog($client);

        app(TenantContext::class)->forget();

        $this->artisan('public-api:prune', ['--audit-days' => 90])->assertSuccessful();

        $this->assertSame(1, PublicApiIdempotencyKey::withoutGlobalScopes()->count());
        $this->assertSame('active', PublicApiIdempotencyKey::withoutGlobalScopes()->first()->key_hash);
        $this->assertSame(1, PublicApiRequestLog::withoutGlobalScopes()->count());
    }

    /** @test */
    public function dry_run_counts_without_deleting(): void
    {
        $client = $this->seedClient();
        $this->makeKey($client, 'expired', now()->subHour());
        app(TenantContext::class)->forget();

        $this->artisan('public-api:prune', ['--dry-run' => true])->assertSuccessful();

        // لم يُحذف شيء.
        $this->assertSame(1, PublicApiIdempotencyKey::withoutGlobalScopes()->count());
    }

    private function makeKey(ApiClient $client, string $keyHash, \Illuminate\Support\Carbon $expiresAt): void
    {
        PublicApiIdempotencyKey::create([
            'tenant_id'           => $client->tenant_id,
            'api_client_id'       => $client->getKey(),
            'key_hash'            => $keyHash,
            'method'              => 'POST',
            'route_identity'      => 'api/v1/x',
            'request_fingerprint' => 'fp-' . $keyHash,
            'status'              => PublicApiIdempotencyKey::STATUS_COMPLETED,
            'expires_at'          => $expiresAt,
        ]);
    }

    private function makeLog(ApiClient $client): PublicApiRequestLog
    {
        return PublicApiRequestLog::create([
            'tenant_id'       => $client->tenant_id,
            'api_client_id'   => $client->getKey(),
            'request_id'      => (string) Str::uuid(),
            'method'          => 'GET',
            'route_identity'  => 'public.v1.partners.index',
            'path'            => '/api/v1/partners',
            'response_status' => 200,
            'duration_ms'     => 3,
        ]);
    }
}
