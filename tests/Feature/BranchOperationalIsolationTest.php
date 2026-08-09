<?php

namespace Tests\Feature;

use App\Models\Appointment;
use App\Models\Invoice;
use App\Models\RecurringInvoice;
use App\Tenancy\BranchContext;
use App\Tenancy\BranchScope;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  P3-أ — العزل التشغيلي بالفرع للسجلات غير المحاسبية
 * ═══════════════════════════════════════════════════════════════
 *  المواعيد · جهات الاتصال · أنشطة CRM · الفواتير الدورية.
 *
 *  ثلاث ضمانات يجب أن تبقى صحيحة معاً:
 *   1. فرعٌ لا يرى سجلات فرع آخر (العزل يعمل فعلاً).
 *   2. سجلات ما قبل الفروع (`branch_id IS NULL`) تبقى مرئية للجميع.
 *   3. التجاوز المتعمَّد (`withoutGlobalScope`) يُعيد كل الفروع للتقارير المجمّعة.
 *
 *  تشغيل: php artisan test --filter=BranchOperationalIsolationTest
 */
class BranchOperationalIsolationTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** ينشئ فرعاً جديداً ويُعيد معرّفه. */
    private function branch(string $token, string $name): string
    {
        return $this->withToken($token)->postJson('/api/branches', ['name' => $name])
            ->assertCreated()['data']['id'];
    }

    private function mainBranch(string $token): string
    {
        return $this->withToken($token)->getJson('/api/branches')['data'][0]['id'];
    }

    /** @test */
    public function operational_records_are_stamped_with_the_active_branch(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $khobar = $this->branch($auth['token'], 'فرع الخبر');

        $id = $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $khobar])
            ->postJson('/api/appointments', [
                'title' => 'موعد الخبر', 'appointment_at' => '2026-07-01 10:00:00',
            ])->assertCreated()['data']['id'];

        $this->assertSame(
            $khobar,
            Appointment::withoutGlobalScope(BranchScope::class)->find($id)->branch_id
        );
    }

    /**
     * الضمان الأول — العزل الفعلي عبر الوحدات الأربع.
     *
     * @test
     *
     * @dataProvider operationalEndpoints
     */
    public function a_branch_never_sees_another_branch_records(string $endpoint, array $payload): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main   = $this->mainBranch($auth['token']);
        $khobar = $this->branch($auth['token'], 'فرع الخبر');

        // الفواتير الدورية تحتاج عميلاً — والعميل مشترك (لم يُعزل بعد في P3-ج).
        if ($endpoint === 'recurring-invoices') {
            $payload['partner_id'] = $this->withToken($auth['token'])
                ->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])['data']['id'];
        }

        $khobarId = $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $khobar])
            ->postJson("/api/{$endpoint}", $payload)->assertCreated()['data']['id'];

        // من الفرع الرئيسي: لا يظهر في القائمة ولا يُفتح بمعرّفه
        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])
            ->getJson("/api/{$endpoint}")->assertOk()->assertJsonCount(0, 'data');

        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])
            ->getJson("/api/{$endpoint}/{$khobarId}")->assertNotFound();

        // ومن فرعه: يظهر طبيعياً
        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $khobar])
            ->getJson("/api/{$endpoint}")->assertOk()->assertJsonCount(1, 'data');
    }

    public static function operationalEndpoints(): array
    {
        return [
            'appointments' => ['appointments', [
                'title' => 'موعد', 'appointment_at' => '2026-07-01 10:00:00',
            ]],
            'contacts' => ['contacts', ['name' => 'جهة اتصال']],
            'crm-activities' => ['crm-activities', [
                'subject' => 'مكالمة', 'type' => 'call', 'activity_at' => '2026-07-01 10:00:00',
            ]],
            'recurring-invoices' => ['recurring-invoices', [
                'frequency' => 'monthly', 'start_date' => '2026-06-01',
                'items' => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
            ]],
        ];
    }

    /**
     * الضمان الثاني — بيانات ما قبل الفروع (branch_id = null) تبقى مشتركة.
     *
     * @test
     */
    public function legacy_records_without_a_branch_stay_visible_to_everyone(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main   = $this->mainBranch($auth['token']);
        $khobar = $this->branch($auth['token'], 'فرع الخبر');

        // محاكاة صفٍّ منشأ قبل الفروع: بلا سياق فرع فلا يوسمه BelongsToBranch
        app(BranchContext::class)->forget();
        $legacy = Appointment::create([
            'tenant_id'      => $auth['tenant_id'],
            'title'          => 'موعد قديم',
            'appointment_at' => '2026-07-01 10:00:00',
        ]);
        $this->assertNull($legacy->branch_id);

        foreach ([$main, $khobar] as $branchId) {
            $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $branchId])
                ->getJson('/api/appointments')->assertOk()->assertJsonCount(1, 'data');
        }
    }

    /**
     * الضمان الثالث — التجاوز المتعمَّد يُعيد كل الفروع (للتقارير المجمّعة).
     *
     * @test
     */
    public function the_scope_can_be_bypassed_deliberately_for_a_consolidated_view(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main   = $this->mainBranch($auth['token']);
        $khobar = $this->branch($auth['token'], 'فرع الخبر');

        foreach ([$main, $khobar] as $branchId) {
            $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $branchId])
                ->postJson('/api/appointments', [
                    'title' => 'موعد', 'appointment_at' => '2026-07-01 10:00:00',
                ])->assertCreated();
        }

        $this->assertSame(2, Appointment::withoutGlobalScope(BranchScope::class)->count());
    }

    /**
     * التوليد من قالب دوري يرث فرع القالب — لا الفرع النشط وقت التشغيل.
     * حاسم للمهام المجدولة: تعمل بلا سياق فرع، فلولا التوريث لخرجت الفاتورة بلا فرع.
     *
     * @test
     */
    public function a_generated_invoice_inherits_the_template_branch(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $khobar = $this->branch($auth['token'], 'فرع الخبر');
        $partner = $this->withToken($auth['token'])
            ->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])['data']['id'];

        $recId = $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $khobar])
            ->postJson('/api/recurring-invoices', [
                'partner_id' => $partner,
                'frequency'  => 'monthly',
                'start_date' => '2026-06-01',
                'items'      => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
            ])->assertCreated()['data']['id'];

        // التوليد يجري بلا سياق فرع (كمهمّة مجدولة)
        app(BranchContext::class)->forget();
        $rec = RecurringInvoice::withoutGlobalScope(BranchScope::class)->findOrFail($recId);
        $invoice = app(\App\Services\Accounting\RecurringInvoiceService::class)->generate($rec);

        $this->assertSame($khobar, Invoice::find($invoice->id)->branch_id);
    }
}
