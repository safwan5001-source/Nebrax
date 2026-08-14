<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Invoice;
use App\Models\Partner;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Support\Settings;
use App\Support\ZatcaIcvScope;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  نطاق عدّاد ICV — إعدادٌ محروس لا مفتاحٌ حرّ
 * ═══════════════════════════════════════════════════════════════
 *  الافتراض `tenant` ولا يتغيّر لمستأجر قائم أو جديد. و`branch` خيارٌ
 *  يتطلّب رقماً ضريبياً مستقلاً لكل فرع — وهو غير متاح اليوم — فيُرفض
 *  تفعيله على الخادم لا في الشاشة وحدها.
 *
 *  تشغيل: php artisan test --filter=ZatcaIcvScopeTest
 */
class ZatcaIcvScopeTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    protected Tenant $tenant;
    protected Partner $customer;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name'       => 'نبراس الطموح',
            'slug'       => 'nibras',
            'vat_number' => '300000000000003',
            'currency'   => 'SAR',
        ]);

        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);

        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
    }

    private function postInvoice(): Invoice
    {
        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash', 'invoice_date' => '2026-03-01'],
            [['description' => 'منتج', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        );

        return app(InvoiceService::class)->post($invoice);
    }

    // ═══════════════════════════════════════════════════════════
    //  الافتراض
    // ═══════════════════════════════════════════════════════════

    /** الافتراض `tenant` لمستأجر جديد بلا أي ضبط. @test */
    public function the_default_scope_is_tenant(): void
    {
        $this->assertSame('tenant', Settings::get('zatca', 'icv_scope'));
        $this->assertSame(ZatcaIcvScope::TENANT, ZatcaIcvScope::current());
    }

    /**
     * تحت النطاق الافتراضي: العدّاد سلسلة واحدة متّصلة للمؤسسة مهما تعدّدت
     * الفروع — وسلسلة الهاش تتبعه.
     *
     * @test
     */
    public function under_tenant_scope_the_counter_runs_as_one_chain_across_branches(): void
    {
        $riyadh = Branch::create(['name' => 'الرياض', 'code' => '00001']);
        $khobar = Branch::create(['name' => 'الخبر', 'code' => '00002']);

        app(BranchContext::class)->set($riyadh->id);
        $first  = $this->postInvoice();
        app(BranchContext::class)->set($khobar->id);
        $second = $this->postInvoice();
        app(BranchContext::class)->set($riyadh->id);
        $third  = $this->postInvoice();

        $this->assertSame([1, 2, 3], [$first->zatca_icv, $second->zatca_icv, $third->zatca_icv]);

        // السلسلة متّصلة عبر الفروع: هاش كلٍّ هو سابقُ تاليه.
        $this->assertSame($first->zatca_hash, $second->zatca_previous_hash);
        $this->assertSame($second->zatca_hash, $third->zatca_previous_hash);

        app(BranchContext::class)->forget();
    }

    /** والعدّاد يبقى فريداً تحت النطاق الافتراضي. @test */
    public function under_tenant_scope_the_counter_stays_unique(): void
    {
        $posted = $this->postInvoice();
        $other  = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash', 'invoice_date' => '2026-03-01'],
            [['description' => 'منتج', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        );

        $this->expectException(QueryException::class);

        $other->forceFill(['zatca_icv' => $posted->zatca_icv])->save();
    }

    // ═══════════════════════════════════════════════════════════
    //  الحارس
    // ═══════════════════════════════════════════════════════════

    /**
     * الشرط الأول غير مستوفى اليوم: لا رقم ضريبي مستقلّ للفروع — الرقم
     * الوحيد في النظام هو `tenants.vat_number` وكل الفروع تشترك فيه.
     *
     * @test
     */
    public function branch_scope_is_unavailable_while_branches_have_no_own_vat_number(): void
    {
        $this->assertFalse(ZatcaIcvScope::branchAvailable());
        $this->assertSame('no_branch_vat_number', ZatcaIcvScope::unavailableReason());
    }

    /** الواجهة تُعطِّل الخيار من هذه الحمولة لا من تخمينها. @test */
    public function the_settings_endpoint_reports_why_branch_scope_is_blocked(): void
    {
        $auth = $this->registerTenant();

        $res = $this->withToken($auth['token'])->getJson('/api/zatca-settings')->assertOk();

        $this->assertSame('tenant', $res['data']['icv_scope']);
        $this->assertFalse($res['meta']['branch_scope_available']);
        $this->assertSame('no_branch_vat_number', $res['meta']['branch_scope_blocker']);
    }

    /**
     * تعطيل الخيار في الشاشة يمنع الضغطة لا الطلب — فالرفض على الخادم.
     *
     * @test
     */
    public function enabling_branch_scope_over_the_api_is_rejected(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])
            ->putJson('/api/zatca-settings', ['icv_scope' => 'branch'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('icv_scope');

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame('tenant', Settings::get('zatca', 'icv_scope'));
    }

    /**
     * الدفاع الأخير: حتى لو كُتبت `branch` في الإعدادات التفافاً على التحقّق،
     * يتجاهلها الحلّ ما دام الشرط ناقصاً — فلا تنكسر سلسلةٌ بقيمةٍ مخزَّنة.
     *
     * @test
     */
    public function a_stored_branch_value_is_ignored_while_unavailable(): void
    {
        $this->tenant->update(['settings' => ['zatca' => ['icv_scope' => 'branch']]]);

        $this->assertSame('branch', Settings::get('zatca', 'icv_scope'));
        $this->assertSame(ZatcaIcvScope::TENANT, ZatcaIcvScope::current());

        // والسلوك الفعليّ يتبع الحلّ لا المخزَّن: سلسلة واحدة عبر الفروع.
        $riyadh = Branch::create(['name' => 'الرياض', 'code' => '00001']);
        $khobar = Branch::create(['name' => 'الخبر', 'code' => '00002']);

        app(BranchContext::class)->set($riyadh->id);
        $first = $this->postInvoice();
        app(BranchContext::class)->set($khobar->id);
        $second = $this->postInvoice();

        $this->assertSame([1, 2], [$first->zatca_icv, $second->zatca_icv]);

        app(BranchContext::class)->forget();
    }

    /**
     * الشرط الثاني موثَّقاً باختبار: القيد الفريد القائم `(tenant_id,
     * zatca_icv)` يمنع بنيوياً أن يبدأ فرعان من ١.
     *
     * فتفعيل `branch` قبل توسيع الفهرس لا يُنتج سلاسل خاطئة بل **يُسقط
     * الترحيل بانتهاك قيد**. هذا ما يجعل الحارس شرطين لا شرطاً واحداً، وهذا
     * الاختبار هو ما يمنع أن يُرفع أحدهما وحده بحسن نيّة.
     *
     * @test
     */
    public function per_branch_counters_would_violate_the_current_unique_index(): void
    {
        $riyadh = Branch::create(['name' => 'الرياض', 'code' => '00001']);
        $khobar = Branch::create(['name' => 'الخبر', 'code' => '00002']);

        app(BranchContext::class)->set($riyadh->id);
        $first = $this->postInvoice();
        $this->assertSame(1, $first->zatca_icv);

        // ما كان سيفعله النطاق الفرعي: عدّادٌ يبدأ من ١ في الفرع الثاني.
        app(BranchContext::class)->set($khobar->id);
        $second = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash', 'invoice_date' => '2026-03-01'],
            [['description' => 'منتج', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        );

        $this->expectException(QueryException::class);

        $second->forceFill(['zatca_icv' => 1, 'zatca_hash' => 'x'])->save();
    }
}
