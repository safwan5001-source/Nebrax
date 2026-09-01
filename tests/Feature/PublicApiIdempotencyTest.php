<?php

namespace Tests\Feature;

use App\Http\Middleware\AuthenticateApiClient;
use App\Http\Middleware\EnforceApiIdempotency;
use App\Http\Middleware\ForceJsonResponse;
use App\Http\Middleware\PublicApiRequestContext;
use App\Http\Middleware\PublicApiTenantGuard;
use App\Models\ApiClient;
use App\Models\PublicApiIdempotencyKey;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Support\PublicApiErrorCode;
use App\Support\PublicApiIdempotency;
use App\Support\PublicApiResponse;
use App\Tenancy\TenantContext;
use Closure;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * PR-4: أساس Idempotency للـ Public API — يمنع التنفيذ المزدوج لمسارات الكتابة
 * المستقبلية. يغطّي: أوّل طلب/إعادة تشغيل/تعارض/قيد التنفيذ (تزامن)/تحرير عند
 * الفشل/انتهاء/استعادة قفلٍ مهجور/عزل بين العملاء/تجاوز الحجم/عدم إخضاع GET.
 * تشغيل: php artisan test --filter=PublicApiIdempotencyTest
 */
class PublicApiIdempotencyTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const PROBE_URI = '__idem';

    private function service(): ApiClientKeyService
    {
        return app(ApiClientKeyService::class);
    }

    private function makeTenant(string $slug = 'acme'): Tenant
    {
        return Tenant::create(['name' => $slug, 'slug' => $slug . '-' . Str::random(6)]);
    }

    /** @return array{0: ApiClient, 1: string} */
    private function makeClientKey(Tenant $tenant): array
    {
        $client = $this->service()->createClient($tenant, 'integration');
        $key = $this->service()->issueKey($client, 'default', ['partners:read']);

        return [$client, $key->plainTextToken];
    }

    /** يسجّل مسار POST محميًّا بحارس الـ idempotency، بفعلٍ يحدّده الاختبار. */
    private function registerProbe(Closure $action, string $method = 'post', string $uri = self::PROBE_URI): void
    {
        Route::middleware([
            ForceJsonResponse::class,
            PublicApiRequestContext::class,
            AuthenticateApiClient::class,
            PublicApiTenantGuard::class,
            EnforceApiIdempotency::class,
        ])->prefix('api/v1')->group(fn () => Route::{$method}($uri, $action));
    }

    /** فعلٌ افتراضي: يزيد العدّاد بالمرجع ويعيد 201 يحمل قيمته (يميّز التنفيذ من الإعادة). */
    private function counterAction(int &$execCount): Closure
    {
        return function () use (&$execCount) {
            $execCount++;

            return PublicApiResponse::success(request(), ['n' => $execCount], 201);
        };
    }

    // ── أوّل طلب + إكمال ────────────────────────────────────────────────

    /** @test */
    public function first_request_executes_and_is_recorded_completed(): void
    {
        [, $token] = $this->makeClientKey($this->makeTenant());
        $exec = 0;
        $this->registerProbe($this->counterAction($exec));

        $this->withToken($token)
            ->postJson('/api/v1/' . self::PROBE_URI, ['amount' => 100], ['Idempotency-Key' => 'first-request-key'])
            ->assertStatus(201)
            ->assertJsonPath('data.n', 1);

        $this->assertSame(1, $exec);
        $this->assertDatabaseHas('public_api_idempotency_keys', [
            'key_hash'        => PublicApiIdempotency::hashKey('first-request-key'),
            'status'          => PublicApiIdempotencyKey::STATUS_COMPLETED,
            'response_status' => 201,
        ]);
        // المفتاح الخام لا يُخزَّن إطلاقًا.
        $this->assertDatabaseMissing('public_api_idempotency_keys', ['key_hash' => 'first-request-key']);
    }

    // ── إعادة تشغيل تكرارٍ مكتمِل بلا إعادة تنفيذ ──────────────────────

    /** @test */
    public function completed_duplicate_is_replayed_without_re_execution(): void
    {
        [, $token] = $this->makeClientKey($this->makeTenant());
        $exec = 0;
        $this->registerProbe($this->counterAction($exec));

        $first = $this->withToken($token)
            ->postJson('/api/v1/' . self::PROBE_URI, ['amount' => 100], ['Idempotency-Key' => 'replay-key-123']);
        $first->assertStatus(201)->assertJsonPath('data.n', 1);

        $replay = $this->withToken($token)
            ->postJson('/api/v1/' . self::PROBE_URI, ['amount' => 100], ['Idempotency-Key' => 'replay-key-123']);

        $replay->assertStatus(201)
            ->assertJsonPath('data.n', 1)                 // نفس الجسم الأصلي، لا n=2
            ->assertHeader('Idempotency-Replayed', 'true');
        $this->assertSame(1, $exec, 'العملية لم تُنفَّذ ثانية عند الإعادة');
    }

    // ── نفس المفتاح بحمولةٍ مختلفة ⇒ تعارض ────────────────────────────

    /** @test */
    public function same_key_with_different_payload_conflicts(): void
    {
        [, $token] = $this->makeClientKey($this->makeTenant());
        $exec = 0;
        $this->registerProbe($this->counterAction($exec));

        $this->withToken($token)
            ->postJson('/api/v1/' . self::PROBE_URI, ['amount' => 100], ['Idempotency-Key' => 'conflict-key-1'])
            ->assertStatus(201);

        $this->withToken($token)
            ->postJson('/api/v1/' . self::PROBE_URI, ['amount' => 999], ['Idempotency-Key' => 'conflict-key-1'])
            ->assertStatus(409)
            ->assertJsonPath('error.code', PublicApiErrorCode::IDEMPOTENCY_CONFLICT->value);

        $this->assertSame(1, $exec, 'الطلب المتعارض لم يُنفَّذ');
    }

    // ── تكرار أثناء التنفيذ (تزامن) ⇒ 409 بلا تنفيذ ──────────────────

    /** @test */
    public function duplicate_while_in_progress_is_rejected_and_not_executed(): void
    {
        [$client, $token] = $this->makeClientKey($this->makeTenant());
        $exec = 0;
        $this->registerProbe($this->counterAction($exec));

        // يحاكي طلبًا متزامنًا سبق أن طالب بالمفتاح ولا يزال قيد التنفيذ (قفلٌ حديث).
        $rawKey = 'in-progress-key-1';
        $fingerprint = PublicApiIdempotency::fingerprintParts(
            'POST', 'api/v1/' . self::PROBE_URI, [], json_encode(['amount' => 100]), 'application/json',
        );
        $this->preInsert($client, $rawKey, $fingerprint, PublicApiIdempotencyKey::STATUS_IN_PROGRESS, now());

        $this->withToken($token)
            ->postJson('/api/v1/' . self::PROBE_URI, ['amount' => 100], ['Idempotency-Key' => $rawKey])
            ->assertStatus(409)
            ->assertJsonPath('error.code', PublicApiErrorCode::IDEMPOTENCY_IN_PROGRESS->value);

        $this->assertSame(0, $exec, 'العملية لم تُنفَّذ بينما طلبٌ بالمفتاح نفسه قيد التنفيذ');
    }

    // ── بوابة التزامن على مستوى قاعدة البيانات ────────────────────────

    /** @test */
    public function unique_constraint_blocks_two_in_progress_rows_for_the_same_key(): void
    {
        [$client] = $this->makeClientKey($this->makeTenant());
        app(TenantContext::class)->set($client->tenant_id);

        $keyHash = PublicApiIdempotency::hashKey('db-gate-key');
        $this->makeRecord($client, $keyHash, 'fp-a', PublicApiIdempotencyKey::STATUS_IN_PROGRESS, now());

        // الإدراج الثاني بنفس (tenant, client, key_hash) يخالف القيد الفريد.
        $this->expectException(QueryException::class);
        $this->makeRecord($client, $keyHash, 'fp-b', PublicApiIdempotencyKey::STATUS_IN_PROGRESS, now());
    }

    // ── الفشل يُحرّر المفتاح لإعادة المحاولة (لا يُعاد تشغيل الخطأ) ──────

    /** @test */
    public function a_client_error_releases_the_key_for_retry(): void
    {
        [, $token] = $this->makeClientKey($this->makeTenant());
        $exec = 0;
        // أوّل تنفيذ 422، ثم 201 — لإثبات أن المفتاح تحرّر وأُعيد تنفيذه لا إعادة تشغيل الخطأ.
        $this->registerProbe(function () use (&$exec) {
            $exec++;
            if ($exec === 1) {
                return PublicApiResponse::error(request(), PublicApiErrorCode::VALIDATION_FAILED, 'خطأ تحقّق', 422);
            }

            return PublicApiResponse::success(request(), ['n' => $exec], 201);
        });

        $this->withToken($token)
            ->postJson('/api/v1/' . self::PROBE_URI, ['amount' => 100], ['Idempotency-Key' => 'release-key-1'])
            ->assertStatus(422);

        // لم يُخزَّن سجلٌّ مكتمِل — المفتاح متاح.
        $this->assertDatabaseMissing('public_api_idempotency_keys', [
            'key_hash' => PublicApiIdempotency::hashKey('release-key-1'),
        ]);

        $this->withToken($token)
            ->postJson('/api/v1/' . self::PROBE_URI, ['amount' => 100], ['Idempotency-Key' => 'release-key-1'])
            ->assertStatus(201)
            ->assertJsonPath('data.n', 2);

        $this->assertSame(2, $exec);
    }

    // ── مفتاح مفقود/غير صالح ──────────────────────────────────────────

    /** @test */
    public function missing_idempotency_key_is_rejected(): void
    {
        [, $token] = $this->makeClientKey($this->makeTenant());
        $exec = 0;
        $this->registerProbe($this->counterAction($exec));

        $this->withToken($token)
            ->postJson('/api/v1/' . self::PROBE_URI, ['amount' => 100])
            ->assertStatus(400)
            ->assertJsonPath('error.code', PublicApiErrorCode::IDEMPOTENCY_KEY_REQUIRED->value);

        $this->assertSame(0, $exec);
    }

    /** @test */
    public function malformed_idempotency_key_is_rejected(): void
    {
        [, $token] = $this->makeClientKey($this->makeTenant());
        $exec = 0;
        $this->registerProbe($this->counterAction($exec));

        foreach (['short', str_repeat('x', 256), 'has spaces!!'] as $bad) {
            $this->withToken($token)
                ->postJson('/api/v1/' . self::PROBE_URI, ['amount' => 100], ['Idempotency-Key' => $bad])
                ->assertStatus(400)
                ->assertJsonPath('error.code', PublicApiErrorCode::INVALID_IDEMPOTENCY_KEY->value);
        }
    }

    // ── انتهاء واستعادة ───────────────────────────────────────────────

    /** @test */
    public function an_expired_completed_record_is_re_executed(): void
    {
        [$client, $token] = $this->makeClientKey($this->makeTenant());
        $exec = 0;
        $this->registerProbe($this->counterAction($exec));

        $this->withToken($token)
            ->postJson('/api/v1/' . self::PROBE_URI, ['amount' => 100], ['Idempotency-Key' => 'expired-key-1'])
            ->assertStatus(201)->assertJsonPath('data.n', 1);

        // اجعل السجلّ منتهيًا.
        app(TenantContext::class)->set($client->tenant_id);
        PublicApiIdempotencyKey::query()
            ->where('key_hash', PublicApiIdempotency::hashKey('expired-key-1'))
            ->update(['expires_at' => now()->subMinute()]);
        app(TenantContext::class)->forget();

        $this->withToken($token)
            ->postJson('/api/v1/' . self::PROBE_URI, ['amount' => 100], ['Idempotency-Key' => 'expired-key-1'])
            ->assertStatus(201)->assertJsonPath('data.n', 2);

        $this->assertSame(2, $exec);
    }

    /** @test */
    public function a_stale_in_progress_lock_is_reclaimed_and_executed(): void
    {
        [$client, $token] = $this->makeClientKey($this->makeTenant());
        $exec = 0;
        $this->registerProbe($this->counterAction($exec));

        $rawKey = 'stale-lock-key-1';
        $fingerprint = PublicApiIdempotency::fingerprintParts(
            'POST', 'api/v1/' . self::PROBE_URI, [], json_encode(['amount' => 100]), 'application/json',
        );
        // قفلٌ أقدم من عتبة الاستعادة (طلبٌ انهار) + غير منتهٍ.
        $this->preInsert(
            $client, $rawKey, $fingerprint, PublicApiIdempotencyKey::STATUS_IN_PROGRESS,
            now()->subSeconds(PublicApiIdempotency::IN_PROGRESS_TTL_SECONDS + 30),
        );

        $this->withToken($token)
            ->postJson('/api/v1/' . self::PROBE_URI, ['amount' => 100], ['Idempotency-Key' => $rawKey])
            ->assertStatus(201)->assertJsonPath('data.n', 1);

        $this->assertSame(1, $exec, 'القفل المهجور استُعيد ونُفّذت العملية');
    }

    // ── عزل بين العملاء ───────────────────────────────────────────────

    /** @test */
    public function idempotency_is_isolated_per_client(): void
    {
        $exec = 0;
        $this->registerProbe($this->counterAction($exec));

        [, $tokenA] = $this->makeClientKey($this->makeTenant('t-a'));
        [, $tokenB] = $this->makeClientKey($this->makeTenant('t-b'));

        $this->withToken($tokenA)
            ->postJson('/api/v1/' . self::PROBE_URI, ['amount' => 100], ['Idempotency-Key' => 'shared-key-xyz'])
            ->assertStatus(201)->assertJsonPath('data.n', 1);

        // نفس المفتاح النصّي لكن عميل/مستأجر آخر ⇒ تنفيذٌ خاصّ به لا إعادة تشغيل.
        $this->withToken($tokenB)
            ->postJson('/api/v1/' . self::PROBE_URI, ['amount' => 100], ['Idempotency-Key' => 'shared-key-xyz'])
            ->assertStatus(201)->assertJsonPath('data.n', 2)
            ->assertHeaderMissing('Idempotency-Replayed');

        $this->assertSame(2, $exec);
    }

    // ── تجاوز الحجم لا يُخزَّن ─────────────────────────────────────────

    /** @test */
    public function an_oversized_response_is_not_stored_for_replay(): void
    {
        [, $token] = $this->makeClientKey($this->makeTenant());
        $exec = 0;
        $this->registerProbe(function () use (&$exec) {
            $exec++;

            // جسم يتجاوز حدّ الإعادة (>64KB).
            return PublicApiResponse::success(request(), ['blob' => str_repeat('x', PublicApiIdempotency::MAX_REPLAY_BYTES + 10)], 201);
        });

        $this->withToken($token)
            ->postJson('/api/v1/' . self::PROBE_URI, ['amount' => 100], ['Idempotency-Key' => 'oversized-key-1'])
            ->assertStatus(201)
            ->assertHeader('Idempotency-Stored', 'false');

        // لم يُخزَّن ⇒ إعادة الإرسال تُعيد التنفيذ (لا ضمان إعادة تشغيل للمتجاوز).
        $this->withToken($token)
            ->postJson('/api/v1/' . self::PROBE_URI, ['amount' => 100], ['Idempotency-Key' => 'oversized-key-1'])
            ->assertStatus(201);

        $this->assertSame(2, $exec);
    }

    // ── GET لا يخضع للـ idempotency ───────────────────────────────────

    /** @test */
    public function get_requests_are_not_subject_to_idempotency(): void
    {
        [, $token] = $this->makeClientKey($this->makeTenant());
        $this->registerProbe(fn () => PublicApiResponse::success(request(), ['ok' => true]), 'get', '__idem_get');

        // GET بلا Idempotency-Key يمرّ (لا 400) — الطرق الآمنة خارج النطاق.
        $this->withToken($token)->getJson('/api/v1/__idem_get')
            ->assertOk()->assertJsonPath('data.ok', true);
    }

    // ── مساعدات ───────────────────────────────────────────────────────

    private function preInsert(ApiClient $client, string $rawKey, string $fingerprint, string $status, Carbon $lockedAt): void
    {
        app(TenantContext::class)->set($client->tenant_id);
        $this->makeRecord($client, PublicApiIdempotency::hashKey($rawKey), $fingerprint, $status, $lockedAt);
        app(TenantContext::class)->forget();
    }

    private function makeRecord(ApiClient $client, string $keyHash, string $fingerprint, string $status, Carbon $lockedAt): void
    {
        PublicApiIdempotencyKey::create([
            'tenant_id'           => $client->tenant_id,
            'api_client_id'       => $client->getKey(),
            'key_hash'            => $keyHash,
            'method'              => 'POST',
            'route_identity'      => 'api/v1/' . self::PROBE_URI,
            'request_fingerprint' => $fingerprint,
            'status'              => $status,
            'locked_at'           => $lockedAt,
            'expires_at'          => now()->addHours(PublicApiIdempotency::RETENTION_HOURS),
        ]);
    }
}
