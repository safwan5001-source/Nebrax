<?php

namespace Tests\Feature;

use App\Http\Middleware\SetTenant;
use App\Models\ApiClient;
use App\Models\Tenant;
use App\Models\User;
use App\Tenancy\HostnameTenantContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * REM-08 / SEC-04 — المستخدم المعطَّل يفقد وصول الـ API فوراً.
 *
 * طبقتان مستقلتان، وكلٌّ منهما تُختبر بمعزل عن الأخرى:
 *   1) حارس كل طلب في `SetTenant` — المرجع الفعلي وقت التشغيل (اختبار B).
 *   2) سحب التوكنات عند الانتقال active → inactive وعند الحذف في `UserController`.
 *
 * الحالة القائمة التي لا تتغيّر: دخول/handoff المعطَّل مرفوضان 403، والمستأجر
 * المعطَّل يُرفض 403 «الاشتراك غير مفعّل.» (اختبار I).
 *
 * تشغيل:  php artisan test --filter=Rem08DeactivatedUserAccessTest
 */
class Rem08DeactivatedUserAccessTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const INACTIVE_MESSAGE = 'الحساب غير مفعّل.';

    /** @return array{0: User, 1: string} المستخدم وتوكنه الأول */
    private function userWithToken(string $tenantId, string $role, string $email): array
    {
        $token = $this->tokenForRole($tenantId, $role, $email);

        return [User::where('email', $email)->firstOrFail(), $token];
    }

    private function tokenCount(string $userId): int
    {
        return DB::table('personal_access_tokens')
            ->where('tokenable_type', User::class)
            ->where('tokenable_id', $userId)
            ->count();
    }

    private function setActive(string $ownerToken, string $userId, bool $active)
    {
        return $this->withToken($ownerToken)->putJson("/api/users/{$userId}", ['is_active' => $active]);
    }

    private function partnerCount(string $tenantId): int
    {
        return DB::table('partners')->where('tenant_id', $tenantId)->count();
    }

    // ───────────────────────── A — التوكن يموت فوراً بعد التعطيل ─────────────────────────

    /** @test */
    public function an_existing_token_dies_on_the_next_request_after_deactivation(): void
    {
        $auth = $this->registerTenant();
        [$staff, $staffToken] = $this->userWithToken($auth['tenant_id'], 'staff', 'staff@acme.test');
        [$other, $otherToken] = $this->userWithToken($auth['tenant_id'], 'staff', 'other@acme.test');

        $this->withToken($staffToken)->getJson('/api/me')->assertOk();

        $this->setActive($auth['token'], $staff->id, false)
            ->assertOk()->assertJsonPath('data.is_active', false);

        // التوكن سُحب → 401 من `auth:sanctum` قبل أي منطق مستأجر.
        $this->withToken($staffToken)->getJson('/api/me')->assertUnauthorized();

        $this->assertFalse((bool) User::findOrFail($staff->id)->is_active);
        $this->assertSame(0, $this->tokenCount($staff->id));

        // الأثر محصور بالمستخدم المستهدف: المدير ومستخدم آخر يعملان وصفوف توكناتهما قائمة.
        $this->withToken($auth['token'])->getJson('/api/me')->assertOk();
        $this->withToken($otherToken)->getJson('/api/me')->assertOk();
        $this->assertSame(1, $this->tokenCount($other->id));
    }

    // ───────────────────── B — الحارس وحده يحمي (التوكن باقٍ في القاعدة) ─────────────────────

    /** @test */
    public function the_per_request_guard_rejects_an_inactive_user_even_when_the_token_row_survives(): void
    {
        $auth = $this->registerTenant();
        [$admin, $adminToken] = $this->userWithToken($auth['tenant_id'], 'admin', 'admin@acme.test');

        // نفس المستخدم ينفّذ كتابة ناجحة وهو نشط — فرفضه لاحقاً ليس بسبب صلاحية ناقصة.
        $this->withToken($adminToken)->postJson('/api/partners', ['name' => 'قبل', 'type' => 'customer'])
            ->assertCreated();
        $this->assertSame(1, $this->partnerCount($auth['tenant_id']));

        // تعطيل مباشر في القاعدة — لا يمرّ بـ`UserController` فلا يُسحب أي توكن.
        User::whereKey($admin->id)->update(['is_active' => false]);
        $this->assertSame(1, $this->tokenCount($admin->id));

        $this->withToken($adminToken)->getJson('/api/me')
            ->assertForbidden()->assertJsonPath('message', self::INACTIVE_MESSAGE);

        // الرفض قبل منطق الأعمال: لا صفّ جديد على مسار كتابة.
        $this->withToken($adminToken)->postJson('/api/partners', ['name' => 'بعد', 'type' => 'customer'])
            ->assertForbidden()->assertJsonPath('message', self::INACTIVE_MESSAGE);
        $this->assertSame(1, $this->partnerCount($auth['tenant_id']));

        // الحارس لا يحذف شيئاً ولا يمسّ غير المستخدم نفسه.
        $this->assertSame(1, $this->tokenCount($admin->id));
        $this->withToken($auth['token'])->getJson('/api/me')->assertOk();
    }

    // ───────────────────────── C — إعادة التفعيل لا تبعث التوكن القديم ─────────────────────────

    /** @test */
    public function reactivation_does_not_restore_the_old_token_and_a_fresh_login_works(): void
    {
        $auth = $this->registerTenant();
        [$staff, $oldToken] = $this->userWithToken($auth['tenant_id'], 'staff', 'staff@acme.test');

        $this->setActive($auth['token'], $staff->id, false)->assertOk();
        $this->setActive($auth['token'], $staff->id, true)
            ->assertOk()->assertJsonPath('data.is_active', true);

        $this->withToken($oldToken)->getJson('/api/me')->assertUnauthorized();
        $this->assertSame(0, $this->tokenCount($staff->id));

        $newToken = $this->postJson('/api/login', ['email' => 'staff@acme.test', 'password' => 'password123'])
            ->assertOk()->json('token');

        $this->assertNotSame($oldToken, $newToken);
        $this->withToken($newToken)->getJson('/api/me')->assertOk();
        $this->withToken($oldToken)->getJson('/api/me')->assertUnauthorized();
    }

    // ───────────────────────── D — تحديث غير ذي صلة لا يسحب التوكن ─────────────────────────

    /** @test */
    public function an_unrelated_update_keeps_the_token(): void
    {
        $auth = $this->registerTenant();
        [$staff, $token] = $this->userWithToken($auth['tenant_id'], 'staff', 'staff@acme.test');

        $this->withToken($auth['token'])->putJson("/api/users/{$staff->id}", ['name' => 'اسم جديد'])
            ->assertOk()->assertJsonPath('data.name', 'اسم جديد');

        // true → true صريحة: ليست انتقالاً.
        $this->setActive($auth['token'], $staff->id, true)->assertOk();

        $this->withToken($token)->getJson('/api/me')->assertOk();
        $this->assertSame(1, $this->tokenCount($staff->id));
    }

    // ───────────────────────── E — تحديث متكرر لمعطَّل أصلاً ─────────────────────────

    /** @test */
    public function repeating_an_inactive_update_is_not_a_transition(): void
    {
        $auth = $this->registerTenant();
        [$staff] = $this->userWithToken($auth['tenant_id'], 'staff', 'staff@acme.test');

        $this->setActive($auth['token'], $staff->id, false)->assertOk();
        $this->assertSame(0, $this->tokenCount($staff->id));

        // توكن يبقى لمعطَّل (مثلاً أُصدر في سباق مع الدخول): false → false لا يسحبه…
        $survivor = User::findOrFail($staff->id)->createToken('api')->plainTextToken;

        $this->withToken($auth['token'])
            ->putJson("/api/users/{$staff->id}", ['is_active' => false, 'name' => 'مكرر'])
            ->assertOk()->assertJsonPath('data.is_active', false)->assertJsonPath('data.name', 'مكرر');

        $this->assertFalse((bool) User::findOrFail($staff->id)->is_active);
        $this->assertSame(1, $this->tokenCount($staff->id));

        // …لكن الحارس يرفضه — وهذا هو سبب كونه المرجع.
        $this->withToken($survivor)->getJson('/api/me')
            ->assertForbidden()->assertJsonPath('message', self::INACTIVE_MESSAGE);
    }

    // ───────────────────────── F — الحذف يسحب التوكنات ─────────────────────────

    /** @test */
    public function deleting_a_user_revokes_all_of_their_tokens_and_only_theirs(): void
    {
        $auth = $this->registerTenant();
        [$staff, $first] = $this->userWithToken($auth['tenant_id'], 'staff', 'staff@acme.test');
        [$other, $otherToken] = $this->userWithToken($auth['tenant_id'], 'staff', 'other@acme.test');

        $staff->createToken('second');
        $staff->createToken('third');
        $this->assertSame(3, $this->tokenCount($staff->id));

        $this->withToken($auth['token'])->deleteJson("/api/users/{$staff->id}")->assertOk();

        // `personal_access_tokens` بلا FK متتالٍ (uuidMorphs) والحذف ناعم — فالسحب صريح، لا تبعي.
        $this->assertSame(0, $this->tokenCount($staff->id));
        $this->assertNotNull(User::withTrashed()->findOrFail($staff->id)->deleted_at);
        $this->withToken($first)->getJson('/api/me')->assertUnauthorized();

        $this->assertSame(1, $this->tokenCount($other->id));
        $this->withToken($otherToken)->getJson('/api/me')->assertOk();
        $this->withToken($auth['token'])->getJson('/api/me')->assertOk();
    }

    // ───────────────────────── G — عزل المستأجرين ─────────────────────────

    /** @test */
    public function a_tenant_admin_cannot_deactivate_or_delete_another_tenants_user(): void
    {
        $a = $this->registerTenant('alpha', 'a@alpha.test');
        $b = $this->registerTenant('beta', 'b@beta.test');
        [$victim, $victimToken] = $this->userWithToken($b['tenant_id'], 'staff', 'victim@beta.test');
        $victim->createToken('second');

        $snapshot = fn () => [
            DB::table('users')->where('id', $victim->id)->first(),
            DB::table('personal_access_tokens')->where('tokenable_id', $victim->id)->orderBy('id')->get()->all(),
        ];
        $before = $snapshot();

        // `findOrFail` ضمن tenant_id — نفس دلالة عدم الكشف القائمة (404 لا 403).
        $this->setActive($a['token'], $victim->id, false)->assertNotFound();
        $this->withToken($a['token'])->putJson("/api/users/{$victim->id}", ['name' => 'اختراق'])->assertNotFound();
        $this->withToken($a['token'])->deleteJson("/api/users/{$victim->id}")->assertNotFound();

        $this->assertEquals($before, $snapshot());
        $this->assertSame(2, $this->tokenCount($victim->id));
        $this->withToken($victimToken)->getJson('/api/me')->assertOk();
        $this->withToken($b['token'])->getJson('/api/me')->assertOk();

        // معرّف مزوَّر غير موجود يعطي الاستجابة نفسها.
        $this->setActive($a['token'], '00000000-0000-4000-8000-000000000000', false)->assertNotFound();
    }

    // ───────────────────────── H — حرمان الصلاحية قائم كما هو ─────────────────────────

    /** @test */
    public function a_caller_without_user_management_permission_is_still_denied_and_nothing_changes(): void
    {
        $auth = $this->registerTenant();
        [$staff, $staffToken] = $this->userWithToken($auth['tenant_id'], 'staff', 'staff@acme.test');
        [, $accToken] = $this->userWithToken($auth['tenant_id'], 'accountant', 'acc@acme.test');

        $this->setActive($accToken, $staff->id, false)->assertForbidden();
        $this->withToken($accToken)->deleteJson("/api/users/{$staff->id}")->assertForbidden();

        $this->assertTrue((bool) User::findOrFail($staff->id)->is_active);
        $this->assertSame(1, $this->tokenCount($staff->id));
        $this->withToken($staffToken)->getJson('/api/me')->assertOk();
        // المحاسب النشط نفسه يعمل في نطاقه — لم يتحوّل الحرمان إلى سلوك جديد.
        $this->withToken($accToken)->getJson('/api/me')->assertOk();
    }

    // ───────────────────────── I — المستأجر المعطَّل: السلوك القائم ─────────────────────────

    /** @test */
    public function an_inactive_tenant_is_still_rejected_with_its_own_message_taking_precedence(): void
    {
        $auth = $this->registerTenant();
        [$staff, $staffToken] = $this->userWithToken($auth['tenant_id'], 'staff', 'staff@acme.test');

        Tenant::query()->whereKey($auth['tenant_id'])->update(['is_active' => false]);

        $this->withToken($staffToken)->getJson('/api/me')
            ->assertForbidden()->assertJsonPath('message', 'الاشتراك غير مفعّل.');

        // مستخدم معطَّل في مستأجر معطَّل: رسالة المستأجر كما كانت قبل REM-08.
        User::whereKey($staff->id)->update(['is_active' => false]);
        $this->withToken($staffToken)->getJson('/api/me')
            ->assertForbidden()->assertJsonPath('message', 'الاشتراك غير مفعّل.');
    }

    // ───────────────────────── J — الدخول والـ handoff ─────────────────────────

    /** @test */
    public function an_inactive_user_still_cannot_log_in(): void
    {
        $auth = $this->registerTenant();
        [$staff] = $this->userWithToken($auth['tenant_id'], 'staff', 'staff@acme.test');
        $this->setActive($auth['token'], $staff->id, false)->assertOk();

        $this->postJson('/api/login', ['email' => 'staff@acme.test', 'password' => 'password123'])
            ->assertForbidden()->assertJsonPath('message', self::INACTIVE_MESSAGE);
    }

    /** @test */
    public function an_inactive_user_cannot_exchange_a_handoff_code(): void
    {
        config(['tenancy.base_domains' => ['awjdev.xyz']]);
        config(['storefront.managed_base_domain' => 'storefronts.test']);

        $res = $this->withoutMiddleware(\Illuminate\Routing\Middleware\ThrottleRequests::class)
            ->postJson('http://test.awjdev.xyz/api/register', [
                'company_name' => 'شركة aqiall', 'slug' => 'aqiall',
                'name' => 'المالك', 'email' => 'owner@aqiall.test', 'password' => 'password123',
            ])->assertCreated();
        $code = $res->json('handoff.code');
        $this->assertNotEmpty($code);

        User::where('email', 'owner@aqiall.test')->update(['is_active' => false]);
        app(TenantContext::class)->forget();
        app(HostnameTenantContext::class)->forget();

        // السلوك القائم: `AuthRecoveryService::consume()` يستبعد المعطَّل (والرمز يُستهلك)،
        // فيصل `handoff()` بلا مستخدم → 422 لا 403. لا يصدر توكن في أي حال.
        $this->postJson('http://aqiall.awjdev.xyz/api/auth/handoff', ['code' => $code])
            ->assertStatus(422)->assertJsonMissingPath('token');
    }

    // ───────────────────── K — سياسة التعطيل القائمة محفوظة حرفياً ─────────────────────

    /** @test */
    public function existing_owner_protection_and_self_deactivation_policy_are_unchanged(): void
    {
        $auth = $this->registerTenant();
        [$admin, $adminToken] = $this->userWithToken($auth['tenant_id'], 'admin', 'admin@acme.test');
        $owner = User::where('email', 'owner@acme.test')->firstOrFail();

        // admin لا يعطّل المالك (حراسة قائمة) والمالك يبقى بتوكنه.
        $this->setActive($adminToken, $owner->id, false)->assertForbidden();
        $this->assertTrue((bool) User::findOrFail($owner->id)->is_active);
        $this->withToken($auth['token'])->getJson('/api/me')->assertOk();

        // التعطيل الذاتي مسموح اليوم (لا قاعدة تمنعه): ينجح، ثم يموت توكن صاحبه.
        $this->setActive($adminToken, $admin->id, false)->assertOk()->assertJsonPath('data.is_active', false);
        $this->withToken($adminToken)->getJson('/api/me')->assertUnauthorized();
    }

    // ─────────────── L — الحارس لا يمسّ principals الآلة (غير `User`) ───────────────

    /** @test */
    public function the_guard_only_applies_to_user_principals(): void
    {
        $auth = $this->registerTenant();
        $client = new ApiClient(['tenant_id' => $auth['tenant_id'], 'name' => 'erp', 'is_active' => false]);
        $client->save();

        $request = Request::create('/api/anything');
        $request->setUserResolver(fn () => $client);

        $middleware = new SetTenant(app(TenantContext::class), app(HostnameTenantContext::class));
        $response = $middleware->handle($request, fn () => response('passed'));

        $this->assertSame('passed', $response->getContent());
    }
}
