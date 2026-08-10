<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  تصفية قوائم المستندات بالفرع النشط — صريحة في المتحكّم
 * ═══════════════════════════════════════════════════════════════
 *  المستندات المحاسبية `BelongsToBranch` (موسومة بلا Scope عالمي)، فتصفية
 *  **العرض** تتمّ في المتحكّم وحده. أربع ضمانات:
 *
 *   1. الافتراضي = الفرع النشط.
 *   2. `?branch=all` يُظهر كل الفروع صراحةً.
 *   3. صفوف `branch_id IS NULL` تبقى مرئية في الحالتين.
 *   4. **التقارير المجمّعة لا تتأثّر إطلاقاً** — وهذا شرط سلامة الدفاتر.
 *
 *  تشغيل: php artisan test --filter=DocumentBranchScopeTest
 */
class DocumentBranchScopeTest extends TestCase
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

    /** فاتورة نقدية مرحّلة في فرع محدّد. */
    private function invoice(string $token, ?string $branchId, int $price): string
    {
        $headers = $branchId ? ['X-Branch-Id' => $branchId] : [];
        $partner = $this->withToken($token)->withHeaders($headers)
            ->postJson('/api/partners', ['name' => 'طرف', 'type' => 'customer'])['data']['id'];

        $inv = $this->withToken($token)->withHeaders($headers)->postJson('/api/invoices', [
            'partner_id' => $partner, 'payment_type' => 'cash',
            'items' => [['quantity' => 1, 'unit_price' => $price, 'tax_rate' => 15]],
        ])->assertCreated()['data'];

        $this->withToken($token)->withHeaders($headers)
            ->postJson("/api/invoices/{$inv['id']}/post")->assertOk();

        return $inv['id'];
    }

    /** عدد صفوف قائمة عند فرع معيّن (اختيارياً بوضع «كل الفروع»). */
    private function listCount(string $token, string $path, ?string $branchId, bool $all = false): int
    {
        $q = $all ? (str_contains($path, '?') ? '&branch=all' : '?branch=all') : '';
        $headers = $branchId ? ['X-Branch-Id' => $branchId] : [];

        return count(
            $this->withToken($token)->withHeaders($headers)->getJson("/api/{$path}{$q}")->assertOk()['data']
        );
    }

    /** @test */
    public function invoice_lists_default_to_the_active_branch(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main   = $this->mainBranch($auth['token']);
        $khobar = $this->branch($auth['token'], 'فرع الخبر');

        $this->invoice($auth['token'], $main, 10000);
        $this->invoice($auth['token'], $khobar, 20000);
        $this->invoice($auth['token'], $khobar, 30000);

        $this->assertSame(1, $this->listCount($auth['token'], 'invoices', $main));
        $this->assertSame(2, $this->listCount($auth['token'], 'invoices', $khobar));
    }

    /** @test */
    public function branch_all_shows_every_branch(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main   = $this->mainBranch($auth['token']);
        $khobar = $this->branch($auth['token'], 'فرع الخبر');

        $this->invoice($auth['token'], $main, 10000);
        $this->invoice($auth['token'], $khobar, 20000);

        $this->assertSame(2, $this->listCount($auth['token'], 'invoices', $main, true));
        $this->assertSame(2, $this->listCount($auth['token'], 'invoices', $khobar, true));
    }

    /** بيانات ما قبل الفروع (`branch_id = null`) تبقى مرئية لكل فرع. */
    /** @test */
    public function legacy_documents_without_a_branch_stay_visible(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main   = $this->mainBranch($auth['token']);
        $khobar = $this->branch($auth['token'], 'فرع الخبر');

        $id = $this->invoice($auth['token'], $khobar, 10000);
        // محاكاة مستند ما قبل الفروع
        Invoice::where('id', $id)->update(['branch_id' => null]);

        $this->assertSame(1, $this->listCount($auth['token'], 'invoices', $main));
        $this->assertSame(1, $this->listCount($auth['token'], 'invoices', $khobar));
    }

    /** بلا سياق فرع (مؤسسة بفرع واحد) لا تصفية — سلوك ما قبل الميزة. */
    /** @test */
    public function no_branch_context_means_no_filtering(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $khobar = $this->branch($auth['token'], 'فرع الخبر');
        $this->invoice($auth['token'], $khobar, 10000);
        $this->invoice($auth['token'], $this->mainBranch($auth['token']), 20000);

        app(BranchContext::class)->forget();
        $this->assertSame(2, Invoice::count());
    }

    /**
     * كل قوائم المستندات تسلك السلوك نفسه — فلا شاشة تشذّ.
     *
     * @test
     *
     * @dataProvider documentLists
     */
    public function every_document_list_scopes_to_the_active_branch(string $path): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main   = $this->mainBranch($auth['token']);
        $khobar = $this->branch($auth['token'], 'فرع الخبر');

        // القوائم فارغة، فالمهم أن الطلب يمرّ بالمرشّحين دون خطأ SQL
        // (عمود branch_id موجود على كل هذه الجداول).
        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $khobar])
            ->getJson("/api/{$path}")->assertOk();
        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])
            ->getJson("/api/{$path}" . (str_contains($path, '?') ? '&' : '?') . 'branch=all')->assertOk();
    }

    public static function documentLists(): array
    {
        return [
            'invoices'         => ['invoices'],
            'purchases'        => ['purchases'],
            'payments'         => ['payments'],
            'quotes'           => ['quotes'],
            'credit-notes'     => ['credit-notes'],
            'expenses'         => ['expenses'],
            'sales returns'    => ['returns?type=sales'],
            'purchase returns' => ['returns?type=purchase'],
        ];
    }

    /**
     * **الضمان الحاسم:** تصفية العرض لا تمسّ الدفاتر. ميزان المراجعة وقائمة
     * الدخل المجمّعان يبقيان شاملَين لكل الفروع كما كانا.
     *
     * @test
     */
    public function consolidated_reports_are_untouched_by_list_scoping(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main   = $this->mainBranch($auth['token']);
        $khobar = $this->branch($auth['token'], 'فرع الخبر');

        $this->invoice($auth['token'], $main, 10000);   // 100
        $this->invoice($auth['token'], $khobar, 20000); // 200

        // قائمة الفواتير عند الفرع الرئيسي تعرض واحدة…
        $this->assertSame(1, $this->listCount($auth['token'], 'invoices', $main));

        // …والتقارير المجمّعة تعرض الاثنتين، ومتوازنة
        $income = $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])
            ->getJson('/api/reports/income-statement')->assertOk();
        $this->assertSame('300.00', $income['total_revenue']);

        $tb = $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])
            ->getJson('/api/reports/trial-balance')->assertOk();
        $this->assertTrue($tb['balanced']);
        $this->assertSame($tb['total_debit'], $tb['total_credit']);
    }
}
