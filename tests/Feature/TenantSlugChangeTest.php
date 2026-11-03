<?php

namespace Tests\Feature;

use App\Mail\AuthActionMail;
use App\Models\PlatformAdministrator;
use App\Models\PlatformAdministratorAction;
use App\Models\Tenant;
use App\Services\TenantSlugChangeService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use RuntimeException;
use Tests\TestCase;

/**
 * إصلاح مستأجر معرّفه لا يصلح hostname (`nebras_flowers` → `nebras-flowers`):
 * معاينة آمنة، موانع، حفظ كامل البيانات، تدقيق، واستمرارية الوصول.
 *
 * تشغيل: php artisan test --filter=TenantSlugChangeTest
 */
class TenantSlugChangeTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const OLD = 'nebras_flowers';
    private const NEW = 'nebras-flowers';

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'storefront.managed_base_domain' => 'storefronts.test',
            'tenancy.base_domains' => ['awjdev.xyz'],
        ]);
    }

    /** @return array{token: string, tenant_id: string} مستأجر قديم معرّفه غير صالح كـ hostname. */
    private function legacyTenant(string $email = 'owner@nebras.test'): array
    {
        $auth = $this->registerTenant('legacy-seed', $email);
        DB::table('tenants')->where('id', $auth['tenant_id'])->update(['slug' => self::OLD, 'name' => 'نبراس للورد والهدايا']);

        return $auth;
    }

    private function admin(bool $active = true, string $email = 'ops@awj.test'): PlatformAdministrator
    {
        return PlatformAdministrator::create([
            'name' => 'مدير', 'email' => $email, 'password' => 'a-very-strong-passphrase', 'is_active' => $active,
        ]);
    }

    /** بصمة كل صفوف المستأجر في كل جدول يحمل tenant_id — إثبات أن لا شيء غير السلاج تغيّر. */
    private function fingerprint(string $tenantId): array
    {
        $out = [];
        foreach (Schema::getTables() as $table) {
            $name = $table['name'];
            if ($name === 'migrations' || ! Schema::hasColumn($name, 'tenant_id')) {
                continue;
            }
            $rows = DB::table($name)->where('tenant_id', $tenantId)->get()
                ->map(fn ($r) => json_encode($r, JSON_UNESCAPED_UNICODE))->sort()->values()->all();
            $out[$name] = md5(implode("\n", $rows)).':'.count($rows);
        }
        ksort($out);

        return $out;
    }

    /** @test */
    public function dry_run_writes_nothing_and_reports_checks_urls_and_preserved_data(): void
    {
        $auth = $this->legacyTenant();
        $before = $this->fingerprint($auth['tenant_id']);

        $this->artisan('tenant:change-slug', ['tenant' => self::OLD, 'new_slug' => self::NEW])
            ->expectsOutputToContain('معاينة فقط')
            ->assertSuccessful();

        $this->assertSame(self::OLD, Tenant::find($auth['tenant_id'])->slug);
        $this->assertSame($before, $this->fingerprint($auth['tenant_id']));
        $this->assertSame(0, PlatformAdministratorAction::count());

        $plan = app(TenantSlugChangeService::class)->plan(self::OLD, self::NEW);
        $this->assertSame([], $plan['blockers']);
        $this->assertSame('https://nebras-flowers.storefronts.test/', $plan['urls']['storefront_preview_new']);
        $this->assertSame('nebras-flowers.awjdev.xyz', $plan['urls']['erp_new'][0]['host']);
        $this->assertTrue($plan['urls']['erp_new'][0]['resolver_maps_to_slug']);
        $this->assertGreaterThan(0, $plan['preserved']['roles'] ?? 0);
        $this->assertGreaterThan(0, $plan['preserved']['accounts'] ?? 0);
    }

    /** @test */
    public function apply_changes_only_the_slug_and_preserves_every_tenant_row_and_audits(): void
    {
        $auth = $this->legacyTenant();
        $admin = $this->admin();
        $rowBefore = (array) DB::table('tenants')->where('id', $auth['tenant_id'])->first();
        $fingerprint = $this->fingerprint($auth['tenant_id']);
        $tokens = DB::table('personal_access_tokens')->count();

        $this->artisan('tenant:change-slug', [
            'tenant' => self::OLD, 'new_slug' => self::NEW, '--apply' => true,
            '--admin' => $admin->email, '--reason' => 'إصلاح معرّف غير صالح لنطاق المتجر',
            '--confirm' => self::OLD.'->'.self::NEW,
        ])->assertSuccessful();

        $rowAfter = (array) DB::table('tenants')->where('id', $auth['tenant_id'])->first();
        $this->assertSame(self::NEW, $rowAfter['slug']);
        $this->assertSame($auth['tenant_id'], $rowAfter['id']);
        foreach (['slug', 'updated_at'] as $changed) {
            unset($rowBefore[$changed], $rowAfter[$changed]);
        }
        $this->assertSame($rowBefore, $rowAfter, 'لا عمود آخر في tenants تغيّر (الاسم، الخطة، الأرقام المرجعية…)');
        // سطر التدقيق نفسه يحمل tenant_id فهو الإضافة الوحيدة المقصودة؛ كل جدول آخر مطابق بايتاً ببايت.
        $after = $this->fingerprint($auth['tenant_id']);
        $this->assertSame(1, (int) explode(':', $after['platform_administrator_actions'])[1]);
        unset($fingerprint['platform_administrator_actions'], $after['platform_administrator_actions']);
        $this->assertSame($fingerprint, $after, 'كل بيانات المستأجر كما هي');
        $this->assertSame($tokens, DB::table('personal_access_tokens')->count());
        $this->assertSame(1, Tenant::count());

        $audit = PlatformAdministratorAction::sole();
        $this->assertSame(PlatformAdministratorAction::ACTION_SLUG_CHANGED, $audit->action);
        $this->assertSame([self::OLD, self::NEW, $admin->id, $auth['tenant_id']],
            [$audit->from_value, $audit->to_value, $audit->platform_administrator_id, $audit->tenant_id]);
    }

    /** @test */
    public function apply_is_refused_without_exact_confirmation_admin_or_reason(): void
    {
        $auth = $this->legacyTenant();
        $admin = $this->admin();
        $base = ['tenant' => self::OLD, 'new_slug' => self::NEW, '--apply' => true];
        $ok = ['--admin' => $admin->email, '--reason' => 'إصلاح معرّف غير صالح', '--confirm' => self::OLD.'->'.self::NEW];

        $this->artisan('tenant:change-slug', $base + array_merge($ok, ['--confirm' => 'yes']))->assertFailed();
        $this->artisan('tenant:change-slug', $base + array_merge($ok, ['--admin' => 'nobody@awj.test']))->assertFailed();
        $this->artisan('tenant:change-slug', $base + array_merge($ok, ['--reason' => 'x']))->assertFailed();

        $this->assertSame(self::OLD, Tenant::find($auth['tenant_id'])->slug);
        $this->assertSame(0, PlatformAdministratorAction::count());

        $inactive = $this->admin(false, 'inactive@awj.test');
        $this->expectException(RuntimeException::class);
        app(TenantSlugChangeService::class)->apply(self::OLD, self::NEW, $inactive->fresh(), 'إصلاح معرّف غير صالح');
    }

    /**
     * @test
     * @dataProvider blockingScenarios
     */
    public function blockers_prevent_any_change(string $scenario, string $newSlug, string $blocker): void
    {
        $auth = $this->legacyTenant();
        $admin = $this->admin();

        match ($scenario) {
            'used_by_other_tenant' => $this->registerTenant($newSlug, 'other@x.test'),
            'used_by_soft_deleted_tenant' => Tenant::find($this->registerTenant($newSlug, 'other@x.test')['tenant_id'])->delete(),
            'used_case_insensitively' => DB::table('tenants')->where('id', $this->registerTenant('tmp-other', 'other@x.test')['tenant_id'])->update(['slug' => strtoupper($newSlug)]),
            'tenant_has_storefront_domain' => $this->giveTenantAManagedStoreThenBreakSlug($auth),
            'base_domain_invalid' => config(['storefront.managed_base_domain' => '*.bad']),
            default => null,
        };

        $plan = app(TenantSlugChangeService::class)->plan(self::OLD, $newSlug);
        $this->assertContains($blocker, $plan['blockers']);

        try {
            app(TenantSlugChangeService::class)->apply(self::OLD, $newSlug, $admin, 'إصلاح معرّف غير صالح');
            $this->fail('expected refusal');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString($blocker, $e->getMessage());
        }
        $this->assertSame(self::OLD, Tenant::find($auth['tenant_id'])->slug);
        $this->assertSame(0, PlatformAdministratorAction::count());
    }

    private function giveTenantAManagedStoreThenBreakSlug(array $auth): void
    {
        DB::table('tenants')->where('id', $auth['tenant_id'])->update(['slug' => 'will-have-store']);
        $this->withToken($auth['token'])->postJson('/api/commerce/workspace/storefronts')->assertCreated();
        DB::table('tenants')->where('id', $auth['tenant_id'])->update(['slug' => self::OLD]);
    }

    /** @return array<string, array{string, string, string}> */
    public static function blockingScenarios(): array
    {
        return [
            'used by another tenant' => ['used_by_other_tenant', self::NEW, 'new_slug_unused_by_any_tenant'],
            'used by a soft-deleted tenant' => ['used_by_soft_deleted_tenant', self::NEW, 'new_slug_unused_by_any_tenant'],
            'used case-insensitively' => ['used_case_insensitively', self::NEW, 'new_slug_unused_by_any_tenant'],
            'reserved' => ['none', 'admin', 'new_slug_not_reserved'],
            'underscore target' => ['none', 'nebras_flowers2', 'new_slug_hostname_safe'],
            'arabic target' => ['none', 'نبراس', 'new_slug_hostname_safe'],
            'same as current' => ['none', self::OLD, 'differs_from_current'],
            'tenant has a managed store' => ['tenant_has_storefront_domain', self::NEW, 'tenant_has_no_storefront_domains'],
            'storefront base domain invalid' => ['base_domain_invalid', self::NEW, 'storefront_base_domain_valid'],
        ];
    }

    /** @test */
    public function the_tool_is_repair_only_and_refuses_a_tenant_whose_slug_is_already_safe(): void
    {
        $this->registerTenant('already-fine', 'fine@x.test');

        $plan = app(TenantSlugChangeService::class)->plan('already-fine', 'something-else');

        $this->assertContains('current_slug_is_unsafe', $plan['blockers']);
    }

    /** @test */
    public function an_unknown_tenant_or_ambiguous_reference_is_refused(): void
    {
        $this->legacyTenant();

        $this->assertContains('tenant_found', app(TenantSlugChangeService::class)->plan('no-such-tenant', self::NEW)['blockers']);
        $this->assertContains('tenant_found', app(TenantSlugChangeService::class)->plan('', self::NEW)['blockers']);
    }

    /**
     * الهدف الفعلي: لا انقطاع وصول، والمستأجر نفسه يُنشئ متجره بعد الإصلاح.
     *
     * @test
     */
    public function access_is_uninterrupted_and_the_store_can_be_created_after_the_change(): void
    {
        $auth = $this->legacyTenant();
        $other = $this->registerTenant('other-tenant', 'someone@else.test');
        Mail::fake(); // بعد التسجيل: رسائل التحقق عند التسجيل ليست موضوع الفحص
        $oldOrigin = ['Origin' => 'https://nebras_flowers.awjdev.xyz'];
        $newOrigin = ['Origin' => 'https://nebras-flowers.awjdev.xyz'];

        // قبل: العنوان القديم يعمل (وضع غير-مستأجر)، والجديد 404 (لا مستأجر بهذا السلاج بعد).
        $this->withHeaders($oldOrigin)->postJson('/api/login', ['email' => 'owner@nebras.test', 'password' => 'password123'])->assertOk();
        $this->withHeaders($newOrigin)->postJson('/api/login', ['email' => 'owner@nebras.test', 'password' => 'password123'])->assertNotFound();
        // واسترداد كلمة المرور على العنوان القديم لا يرسل شيئاً (الخلل الأصلي).
        $this->withHeaders($oldOrigin)->postJson('/api/forgot-password', ['email' => 'owner@nebras.test'])->assertOk();
        Mail::assertNothingSent();

        // الإصلاح قبله فشل الإنشاء.
        $this->withToken($auth['token'])->postJson('/api/commerce/workspace/storefronts', ['business_vertical' => 'flowers_gifts'])->assertStatus(422);

        app(TenantSlugChangeService::class)->apply(self::OLD, self::NEW, $this->admin(), 'إصلاح معرّف غير صالح لنطاق المتجر');

        // الجلسة القائمة (توكن سابق) تعمل على العنوانين.
        $this->withToken($auth['token'])->withHeaders($oldOrigin)->getJson('/api/me')->assertOk();
        $this->withToken($auth['token'])->withHeaders($newOrigin)->getJson('/api/me')->assertOk();
        // دخول جديد على العنوان الجديد للمالك، ورفض مستخدم مستأجر آخر عليه، وبقاء العنوان القديم يعمل.
        $this->withHeaders($newOrigin)->postJson('/api/login', ['email' => 'owner@nebras.test', 'password' => 'password123'])->assertOk();
        $this->withHeaders($newOrigin)->postJson('/api/login', ['email' => 'someone@else.test', 'password' => 'password123'])->assertStatus(422);
        $this->withHeaders($oldOrigin)->postJson('/api/login', ['email' => 'owner@nebras.test', 'password' => 'password123'])->assertOk();
        // الاسترداد يعمل الآن بروابط العنوان الجديد.
        $this->withHeaders($newOrigin)->postJson('/api/forgot-password', ['email' => 'owner@nebras.test'])->assertOk();
        Mail::assertSent(AuthActionMail::class, fn ($m) => str_contains($m->url, '://nebras-flowers.awjdev.xyz/reset-password'));

        // المتجر: ينجح لنفس المستأجر ويظهر في القائمة بمعاينة صحيحة، ولا يمسّ المستأجر الآخر.
        $res = $this->withToken($auth['token'])->postJson('/api/commerce/workspace/storefronts', ['business_vertical' => 'flowers_gifts'])->assertCreated();
        $this->assertSame('https://nebras-flowers.storefronts.test/', $res->json('data.store.preview_url'));
        $this->assertSame('flowers_gifts', $res->json('data.store.business_vertical'));
        $this->assertCount(1, $this->withToken($auth['token'])->getJson('/api/commerce/workspace/storefronts')->json('data.stores'));
        // عزل: توكن مستأجر آخر مرفوض على أصل مستأجر نبراس الجديد، ولا يرى متاجره من أصله هو.
        $this->withToken($other['token'])->withHeaders($newOrigin)->getJson('/api/commerce/workspace/storefronts')->assertForbidden();
        $this->flushHeaders();
        $otherList = $this->withToken($other['token'])->getJson('/api/commerce/workspace/storefronts')->assertOk();
        $this->assertCount(0, $otherList->json('data.stores'));
    }
}
