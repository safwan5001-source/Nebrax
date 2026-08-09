<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * بُعد الفرع على المستندات وسطور القيد. الفرع **وسم** لا حاجز عزل:
 * لا يغيّر التوازن ولا الأرصدة، ويُتيح تقارير لكل فرع مع بقاء المجمّع شاملاً.
 * تشغيل: php artisan test --filter=BranchDimensionTest
 */
class BranchDimensionTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** ينشئ فاتورة نقدية مرحّلة، اختيارياً بترويسة فرع. */
    private function postInvoice(string $token, int $unitPrice, ?string $branchId = null): array
    {
        $headers = $branchId ? ['X-Branch-Id' => $branchId] : [];
        $partner = $this->withToken($token)->withHeaders($headers)
            ->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])['data']['id'];

        $inv = $this->withToken($token)->withHeaders($headers)->postJson('/api/invoices', [
            'partner_id' => $partner, 'payment_type' => 'cash',
            'items' => [['quantity' => 1, 'unit_price' => $unitPrice, 'tax_rate' => 15]],
        ])['data'];

        $this->withToken($token)->withHeaders($headers)->postJson("/api/invoices/{$inv['id']}/post")->assertOk();

        return $inv;
    }

    /** @test */
    public function documents_and_journal_lines_are_stamped_with_the_active_branch(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $khobar = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع الخبر'])['data']['id'];
        $inv = $this->postInvoice($auth['token'], 10000, $khobar);

        // المستند مُوسَم بالفرع
        $this->assertSame($khobar, Invoice::find($inv['id'])->branch_id);

        // وكل سطور قيده أيضاً — والقيد يبقى متوازناً
        $entry = JournalEntry::with('lines')->where('source_id', $inv['id'])->firstOrFail();
        $this->assertNotEmpty($entry->lines);
        foreach ($entry->lines as $line) {
            $this->assertSame($khobar, $line->branch_id);
        }
        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
    }

    /** @test */
    public function it_falls_back_to_the_main_branch_without_a_header(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main = $this->withToken($auth['token'])->getJson('/api/branches')['data'][0]['id'];
        $inv  = $this->postInvoice($auth['token'], 10000); // بلا ترويسة فرع

        $this->assertSame($main, Invoice::find($inv['id'])->branch_id);
    }

    /** @test */
    public function a_branch_of_another_tenant_is_ignored_and_falls_back(): void
    {
        $a = $this->registerTenant('acme', 'owner@acme.test');
        $b = $this->registerTenant('globex', 'owner@globex.test');
        $branchB = $this->withToken($b['token'])->getJson('/api/branches')['data'][0]['id'];

        app(TenantContext::class)->set($a['tenant_id']);
        $mainA = $this->withToken($a['token'])->getJson('/api/branches')['data'][0]['id'];

        // المستأجر A يمرّر فرع B — يُتجاهَل ويتراجع لفرعه الرئيسي (لا تسرّب)
        $inv = $this->postInvoice($a['token'], 10000, $branchB);
        $this->assertSame($mainA, Invoice::find($inv['id'])->branch_id);
    }

    /** @test */
    public function reports_filter_by_branch_while_the_unfiltered_view_stays_consolidated(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main   = $this->withToken($auth['token'])->getJson('/api/branches')['data'][0]['id'];
        $khobar = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع الخبر'])['data']['id'];

        $this->postInvoice($auth['token'], 10000, $main);    // 100 + ضريبة
        $this->postInvoice($auth['token'], 20000, $khobar);  // 200 + ضريبة

        $revenue = function (?string $branch) use ($auth) {
            $q = $branch ? "?branch_id={$branch}" : '';
            return $this->withToken($auth['token'])->getJson("/api/reports/income-statement{$q}")['total_revenue'];
        };

        $this->assertSame('100.00', $revenue($main));    // فرع الرئيسي وحده
        $this->assertSame('200.00', $revenue($khobar));  // فرع الخبر وحده
        $this->assertSame('300.00', $revenue(null));     // المجمّع = كل الفروع
    }

    /** @test */
    public function the_consolidated_trial_balance_stays_balanced_across_branches(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $khobar = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع الخبر'])['data']['id'];
        $this->postInvoice($auth['token'], 10000);
        $this->postInvoice($auth['token'], 20000, $khobar);

        $tb = $this->withToken($auth['token'])->getJson('/api/reports/trial-balance')->assertOk();
        $this->assertTrue($tb['balanced']);
        $this->assertSame($tb['total_debit'], $tb['total_credit']);
    }

    /** @test */
    public function a_reversal_inherits_the_branch_so_the_branch_nets_to_zero(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $khobar = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع الخبر'])['data']['id'];
        $inv = $this->postInvoice($auth['token'], 10000, $khobar);

        $entry = JournalEntry::where('source_id', $inv['id'])->firstOrFail();
        app(\App\Services\Accounting\LedgerService::class)->reverse($entry, null, 'اختبار');

        // كل سطور الفرع (الأصل + العاكس) تتصفّر
        $lines = JournalLine::where('branch_id', $khobar)->get();
        $this->assertSame($lines->sum('debit'), $lines->sum('credit'));
        $this->assertGreaterThan(0, $lines->count());
    }

    /** @test */
    public function reports_accept_multiple_branches_and_sum_them(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main   = $this->withToken($auth['token'])->getJson('/api/branches')['data'][0]['id'];
        $khobar = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع الخبر'])['data']['id'];
        $jubail = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع الجبيل'])['data']['id'];

        $this->postInvoice($auth['token'], 10000, $main);   // 100
        $this->postInvoice($auth['token'], 20000, $khobar); // 200
        $this->postInvoice($auth['token'], 40000, $jubail); // 400

        // فرعان مختاران معاً = مجموعهما فقط (لا الثالث)
        $two = $this->withToken($auth['token'])
            ->getJson("/api/reports/income-statement?branch_id[]={$main}&branch_id[]={$khobar}");
        $this->assertSame('300.00', $two['total_revenue']);

        // الثلاثة = المجمّع نفسه
        $all = $this->withToken($auth['token'])
            ->getJson("/api/reports/income-statement?branch_id[]={$main}&branch_id[]={$khobar}&branch_id[]={$jubail}");
        $this->assertSame('700.00', $all['total_revenue']);
        $this->assertSame('700.00', $this->withToken($auth['token'])->getJson('/api/reports/income-statement')['total_revenue']);
    }

    /** @test */
    public function the_trial_balance_of_a_single_branch_is_balanced_on_its_own(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $khobar = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع الخبر'])['data']['id'];
        $this->postInvoice($auth['token'], 10000, $khobar);
        $this->postInvoice($auth['token'], 20000); // الفرع الرئيسي

        // كل فرع متوازن بذاته (البيع النقدي يقيّد طرفيه داخل الفرع نفسه)
        $tb = $this->withToken($auth['token'])->getJson("/api/reports/trial-balance?branch_id={$khobar}")->assertOk();
        $this->assertTrue($tb['balanced']);
        $this->assertSame($tb['total_debit'], $tb['total_credit']);
    }

    /**
     * والميزانية العمومية كذلك: كل سطور القيد الواحد تحمل الفرع نفسه، فدفتر
     * كل فرع مقفل على ذاته. هذا ما تُعلنه شارة «متوازن» في شاشة التقارير
     * حين تُصفّى بفرع — فالاختبار يحرس صدقها لا شكلها.
     *
     * @test
     */
    public function the_balance_sheet_of_a_single_branch_is_balanced_on_its_own(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main   = $this->withToken($auth['token'])->getJson('/api/branches')['data'][0]['id'];
        $khobar = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع الخبر'])['data']['id'];

        $this->postInvoice($auth['token'], 10000, $khobar);
        $this->postInvoice($auth['token'], 20000, $main);

        foreach ([$khobar, $main, null] as $branch) {
            $q  = $branch ? "?branch_id={$branch}" : '';
            $bs = $this->withToken($auth['token'])->getJson("/api/reports/balance-sheet{$q}")->assertOk();

            $this->assertTrue($bs['balanced'], 'الميزانية يجب أن تتوازن للفرع وللمجمّع.');
            $this->assertSame(
                (float) $bs['total_assets'],
                (float) $bs['total_liabilities'] + (float) $bs['total_equity_and_income'],
            );
        }
    }
}
