<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Tenancy\HostnameTenantContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Regression: POST /register من نطاق فرعي عام (`test.{base_domain}`) كان
 * يُرفض بـ 404 لأن `IdentifyTenantHostname` يحاول حسم شريحة المضيف
 * (`test`) كمستأجر **موجود مسبقاً** قبل تنفيذ التسجيل — بينما `/register`
 * هو نفسه مسار التزويد الذي **ينشئ** المستأجر. الإصلاح: استثناء ضيق باسم
 * المسار `auth.public-register` وحده في `IdentifyTenantHostname`، فلا يمسّ
 * أي مسار آخر ولا يُضعف حسم/عزل المستأجر في بقية الـ API.
 *
 * تشغيل: php artisan test --filter=PublicRegistrationTenantHostnameTest
 */
class PublicRegistrationTenantHostnameTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    protected function setUp(): void
    {
        parent::setUp();

        // يطابق تقرير الخلل: `AWJ_TENANT_BASE_DOMAIN=awjdev.xyz` (Railway).
        config(['tenancy.base_domains' => ['awjdev.xyz']]);
    }

    private function forgetTenancy(): void
    {
        app(TenantContext::class)->forget();
        app(HostnameTenantContext::class)->forget();
    }

    private function registerPayload(string $slug, string $email): array
    {
        return [
            'company_name' => 'شركة عقيال',
            'slug'         => $slug,
            'name'         => 'المالك',
            'email'        => $email,
            'password'     => 'password123',
        ];
    }

    /**
     * A — تسجيل عام من `test.awjdev.xyz` ينشئ مستأجراً جديداً بالـ slug
     * المطلوب في الجسم (`aqiall`)، بلا محاولة حسم `test` كمستأجر قائم.
     *
     * @test
     */
    public function public_registration_from_a_generic_subdomain_creates_the_requested_tenant(): void
    {
        $this->assertFalse(Tenant::query()->whereRaw('lower(slug) = ?', ['test'])->exists());

        $res = $this->withoutMiddleware(\Illuminate\Routing\Middleware\ThrottleRequests::class)
            ->postJson('http://test.awjdev.xyz/api/register', $this->registerPayload('aqiall', 'owner@aqiall.test'));

        $res->assertCreated()
            ->assertJsonPath('tenant.slug', 'aqiall')
            ->assertJsonStructure(['token', 'tenant' => ['id', 'slug'], 'user' => ['email']]);

        // المستأجر الفعلي المُنشأ هو `aqiall` من الجسم — لا `test` من المضيف.
        $this->assertTrue(Tenant::query()->whereRaw('lower(slug) = ?', ['aqiall'])->exists());
        $this->assertFalse(Tenant::query()->whereRaw('lower(slug) = ?', ['test'])->exists());

        $tenant = Tenant::query()->whereRaw('lower(slug) = ?', ['aqiall'])->first();
        $this->assertNotNull($tenant);
        $this->assertTrue($tenant->is_active);

        $this->forgetTenancy();

        // المستخدم المالك يستطيع الدخول عبر نطاق مستأجره الفعلي (aqiall)، لا test.
        $this->postJson('http://aqiall.awjdev.xyz/api/login', [
            'email' => 'owner@aqiall.test', 'password' => 'password123',
        ])->assertOk()->assertJsonPath('user.email', 'owner@aqiall.test');
    }

    /**
     * A(2) — نفس التسجيل يعمل أيضاً عبر Origin على نفس نمط المضيف العام
     * (لا فرق بين مصدر الحسم Host أو Origin بالنسبة لاستثناء التسجيل).
     *
     * @test
     */
    public function public_registration_works_when_the_generic_subdomain_is_only_in_origin(): void
    {
        $res = $this->withoutMiddleware(\Illuminate\Routing\Middleware\ThrottleRequests::class)
            ->postJson('/api/register', $this->registerPayload('aqiall2', 'owner2@aqiall.test'), [
                'Origin' => 'https://test.awjdev.xyz',
            ]);

        $res->assertCreated()->assertJsonPath('tenant.slug', 'aqiall2');
    }

    /**
     * B — نطاق فرعي غير معروف لمسار عادي (tenant-aware) يبقى مرفوضاً
     * بإغلاق (404) كما كان قبل الإصلاح تماماً.
     *
     * @test
     */
    public function unknown_tenant_subdomain_remains_fail_closed_for_ordinary_endpoints(): void
    {
        $this->registerTenant('alnoor', 'owner@alnoor.test');
        $this->forgetTenancy();

        $this->postJson('http://unknown.awjdev.xyz/api/login', [
            'email' => 'owner@alnoor.test', 'password' => 'password123',
        ])->assertStatus(404)->assertJsonMissingPath('token');

        $this->assertFalse(app(TenantContext::class)->has());
        $this->assertFalse(app(HostnameTenantContext::class)->has());
    }

    /**
     * C — الدخول من نطاق فرعي لمستأجر يبقى مقيّداً بنفس المستأجر: مستخدم
     * مستأجر آخر لا يستطيع الدخول عبر مضيف غير مضيفه، حتى ببياناته الصحيحة.
     *
     * @test
     */
    public function login_stays_isolated_to_its_own_tenant_hostname(): void
    {
        $a = $this->registerTenant('company-a', 'a@alpha.test');
        $b = $this->registerTenant('company-b', 'b@beta.test');
        $this->forgetTenancy();

        $this->postJson('http://company-a.awjdev.xyz/api/login', [
            'email' => 'b@beta.test', 'password' => 'password123',
        ])->assertStatus(422)->assertJsonMissingPath('token');

        $this->postJson('http://company-a.awjdev.xyz/api/login', [
            'email' => 'a@alpha.test', 'password' => 'password123',
        ])->assertOk()->assertJsonPath('user.email', 'a@alpha.test');

        $this->assertNotSame($a['tenant_id'], $b['tenant_id']);
    }

    /**
     * D — تعارض Host/Origin (شريحتان مختلفتان) يبقى فشلاً مغلقاً كما كان،
     * ولا يتأثر باستثناء التسجيل (المسار هنا ليس /register).
     *
     * @test
     */
    public function host_origin_slug_conflict_remains_fail_closed(): void
    {
        $this->registerTenant('company-a', 'a@alpha.test');
        $this->registerTenant('company-b', 'b@beta.test');
        $this->forgetTenancy();

        $this->postJson('http://company-a.awjdev.xyz/api/login', [
            'email' => 'a@alpha.test', 'password' => 'password123',
        ], ['Origin' => 'https://company-b.awjdev.xyz'])->assertStatus(404)->assertJsonMissingPath('token');
    }

    /**
     * E — قواعد التحقق الحالية للتسجيل (uniqueness/slug) لا تتغير بسبب
     * الإصلاح: slug محجوز أو مكرر يُرفض بنفس رسائل ما قبل الإصلاح، حتى
     * عندما يصل الطلب من مضيف مستأجر فرعي عام.
     *
     * @test
     */
    public function registration_validation_rules_are_unchanged_from_a_subdomain_host(): void
    {
        $this->withoutMiddleware(\Illuminate\Routing\Middleware\ThrottleRequests::class);

        $this->postJson('http://test.awjdev.xyz/api/register', $this->registerPayload('platform', 'x@reserved.test'))
            ->assertStatus(422)->assertJsonValidationErrors(['slug']);

        $this->registerTenant('alnoor', 'owner@alnoor.test');

        $this->postJson('http://test.awjdev.xyz/api/register', $this->registerPayload('alnoor', 'dup@alnoor.test'))
            ->assertStatus(422)->assertJsonValidationErrors(['slug']);
    }
}
