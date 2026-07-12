<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\CostCenter;
use App\Models\Partner;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\LedgerService;
use App\Services\Reporting\ReportService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات تثبّت إصلاحات المراجعة الشاملة:
 * التقارير بعد العكس، حراسة دور المالك، ذرّية الرصيد الافتتاحي، وعزل مراجع المستندات.
 * تشغيل:  php artisan test --filter=ReviewFixesTest
 */
class ReviewFixesTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function reports_stay_correct_after_a_reversal(): void
    {
        $tenant = Tenant::create(['name' => 'نبراس', 'slug' => 'nibras', 'currency' => 'SAR']);
        app(TenantContext::class)->set($tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($tenant->id);

        $cash  = Account::where('code', '1110')->first();
        $sales = Account::where('code', '4110')->first();

        $ledger = app(LedgerService::class);
        $entry = $ledger->post([
            ['account_id' => $cash->id, 'debit' => 115000],
            ['account_id' => $sales->id, 'credit' => 115000],
        ], ['entry_date' => now()->toDateString(), 'description' => 'بيع نقدي']);

        $ledger->reverse($entry);

        // بعد العكس: الأصل + العاكس = صفر، فيختفي الحسابان من ميزان المراجعة كلياً.
        // (قبل الإصلاح: كان الأصل يُستبعد لأن حالته reversed فيظهر العاكس وحده —
        //  نقدية دائنة 115000 وإيراد مدين 115000 — أرقام مقلوبة في كل التقارير.)
        $tb = app(ReportService::class)->trialBalance();
        $this->assertSame([], $tb['rows'], 'كل الحسابات يجب أن تتصفّر بعد العكس');
        $this->assertSame(0, $tb['total_debit']);
        $this->assertSame(0, $tb['total_credit']);
    }

    /** @test */
    public function an_admin_cannot_create_or_promote_an_owner(): void
    {
        $reg = $this->registerTenant();
        $adminToken = $this->tokenForRole($reg['tenant_id'], 'admin', 'admin@acme.test');

        // إنشاء مالك جديد من admin → 403
        $this->withToken($adminToken)->postJson('/api/users', [
            'name' => 'دخيل', 'email' => 'x@acme.test', 'password' => 'password123', 'role' => 'owner',
        ])->assertForbidden();

        // ترقية النفس إلى مالك → 403
        $selfId = $this->withToken($adminToken)->getJson('/api/me')['user']['id'];
        $this->withToken($adminToken)->putJson("/api/users/{$selfId}", ['role' => 'owner'])
            ->assertForbidden();
    }

    /** @test */
    public function a_failed_opening_balance_rolls_back_the_partner(): void
    {
        $reg = $this->registerTenant();
        $token = $this->withToken($this->tokenForRole($reg['tenant_id'], 'admin', 'acc@acme.test'));

        // تعطيل حساب الأرصدة الافتتاحية 3130 يجعل قيد الافتتاح يفشل
        app(TenantContext::class)->set($reg['tenant_id']);
        Account::where('code', '3130')->update(['is_active' => false]);

        $token->postJson('/api/partners', [
            'name' => 'عميل', 'type' => 'customer', 'opening_balance' => 50000,
        ])->assertStatus(422);

        // الذرّية: لا طرف يتيم بلا قيده
        $this->assertSame(0, Partner::count());
    }

    /** @test */
    public function a_cross_tenant_cost_center_is_rejected_on_invoices(): void
    {
        $regA = $this->registerTenant('alpha', 'owner@alpha.test');
        $regB = $this->registerTenant('beta', 'owner@beta.test');

        // مركز تكلفة لدى B
        app(TenantContext::class)->set($regB['tenant_id']);
        $foreignCenter = CostCenter::create(['code' => 'CC-B', 'name' => 'فرع بعيد']);

        // عميل لدى A
        app(TenantContext::class)->set($regA['tenant_id']);
        $customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $tokenA = $this->tokenForRole($regA['tenant_id'], 'admin', 'acc@alpha.test');

        $this->withToken($tokenA)->postJson('/api/invoices', [
            'partner_id' => $customer->id,
            'payment_type' => 'cash',
            'cost_center_id' => $foreignCenter->id, // معرّف مستأجر آخر
            'items' => [['quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertStatus(422);
    }
}
