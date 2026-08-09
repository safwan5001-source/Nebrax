<?php

namespace Tests\Feature;

use App\Models\Appointment;
use App\Models\Partner;
use App\Support\BranchSettings;
use App\Tenancy\BranchContext;
use App\Tenancy\BranchScope;
use App\Tenancy\BranchSharing;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  P3-ج-١ — بنية العزل المشروط وحلّ المراجع
 * ═══════════════════════════════════════════════════════════════
 *  البنية وحدها: لا نموذج إنتاجي يُصنَّف في هذه الموجة، فالسلوك القائم
 *  لا يتغيّر بحرف. تُختبر الآلية عبر `BranchSharingProbe` على جدول
 *  المواعيد الحقيقي — بـ SQL فعلي على sqlite وpgsql.
 *
 *  تشغيل: php artisan test --filter=BranchSharingTest
 */
class BranchSharingTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    protected function setUp(): void
    {
        parent::setUp();
        BranchSharingProbe::reset();
    }

    private function branch(string $token, string $name): string
    {
        return $this->withToken($token)->postJson('/api/branches', ['name' => $name])
            ->assertCreated()['data']['id'];
    }

    /** ينشئ موعداً في فرع محدّد مباشرةً عبر النموذج (بلا HTTP). */
    private function appointment(string $tenantId, ?string $branchId, string $title, string $status = 'scheduled'): Appointment
    {
        return Appointment::withoutGlobalScope(BranchScope::class)->create([
            'tenant_id'      => $tenantId,
            'branch_id'      => $branchId,
            'title'          => $title,
            'status'         => $status,
            'appointment_at' => '2026-07-01 10:00:00',
        ]);
    }

    /** يهيّئ مستأجراً بفرعين ويضبط الفرع النشط على الأول. */
    private function twoBranches(): array
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main   = $this->withToken($auth['token'])->getJson('/api/branches')['data'][0]['id'];
        $khobar = $this->branch($auth['token'], 'فرع الخبر');

        app(BranchContext::class)->set($main);
        app(BranchSharing::class)->forget();

        return [$auth, $main, $khobar];
    }

    // ═══════════════════ BranchSharing ═══════════════════

    /** @test */
    public function sharing_defaults_to_true_for_every_key(): void
    {
        $sharing = app(BranchSharing::class);

        foreach (['share_customers', 'share_products', 'share_suppliers', 'share_cost_centers'] as $key) {
            $this->assertTrue($sharing->shared($key), "المفتاح «{$key}» يجب أن يكون مشتركاً افتراضياً.");
        }
    }

    /** بلا سياق مستأجر (artisan/مهام مجدولة) يميل الافتراض للإظهار لا الإخفاء. */
    /** @test */
    public function sharing_is_safe_without_a_tenant_context(): void
    {
        app(TenantContext::class)->forget();

        $this->assertTrue(app(BranchSharing::class)->shared('share_products'));
        $this->assertTrue(app(BranchSharing::class)->shared('مفتاح_غير_معروف'));
    }

    /** @test */
    public function sharing_reflects_saved_settings_and_invalidates_on_update(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $sharing = app(BranchSharing::class);
        $sharing->forget();
        $this->assertTrue($sharing->shared('share_products'));

        BranchSettings::merge(['share_products' => false]);

        // بلا إبطال داخل merge كان الطلب سيُكمل بقيمة قديمة
        $this->assertFalse($sharing->shared('share_products'));
        $this->assertTrue($sharing->shared('share_customers'), 'إطفاء مفتاح لا يمسّ غيره.');
    }

    /** المفاتيح تُقرأ مرة واحدة للطلب — وإلا استعلامٌ إضافي مع كل استعلام مشمول. */
    /** @test */
    public function sharing_reads_the_database_only_once_per_request(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $sharing = app(BranchSharing::class);
        $sharing->forget();

        $queries = 0;
        DB::listen(function () use (&$queries) { $queries++; });

        for ($i = 0; $i < 5; $i++) {
            $sharing->shared('share_products');
        }

        $this->assertSame(1, $queries, 'خمس قراءات = استعلام واحد.');
    }

    // ═══════════════════ العزل المشروط ═══════════════════

    /** @test */
    public function a_shared_model_is_not_filtered_at_all(): void
    {
        [$auth, $main, $khobar] = $this->twoBranches();

        $this->appointment($auth['tenant_id'], $main, 'موعد الرئيسي');
        $this->appointment($auth['tenant_id'], $khobar, 'موعد الخبر');

        // المفتاح مفعّل (الافتراضي) ⇒ الفرعان مرئيان
        $this->assertSame(2, BranchSharingProbe::count());

        // ونفس الجدول عبر النموذج غير المشمول يبقى معزولاً — فالإعفاء لا يتسرّب
        $this->assertSame(1, Appointment::count());
    }

    /** @test */
    public function turning_the_key_off_activates_full_isolation(): void
    {
        [$auth, $main, $khobar] = $this->twoBranches();

        $this->appointment($auth['tenant_id'], $main, 'موعد الرئيسي');
        $this->appointment($auth['tenant_id'], $khobar, 'موعد الخبر');

        BranchSettings::merge(['share_products' => false]);

        $this->assertSame(1, BranchSharingProbe::count());
        $this->assertSame('موعد الرئيسي', BranchSharingProbe::first()->title);
    }

    /** @test */
    public function legacy_rows_without_a_branch_stay_visible_even_when_isolated(): void
    {
        [$auth, $main, $khobar] = $this->twoBranches();

        $this->appointment($auth['tenant_id'], null, 'موعد قديم');
        $this->appointment($auth['tenant_id'], $khobar, 'موعد الخبر');

        BranchSettings::merge(['share_products' => false]);

        $this->assertSame(1, BranchSharingProbe::count());
        $this->assertSame('موعد قديم', BranchSharingProbe::first()->title);
    }

    /**
     * المشاركة الجزئية — النمط الذي يحتاجه الطرف: العملاء بمفتاحهم والموردون
     * بمفتاحهم، فبعض الصفوف تُستثنى وبعضها يُعزل، في استعلام واحد.
     *
     * @test
     */
    public function a_partial_exemption_shares_only_the_matching_rows(): void
    {
        [$auth, $main, $khobar] = $this->twoBranches();

        $this->appointment($auth['tenant_id'], $main, 'موعد الرئيسي');
        $this->appointment($auth['tenant_id'], $khobar, 'موعد الخبر', 'cancelled'); // مُستثنى
        $this->appointment($auth['tenant_id'], $khobar, 'موعد الخبر الآخر');        // معزول

        BranchSharingProbe::$partial = true;

        $titles = BranchSharingProbe::orderBy('title')->pluck('title')->all();
        $this->assertSame(['موعد الخبر', 'موعد الرئيسي'], $titles);
    }

    /** @test */
    public function conditional_isolation_never_fires_without_a_branch_context(): void
    {
        [$auth, $main, $khobar] = $this->twoBranches();

        $this->appointment($auth['tenant_id'], $main, 'موعد الرئيسي');
        $this->appointment($auth['tenant_id'], $khobar, 'موعد الخبر');

        BranchSettings::merge(['share_products' => false]);
        app(BranchContext::class)->forget(); // كمهمة مجدولة

        $this->assertSame(2, BranchSharingProbe::count());
    }

    // ═══════════════════ حلّ المراجع ═══════════════════

    /** @test */
    public function reference_queries_bypass_branch_isolation(): void
    {
        [$auth, $main, $khobar] = $this->twoBranches();

        $other = $this->appointment($auth['tenant_id'], $khobar, 'موعد الخبر');

        // التصفّح لا يراه…
        $this->assertNull(Appointment::find($other->id));
        // …وحلّ المرجع يراه: المستند القائم حجّة، مرجعه لا يُصفّى
        $this->assertNotNull(BranchScope::reference(Appointment::class)->find($other->id));
    }

    /** حلّ المرجع يتجاوز الفرع **ولا** يتجاوز المستأجر — الحاجز الأمني يبقى. */
    /** @test */
    public function reference_queries_still_respect_tenant_isolation(): void
    {
        $b = $this->registerTenant('globex', 'owner@globex.test');
        app(TenantContext::class)->set($b['tenant_id']);
        $foreign = $this->appointment($b['tenant_id'], null, 'موعد مستأجر آخر');

        $a = $this->registerTenant('acme', 'owner@acme.test');
        app(TenantContext::class)->set($a['tenant_id']);

        $this->assertNull(BranchScope::reference(Appointment::class)->find($foreign->id));
    }

    /** @test */
    public function reference_relations_drop_the_branch_scope_and_keep_eloquent_inference(): void
    {
        $relation = (new BranchReferenceProbe())->partner();

        $this->assertContains(BranchScope::class, $relation->getQuery()->removedScopes());
        $this->assertSame('partner', $relation->getRelationName());
        $this->assertSame('partner_id', $relation->getForeignKeyName()); // الاستنتاج سليم رغم الالتفاف
        $this->assertSame(Partner::class, get_class($relation->getRelated()));
    }
}
