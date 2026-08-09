<?php

namespace Tests\Feature;

use App\Models\CostCenter;
use App\Models\Invoice;
use App\Models\Partner;
use App\Support\BranchSettings;
use App\Tenancy\BranchContext;
use App\Tenancy\BranchScope;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  P3-ج-٣ — الأطراف بمفتاحين · مراكز التكلفة بمفتاحها
 * ═══════════════════════════════════════════════════════════════
 *  الطرف كيان واحد بمفتاحَي مشاركة، فيُختبر بأربع توليفات كاملة، مع
 *  التحقّق أن `both` يبقى مشتركاً ما دام أحدهما مفعّلاً.
 *
 *  وتُختبر معه المسارات التي كانت ستنكسر صامتةً: الحدّ الائتماني · اسم
 *  المشتري في ZATCA · كشف حساب الطرف · أعمار الديون · تقرير مراكز التكلفة.
 *
 *  تشغيل: php artisan test --filter=BranchPartnerIsolationTest
 */
class BranchPartnerIsolationTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function branch(string $token, string $name): string
    {
        return $this->withToken($token)->postJson('/api/branches', ['name' => $name])
            ->assertCreated()['data']['id'];
    }

    private function mainBranch(string $token): string
    {
        return $this->withToken($token)->getJson('/api/branches')['data'][0]['id'];
    }

    private function partner(string $token, string $branchId, string $name, string $type, array $extra = []): array
    {
        return $this->withToken($token)->withHeaders(['X-Branch-Id' => $branchId])
            ->postJson('/api/partners', array_merge(['name' => $name, 'type' => $type], $extra))
            ->assertCreated()['data'];
    }

    /** أسماء الأطراف التي يراها فرعٌ معيّن، مرتّبة. */
    private function visibleTo(string $token, string $branchId): array
    {
        $names = $this->withToken($token)->withHeaders(['X-Branch-Id' => $branchId])
            ->getJson('/api/partners')->assertOk()->json('data.*.name');
        sort($names);

        return $names;
    }

    /** مستأجر بفرعين، وثلاثة أطراف في «فرع الخبر»: عميل ومورّد وكلاهما. */
    private function scenario(): array
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main   = $this->mainBranch($auth['token']);
        $khobar = $this->branch($auth['token'], 'فرع الخبر');

        $this->partner($auth['token'], $khobar, 'عميل', 'customer');
        $this->partner($auth['token'], $khobar, 'مورّد', 'supplier');
        $this->partner($auth['token'], $khobar, 'كلاهما', 'both');

        return [$auth, $main, $khobar];
    }

    // ═══════════ التوليفات الأربع لمفتاحَي الطرف ═══════════

    /** @test */
    public function both_keys_on_shares_every_partner(): void
    {
        [$auth, $main] = $this->scenario();

        $this->assertSame(['عميل', 'كلاهما', 'مورّد'], $this->visibleTo($auth['token'], $main));
    }

    /** @test */
    public function both_keys_off_isolates_every_partner(): void
    {
        [$auth, $main] = $this->scenario();

        BranchSettings::merge(['share_customers' => false, 'share_suppliers' => false]);

        $this->assertSame([], $this->visibleTo($auth['token'], $main));
    }

    /**
     * مفتاح العملاء وحده مفعّل: العملاء يظهرون، والموردون يُعزلون،
     * و«كلاهما» يظهر لأنه يحمل صفة العميل.
     *
     * @test
     */
    public function customers_only_shares_customers_and_both(): void
    {
        [$auth, $main] = $this->scenario();

        BranchSettings::merge(['share_customers' => true, 'share_suppliers' => false]);

        $this->assertSame(['عميل', 'كلاهما'], $this->visibleTo($auth['token'], $main));
    }

    /** @test */
    public function suppliers_only_shares_suppliers_and_both(): void
    {
        [$auth, $main] = $this->scenario();

        BranchSettings::merge(['share_customers' => false, 'share_suppliers' => true]);

        $this->assertSame(['كلاهما', 'مورّد'], $this->visibleTo($auth['token'], $main));
    }

    /** @test */
    public function a_partner_still_sees_its_own_branch_when_fully_isolated(): void
    {
        [$auth, $main, $khobar] = $this->scenario();

        BranchSettings::merge(['share_customers' => false, 'share_suppliers' => false]);

        $this->assertSame(['عميل', 'كلاهما', 'مورّد'], $this->visibleTo($auth['token'], $khobar));
    }

    /** @test */
    public function legacy_partners_without_a_branch_stay_visible_when_isolated(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main = $this->mainBranch($auth['token']);
        $khobar = $this->branch($auth['token'], 'فرع الخبر');
        $this->partner($auth['token'], $khobar, 'عميل الخبر', 'customer');

        // بلا سياق فرع فلا يوسمه BelongsToBranch — كصفٍّ منشأ قبل الفروع
        app(BranchContext::class)->forget();
        $legacy = Partner::create([
            'tenant_id' => $auth['tenant_id'],
            'name' => 'عميل قديم', 'type' => 'customer',
        ]);
        $this->assertNull($legacy->branch_id);

        BranchSettings::merge(['share_customers' => false, 'share_suppliers' => false]);

        $this->assertSame(['عميل قديم'], $this->visibleTo($auth['token'], $main));
    }

    // ═══════════ المسارات التي كانت ستنكسر صامتةً ═══════════

    /**
     * **الأخطر.** الحدّ الائتماني يُقرأ من الطرف؛ لو صُفّي بالفرع لعاد `null`
     * فسقط السقف صامتاً ومرّت فاتورة كان يجب أن تُرفض.
     *
     * @test
     */
    public function the_credit_limit_still_applies_to_a_cross_branch_customer(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main   = $this->mainBranch($auth['token']);
        $khobar = $this->branch($auth['token'], 'فرع الخبر');

        // عميل في الخبر بحدّ ائتماني ١٠٠ ريال
        $customer = $this->partner($auth['token'], $khobar, 'عميل محدود', 'customer', ['credit_limit' => 10000]);

        // فاتورة آجلة بـ ٢٣٠ ريال من الفرع الرئيسي — تتجاوز الحد
        $invoice = $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])
            ->postJson('/api/invoices', [
                'partner_id' => $customer['id'], 'payment_type' => 'credit',
                'items' => [['quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 15]],
            ])->assertCreated()['data'];

        BranchSettings::merge(['share_customers' => false, 'share_suppliers' => false]);

        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])
            ->postJson("/api/invoices/{$invoice['id']}/post")
            ->assertStatus(422); // الحد ما زال يُطبَّق
    }

    /** اسم المشتري في UBL يُقرأ من الطرف — فراغه يعني هاشاً على فاتورة مشوّهة. */
    /** @test */
    public function the_zatca_buyer_name_survives_isolation(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main   = $this->mainBranch($auth['token']);
        $khobar = $this->branch($auth['token'], 'فرع الخبر');

        $customer = $this->partner($auth['token'], $khobar, 'مؤسسة الخبر التجارية', 'customer');
        $invoice = $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])
            ->postJson('/api/invoices', [
                'partner_id' => $customer['id'], 'payment_type' => 'cash',
                'items' => [['quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 15]],
            ])->assertCreated()['data'];

        BranchSettings::merge(['share_customers' => false, 'share_suppliers' => false]);

        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])
            ->postJson("/api/invoices/{$invoice['id']}/post")->assertOk();

        $xml = Invoice::withoutGlobalScope(BranchScope::class)->find($invoice['id'])->zatca_xml;
        $this->assertStringContainsString('مؤسسة الخبر التجارية', (string) $xml);
    }

    /** @test */
    public function the_partner_statement_opens_from_any_branch(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main   = $this->mainBranch($auth['token']);
        $khobar = $this->branch($auth['token'], 'فرع الخبر');
        $customer = $this->partner($auth['token'], $khobar, 'عميل الخبر', 'customer');

        BranchSettings::merge(['share_customers' => false, 'share_suppliers' => false]);

        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])
            ->getJson("/api/reports/partner-statement/{$customer['id']}")
            ->assertOk();
    }

    /** أعمار الديون تعرض أسماء أطراف مستندات قائمة، لا نتيجة تصفّح. */
    /** @test */
    public function the_aging_report_keeps_partner_names_when_isolated(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main   = $this->mainBranch($auth['token']);
        $khobar = $this->branch($auth['token'], 'فرع الخبر');
        $customer = $this->partner($auth['token'], $khobar, 'عميل الخبر', 'customer');

        $invoice = $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])
            ->postJson('/api/invoices', [
                'partner_id' => $customer['id'], 'payment_type' => 'credit',
                'items' => [['quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 15]],
            ])->assertCreated()['data'];
        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])
            ->postJson("/api/invoices/{$invoice['id']}/post")->assertOk();

        BranchSettings::merge(['share_customers' => false, 'share_suppliers' => false]);

        $rows = $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])
            ->getJson('/api/reports/aging/receivable')->assertOk()->json('rows');

        $this->assertNotEmpty($rows);
        $this->assertSame('عميل الخبر', $rows[0]['name']);
    }

    // ═══════════ مراكز التكلفة ═══════════

    /** @test */
    public function cost_centers_isolate_when_their_key_is_off(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main   = $this->mainBranch($auth['token']);
        $khobar = $this->branch($auth['token'], 'فرع الخبر');

        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $khobar])
            ->postJson('/api/cost-centers', ['code' => 'CC-KH', 'name' => 'مركز الخبر'])->assertCreated();

        // مشترك افتراضياً
        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])
            ->getJson('/api/cost-centers')->assertOk()->assertJsonCount(1, 'data');

        BranchSettings::merge(['share_cost_centers' => false]);

        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])
            ->getJson('/api/cost-centers')->assertOk()->assertJsonCount(0, 'data');
    }

    /**
     * التفرّد `(tenant_id, code)` على مستوى المؤسسة — فالفحص المسبق يجب أن
     * يتجاوز العزل، وإلا مرّ الكود وانفجر القيد الفريد بخطأ ٥٠٠ بدل ٤٢٢.
     *
     * @test
     */
    public function a_duplicate_cost_center_code_across_branches_returns_422_not_500(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main   = $this->mainBranch($auth['token']);
        $khobar = $this->branch($auth['token'], 'فرع الخبر');

        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $khobar])
            ->postJson('/api/cost-centers', ['code' => 'CC-1', 'name' => 'مركز الخبر'])->assertCreated();

        BranchSettings::merge(['share_cost_centers' => false]);

        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])
            ->postJson('/api/cost-centers', ['code' => 'CC-1', 'name' => 'مركز الرئيسي'])
            ->assertStatus(422);
    }

    /** تقرير الربحية يقرأ المراكز خارج العزل — وإلا اختفت صفوف لها قيود. */
    /** @test */
    public function the_cost_center_report_lists_isolated_centers(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main   = $this->mainBranch($auth['token']);
        $khobar = $this->branch($auth['token'], 'فرع الخبر');

        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $khobar])
            ->postJson('/api/cost-centers', ['code' => 'CC-KH', 'name' => 'مركز الخبر'])->assertCreated();

        BranchSettings::merge(['share_cost_centers' => false]);

        $rows = $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])
            ->getJson('/api/reports/cost-center-profitability')->assertOk()->json('rows');

        $codes = array_column($rows, 'code');
        $this->assertContains('CC-KH', $codes, 'مركز له صفّ في التقرير اختفى بسبب العزل.');
        $this->assertSame(1, CostCenter::withoutGlobalScope(BranchScope::class)->count());
    }
}
