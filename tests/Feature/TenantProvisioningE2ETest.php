<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Services\AuthRecoveryService;
use App\Tenancy\HostnameTenantContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * TENANT-PROVISIONING-E2E-1 — يغلق دورة تزويد المستأجر الجديد من التسجيل
 * العام حتى أول دخول فعلي على نطاقه الصحيح.
 *
 * الجذر المؤكَّد لِعطلَي التذكرة معاً: التسجيل (بعد PR #845) يصل من نطاق
 * فرعي عام غير محسوم (`test.{base}`)، والواجهة كانت تبقى عليه بعد النجاح
 * (`router.replace('/dashboard')` — تنقّل SPA على نفس الأصل، لا انتقال
 * حقيقي). فكل طلب مصادَق لاحق — بما فيها `GET commerce/workspace/storefronts`
 * — يظل يحمل `Origin`/`Host` بشريحة `test`، و`IdentifyTenantHostname` يرفضه
 * مغلقاً (404) لأن «test» ليس مستأجراً نشطاً؛ فتراه الواجهة عطلاً في تحميل
 * قائمة المتاجر رغم أن نقطة النهاية والعزل سليمان تماماً (مُثبَتٌ في
 * `CommerceWorkspaceStorefrontsApiTest::an_empty_tenant_receives_an_empty_store_list_not_a_not_found`).
 *
 * الإصلاح: `register()` يُصدر رمز انتقال أحادي الاستخدام قصير الأجل (نفس بنية
 * `auth_action_tokens` المستعملة أصلاً لروابط البريد)، والواجهة تنتقل انتقالاً
 * حقيقياً (cross-origin) إلى نطاق المستأجر الفعلي فتستبدله بتوكن عبر
 * `POST /auth/handoff` — الذي يفشل مغلقاً كأي مسار آخر ما لم يصل من نفس نطاق
 * المستأجر (`AuthRecoveryService::matchesHostname()`).
 *
 * **لا تزويد Commerce تلقائي هنا عمداً**: `StorefrontProvisioningService`
 * موثَّقةٌ صراحةً كتزويد صريح فقط، لا يُستدعى تلقائياً عند التسجيل أو تحميل
 * لوحة التحكم (قرار منتج قائم وشُحن ومُختبَر مسبقاً في COM-STORE-PROVISION-1).
 * هذا الاختبار يثبت أن مستأجراً جديداً يحصل على قائمة متاجر فارغة **ناجحة**
 * (200) لا خطأ 404، لا على متجرٍ افتراضي مُخترَع.
 *
 * تشغيل: php artisan test --filter=TenantProvisioningE2ETest
 */
class TenantProvisioningE2ETest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    protected function setUp(): void
    {
        parent::setUp();
        // يطابق تقرير الخلل: `AWJ_TENANT_BASE_DOMAIN=awjdev.xyz` (Railway/staging).
        config(['tenancy.base_domains' => ['awjdev.xyz']]);
        config(['storefront.managed_base_domain' => 'storefronts.test']);
    }

    private function forgetTenancy(): void
    {
        app(TenantContext::class)->forget();
        app(HostnameTenantContext::class)->forget();
    }

    private function registerFromPublicHost(string $slug, string $email): \Illuminate\Testing\TestResponse
    {
        return $this->withoutMiddleware(\Illuminate\Routing\Middleware\ThrottleRequests::class)
            ->postJson('http://test.awjdev.xyz/api/register', [
                'company_name' => 'شركة '.$slug,
                'slug'         => $slug,
                'name'         => 'المالك',
                'email'        => $email,
                'password'     => 'password123',
            ])->assertCreated();
    }

    /**
     * 1 — التسجيل من نطاق فرعي عام غير محسوم ينجح (تراجع PR #845) وينتج عن
     * التزويد الكامل الحالي: مستأجر نشط، مالك، الأدوار الأربعة، فرع رئيسي
     * ومخزن افتراضي، ودليل حسابات مزروع — كله عبر الخدمات القائمة، لا منطق
     * مكرَّر هنا.
     *
     * @test
     */
    public function registration_from_the_public_host_provisions_the_full_existing_bootstrap(): void
    {
        $res = $this->registerFromPublicHost('aqiall', 'owner@aqiall.test');

        $res->assertJsonPath('tenant.slug', 'aqiall')
            ->assertJsonStructure(['token', 'tenant' => ['id', 'slug'], 'user' => ['id', 'email'], 'handoff' => ['code']]);

        $tenantId = $res->json('tenant.id');
        app(TenantContext::class)->set($tenantId);

        $this->assertDatabaseHas('tenants', ['id' => $tenantId, 'slug' => 'aqiall', 'is_active' => true]);
        $this->assertSame(count(\App\Support\Rbac::systemRoles()), DB::table('roles')->where('tenant_id', $tenantId)->count());
        $this->assertDatabaseHas('branches', ['tenant_id' => $tenantId, 'is_main' => true]);
        $this->assertDatabaseHas('warehouses', ['tenant_id' => $tenantId, 'is_default' => true]);
        $this->assertGreaterThan(0, DB::table('accounts')->where('tenant_id', $tenantId)->count());
        $this->assertDatabaseHas('users', ['tenant_id' => $tenantId, 'email' => 'owner@aqiall.test', 'role' => 'owner']);

        app(TenantContext::class)->forget();
    }

    /**
     * 3 — مستأجر جديد تماماً، بعد الوصول عبر نطاقه الفعلي (لا العام)، يحصل
     * على قائمة متاجر فارغة **ناجحة** من `commerce/workspace/storefronts` —
     * لا 404، ولا متجر مُخترَع.
     *
     * @test
     */
    public function commerce_workspace_storefront_list_succeeds_for_a_fresh_tenant_via_its_own_hostname(): void
    {
        $res = $this->registerFromPublicHost('aqiall', 'owner@aqiall.test');
        $token = $res->json('token');
        $this->forgetTenancy();

        $this->withToken($token)
            ->getJson('http://aqiall.awjdev.xyz/api/commerce/workspace/storefronts')
            ->assertOk()
            ->assertJsonPath('data.stores', []);
    }

    /**
     * The other half of the same fact: reached from the *wrong* (public
     * registration) host, the identical request still fails closed — this is
     * what the ticket observed as "تعذّر تحميل قائمة المتاجر"، and it is a
     * symptom of the missing hostname transition, not a Commerce bug.
     *
     * @test
     */
    public function commerce_workspace_storefront_list_fails_closed_from_the_public_registration_host(): void
    {
        $res = $this->registerFromPublicHost('aqiall', 'owner@aqiall.test');
        $token = $res->json('token');
        $this->forgetTenancy();

        $this->withToken($token)
            ->getJson('http://test.awjdev.xyz/api/commerce/workspace/storefronts')
            ->assertStatus(404);
    }

    /**
     * 4 — عزل Tenant A/B على متاجر مُزوَّدة صراحةً (لا تلقائياً) يبقى قائماً
     * عبر النطاقات الصحيحة لكل منهما.
     *
     * @test
     */
    public function tenant_isolation_holds_for_explicitly_provisioned_storefronts_across_hostnames(): void
    {
        $a = $this->registerFromPublicHost('alrshd', 'a@alrshd.test');
        $b = $this->registerFromPublicHost('beta', 'b@beta.test');
        $tokenA = $a->json('token');
        $tokenB = $b->json('token');
        $this->forgetTenancy();

        $storeA = $this->withToken($tokenA)
            ->postJson('http://alrshd.awjdev.xyz/api/commerce/workspace/storefronts')
            ->assertCreated();
        $this->forgetTenancy();

        $storeB = $this->withToken($tokenB)
            ->postJson('http://beta.awjdev.xyz/api/commerce/workspace/storefronts')
            ->assertCreated();
        $this->forgetTenancy();

        $this->assertSame('alrshd.storefronts.test', $storeA->json('data.store.preview_url') !== null
            ? parse_url($storeA->json('data.store.preview_url'), PHP_URL_HOST)
            : null);
        $this->assertSame('beta.storefronts.test', $storeB->json('data.store.preview_url') !== null
            ? parse_url($storeB->json('data.store.preview_url'), PHP_URL_HOST)
            : null);

        $listA = $this->withToken($tokenA)->getJson('http://alrshd.awjdev.xyz/api/commerce/workspace/storefronts')->assertOk();
        $this->assertCount(1, $listA->json('data.stores'));
        $this->assertStringNotContainsString('beta.storefronts.test', $listA->getContent());
        $this->forgetTenancy();

        $listB = $this->withToken($tokenB)->getJson('http://beta.awjdev.xyz/api/commerce/workspace/storefronts')->assertOk();
        $this->assertCount(1, $listB->json('data.stores'));
        $this->assertStringNotContainsString('alrshd.storefronts.test', $listB->getContent());
        $this->forgetTenancy();

        // B لا يمكنه رؤية متجر A حتى عبر نطاق A (التوكن يخصّ مستأجراً آخر).
        $this->withToken($tokenB)->getJson('http://alrshd.awjdev.xyz/api/commerce/workspace/storefronts')->assertStatus(403);
    }

    /**
     * 7 — نطاق فرعي غير معروف لمسار عادي يبقى مرفوضاً بإغلاق (404)، بلا أي
     * صلة باستثناء `/register` الضيق.
     *
     * @test
     */
    public function unknown_tenant_subdomain_remains_fail_closed(): void
    {
        $this->registerFromPublicHost('alnoor', 'owner@alnoor.test');
        $this->forgetTenancy();

        $this->postJson('http://unknown.awjdev.xyz/api/login', [
            'email' => 'owner@alnoor.test', 'password' => 'password123',
        ])->assertStatus(404)->assertJsonMissingPath('token');
    }

    /**
     * 8 — تعارض Host/Origin يبقى فشلاً مغلقاً كما هو.
     *
     * @test
     */
    public function host_origin_conflict_remains_fail_closed(): void
    {
        $this->registerFromPublicHost('company-a', 'a@alpha.test');
        $this->registerFromPublicHost('company-b', 'b@beta.test');
        $this->forgetTenancy();

        $this->postJson('http://company-a.awjdev.xyz/api/login', [
            'email' => 'a@alpha.test', 'password' => 'password123',
        ], ['Origin' => 'https://company-b.awjdev.xyz'])->assertStatus(404)->assertJsonMissingPath('token');
    }

    /**
     * 9 — عزل الدخول بين المستأجرين عبر النطاقات لا يزال قائماً بلا تغيير.
     *
     * @test
     */
    public function login_tenant_isolation_is_unchanged(): void
    {
        $a = $this->registerFromPublicHost('company-a', 'a@alpha.test');
        $b = $this->registerFromPublicHost('company-b', 'b@beta.test');
        $this->forgetTenancy();

        $this->postJson('http://company-a.awjdev.xyz/api/login', [
            'email' => 'b@beta.test', 'password' => 'password123',
        ])->assertStatus(422)->assertJsonMissingPath('token');

        $this->postJson('http://company-a.awjdev.xyz/api/login', [
            'email' => 'a@alpha.test', 'password' => 'password123',
        ])->assertOk()->assertJsonPath('user.email', 'a@alpha.test');

        $this->assertNotSame($a->json('tenant.id'), $b->json('tenant.id'));
    }

    /**
     * 10 — استبدال رمز الانتقال ينجح فقط من نطاق المستأجر الفعلي، ويحسم
     * الرمز نفس المستخدم/المستأجر الذي أصدره التسجيل — هذا هو "trusted
     * server-derived tenant slug" المطلوب: الرمز يحمل هوية المستأجر
     * server-side، ولا يقرأ أي slug من طرف العميل عند الاستهلاك.
     *
     * @test
     */
    public function handoff_succeeds_only_from_the_tenants_own_hostname_and_returns_a_working_token(): void
    {
        $res = $this->registerFromPublicHost('aqiall', 'owner@aqiall.test');
        $code = $res->json('handoff.code');
        $this->assertNotEmpty($code);
        $this->forgetTenancy();

        $exchanged = $this->postJson('http://aqiall.awjdev.xyz/api/auth/handoff', ['code' => $code])
            ->assertOk()
            ->assertJsonStructure(['token', 'user' => ['email', 'tenant_id']]);

        $this->assertSame('owner@aqiall.test', $exchanged->json('user.email'));
        $this->forgetTenancy();

        // التوكن الناتج يعمل فعلياً على نفس نطاق المستأجر.
        $this->withToken($exchanged->json('token'))
            ->getJson('http://aqiall.awjdev.xyz/api/commerce/workspace/storefronts')
            ->assertOk();
    }

    /**
     * الرمز لا يُستهلك ولو حاول العميل استعماله من نفس نطاق التسجيل العام:
     * `test` نفسه غير محسوم كمستأجر فعلي، فيفشل الطلب مغلقاً (404) عند
     * `IdentifyTenantHostname` **قبل** بلوغ منطق الاستبدال أصلاً — أشدّ
     * إغلاقاً من رفض الاستبدال نفسه (422)، ونفس سلوك أي مسار آخر غير
     * `/register` على هذا المضيف تماماً (`PublicRegistrationTenantHostnameTest`).
     *
     * @test
     */
    public function handoff_fails_closed_from_the_public_registration_host(): void
    {
        $res = $this->registerFromPublicHost('aqiall', 'owner@aqiall.test');
        $code = $res->json('handoff.code');
        $this->forgetTenancy();

        $this->postJson('http://test.awjdev.xyz/api/auth/handoff', ['code' => $code])
            ->assertStatus(404)->assertJsonMissingPath('token');
    }

    /** @test */
    public function handoff_fails_closed_from_a_different_tenants_hostname(): void
    {
        $a = $this->registerFromPublicHost('aqiall', 'owner@aqiall.test');
        $this->registerFromPublicHost('other', 'owner@other.test');
        $code = $a->json('handoff.code');
        $this->forgetTenancy();

        $this->postJson('http://other.awjdev.xyz/api/auth/handoff', ['code' => $code])
            ->assertStatus(422)->assertJsonMissingPath('token');
    }

    /** @test */
    public function handoff_code_is_single_use(): void
    {
        $res = $this->registerFromPublicHost('aqiall', 'owner@aqiall.test');
        $code = $res->json('handoff.code');
        $this->forgetTenancy();

        $this->postJson('http://aqiall.awjdev.xyz/api/auth/handoff', ['code' => $code])->assertOk();
        $this->forgetTenancy();

        $this->postJson('http://aqiall.awjdev.xyz/api/auth/handoff', ['code' => $code])
            ->assertStatus(422)->assertJsonMissingPath('token');
    }

    /** @test */
    public function handoff_code_expires(): void
    {
        $res = $this->registerFromPublicHost('aqiall', 'owner@aqiall.test');
        $code = $res->json('handoff.code');
        $this->forgetTenancy();

        DB::table('auth_action_tokens')
            ->where('type', AuthRecoveryService::TENANT_HANDOFF)
            ->update(['expires_at' => now()->subMinute()]);

        $this->postJson('http://aqiall.awjdev.xyz/api/auth/handoff', ['code' => $code])
            ->assertStatus(422)->assertJsonMissingPath('token');
    }

    /**
     * 11 — التطوير المحلي/بلا نطاق فرعي: التسجيل والدخول بلا أي شريحة
     * مستأجر (سلوك ما قبل هذه التذكرة بالكامل) يبقيان يعملان بلا أي فرق —
     * الواجهة تتجاهل رمز الانتقال ببساطة ولا تحاول أي انتقال (منطق العميل
     * وحده، مغطى في اختبارات `tenant-domain.test.ts` على الواجهة). هذا
     * الاختبار يثبت الجزء الخادمي: التسجيل/الدخول العاديان بلا Host/Origin
     * تحت أي نطاق أساسي يبقيان كما كانا تماماً.
     *
     * @test
     */
    public function registration_and_login_without_any_tenant_subdomain_remain_unaffected(): void
    {
        $res = $this->withoutMiddleware(\Illuminate\Routing\Middleware\ThrottleRequests::class)
            ->postJson('/api/register', [
                'company_name' => 'شركة محلية',
                'slug'         => 'local-dev',
                'name'         => 'المالك',
                'email'        => 'owner@local-dev.test',
                'password'     => 'password123',
            ])->assertCreated();

        $this->assertNotEmpty($res->json('handoff.code'));
        $this->forgetTenancy();

        $this->postJson('/api/login', [
            'email' => 'owner@local-dev.test', 'password' => 'password123',
        ])->assertOk()->assertJsonPath('user.email', 'owner@local-dev.test');
    }

    /**
     * الإصلاح لا يوسّع نطاق التزويد التلقائي: مستأجر جديد لا يملك أي متجر
     * حتى يُزوَّد صراحةً (`POST commerce/workspace/storefronts`) من مستخدم
     * يملك `commerce.manage` — لا قناة بيع ولا متجر ولا نطاق يُنشأ عند
     * التسجيل نفسه.
     *
     * @test
     */
    public function registration_does_not_auto_provision_any_commerce_primitive(): void
    {
        $res = $this->registerFromPublicHost('aqiall', 'owner@aqiall.test');
        $tenantId = $res->json('tenant.id');

        app(TenantContext::class)->set($tenantId);
        $this->assertSame(0, DB::table('sales_channels')->where('tenant_id', $tenantId)->count());
        $this->assertSame(0, DB::table('storefronts')->where('tenant_id', $tenantId)->count());
        app(TenantContext::class)->forget();
    }
}
