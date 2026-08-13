<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  شعار الشركة — من «تصميم المستندات» إلى مستوى الشركة
 * ═══════════════════════════════════════════════════════════════
 *  كان يعيش داخل `sales_config.designs` بجوار `show_logo` و`logo_height`
 *  اللذين يخصّان طباعة الفاتورة. وحين صار يظهر في قشرة التطبيق لكل مستخدم في
 *  كل صفحة لم يعد موضعه صحيحاً: قراءته كانت خلف صلاحية `invoices.view`،
 *  وتلزمها استدعاءً إضافياً لجلب قالبٍ ونصوصٍ وختمٍ من أجل صورة واحدة.
 *
 *  فصار في `settings['company']['logo']` ويُعاد في `/me`. والشاشة لم تتغيّر:
 *  ما زالت ترفعه من قسم «التصاميم والهوية» — والمتحكّم يوجّهه إلى مخزنه الجديد.
 *
 *  تشغيل: php artisan test --filter=CompanyLogoTest
 */
class CompanyLogoTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

    private string $token;

    protected function setUp(): void
    {
        parent::setUp();

        $this->token = $this->registerTenant()['token'];
    }

    /** الافتراض: لا شعار — فتعرض القشرة الحرف الأول. */
    /** @test */
    public function a_new_tenant_has_no_logo(): void
    {
        $this->assertSame(
            '',
            $this->withToken($this->token)->getJson('/api/me')->assertOk()['company']['logo']
        );
    }

    /**
     * **جوهر النقل.** الرفع من شاشة التصاميم يُخزَّن على مستوى الشركة،
     * ويُقرأ من `/me` — الاستدعاء الذي تعتمده القشرة أصلاً.
     *
     * @test
     */
    public function uploading_from_the_designs_screen_lands_on_the_company(): void
    {
        $this->withToken($this->token)->putJson('/api/sales-config/designs', [
            'data' => ['template' => 'classic', 'logo' => self::PNG],
        ])->assertOk();

        $this->assertSame(
            self::PNG,
            $this->withToken($this->token)->getJson('/api/me')['company']['logo'],
            'القشرة تقرؤه من /me بلا طلب إضافي.'
        );

        app(TenantContext::class)->set(Tenant::firstOrFail()->id);
        $this->assertSame(self::PNG, Settings::get('company', 'logo'));
    }

    /** والشاشة تراه كما رفعته — لا تتغيّر تجربة المستخدم بالنقل. */
    /** @test */
    public function the_designs_screen_still_reads_it_back(): void
    {
        $this->withToken($this->token)->putJson('/api/sales-config/designs', [
            'data' => ['template' => 'modern', 'logo' => self::PNG],
        ])->assertOk();

        $designs = $this->withToken($this->token)->getJson('/api/sales-config/designs')->assertOk()['data'];

        $this->assertSame(self::PNG, $designs['logo']);
        $this->assertSame('modern', $designs['template'], 'وبقية الإعدادات في موضعها.');
    }

    /**
     * **مصدر واحد لا نسختان.** الشعار يُنزَع من حمولة التصميم قبل حفظها، فلا
     * تبقى نسخة قديمة تنحرف عن الجديدة.
     *
     * @test
     */
    public function the_logo_is_not_duplicated_inside_the_designs_section(): void
    {
        $this->withToken($this->token)->putJson('/api/sales-config/designs', [
            'data' => ['template' => 'classic', 'logo' => self::PNG],
        ])->assertOk();

        $settings = json_decode((string) DB::table('tenants')->value('settings'), true) ?: [];

        $this->assertArrayNotHasKey('logo', $settings['sales_config']['designs'] ?? []);
        $this->assertSame(self::PNG, $settings['company']['logo']);
    }

    /** إفراغه يمحوه فعلاً — فترجع القشرة إلى الحرف الأول. */
    /** @test */
    public function clearing_the_logo_removes_it(): void
    {
        $this->withToken($this->token)->putJson('/api/sales-config/designs', [
            'data' => ['logo' => self::PNG],
        ])->assertOk();

        $this->withToken($this->token)->putJson('/api/sales-config/designs', [
            'data' => ['logo' => ''],
        ])->assertOk();

        $this->assertSame('', $this->withToken($this->token)->getJson('/api/me')['company']['logo']);
    }

    /**
     * **الترحيل لا يُفقد أحداً شعاره.** هجرة 000048 تنقل القيمة القائمة من
     * موضعها القديم إلى الجديد — فمن رفع شعاره قبل الترقية يجده في القشرة.
     *
     * @test
     */
    public function the_migration_moves_an_existing_logo_up(): void
    {
        // مستأجر «قائم»: شعاره داخل تصميم المستندات كما كان قبل الترقية.
        $tenant = Tenant::firstOrFail();
        DB::table('tenants')->where('id', $tenant->id)->update([
            'settings' => json_encode(['sales_config' => ['designs' => ['logo' => self::PNG, 'template' => 'classic']]]),
        ]);

        $this->runMigration();

        $this->assertSame(
            self::PNG,
            $this->withToken($this->token)->getJson('/api/me')['company']['logo']
        );
    }

    /** ومن نُقل شعاره من قبل لا يُكتب عليه مرّتين. */
    /** @test */
    public function the_migration_never_overwrites_a_moved_logo(): void
    {
        $tenant = Tenant::firstOrFail();
        DB::table('tenants')->where('id', $tenant->id)->update([
            'settings' => json_encode([
                'company'      => ['logo' => 'data:image/png;base64,NEW'],
                'sales_config' => ['designs' => ['logo' => self::PNG]],
            ]),
        ]);

        $this->runMigration();

        $this->assertSame(
            'data:image/png;base64,NEW',
            $this->withToken($this->token)->getJson('/api/me')['company']['logo']
        );
    }

    /** ومستأجرٌ بلا شعار لا تُنشئ له الهجرة مفتاحاً فارغاً. */
    /** @test */
    public function the_migration_skips_a_tenant_without_a_logo(): void
    {
        $tenant = Tenant::firstOrFail();
        DB::table('tenants')->where('id', $tenant->id)->update(['settings' => json_encode([])]);

        $this->runMigration();

        $settings = json_decode((string) DB::table('tenants')->where('id', $tenant->id)->value('settings'), true) ?: [];
        $this->assertArrayNotHasKey('company', $settings);
    }

    /**
     * `artisan migrate --path` لا يُجدي على هجرة سُجّلت في `RefreshDatabase`
     * — يتخطّاها الـ migrator صامتاً فيمرّ اختبارٌ لم يُشغّل ما يدّعي اختباره.
     */
    private function runMigration(): void
    {
        (require database_path('migrations/2025_01_01_000048_move_logo_to_company_settings.php'))->up();
    }
}
