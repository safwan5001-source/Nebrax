<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\LedgerService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات النواة المالية — تثبت أن المحرك يعمل فعلاً.
 * تشغيل:  php artisan test
 */
class LedgerTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected LedgerService $ledger;

    protected function setUp(): void
    {
        parent::setUp();

        // إنشاء مستأجر وضبط السياق
        $this->tenant = Tenant::create([
            'name' => 'نبراس الطموح',
            'slug' => 'nibras',
            'vat_number' => '300000000000003',
            'currency' => 'SAR',
        ]);

        app(TenantContext::class)->set($this->tenant->id);

        // إنشاء دليل الحسابات
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);

        $this->ledger = app(LedgerService::class);
    }

    /** @test */
    public function it_posts_a_balanced_entry(): void
    {
        $cash  = Account::where('code', '1110')->first();
        $sales = Account::where('code', '4110')->first();
        $vat   = Account::where('code', '2120')->first();

        // فاتورة نقدية 1000 + 15% = 1150 ريال
        $entry = $this->ledger->post([
            ['account_id' => $cash->id,  'debit'  => 115000],
            ['account_id' => $sales->id, 'credit' => 100000],
            ['account_id' => $vat->id,   'credit' => 15000],
        ], ['description' => 'فاتورة نقدية']);

        $this->assertEquals('posted', $entry->status);
        $this->assertCount(3, $entry->lines);

        // الأرصدة تحدّثت صح
        $cash->load('balance');
        $this->assertEquals(115000, $cash->balance->balance); // أصل مدين = +1150
    }

    /** @test */
    public function it_rejects_unbalanced_entry(): void
    {
        $cash  = Account::where('code', '1110')->first();
        $sales = Account::where('code', '4110')->first();

        $this->expectExceptionMessage('غير متوازن');

        $this->ledger->post([
            ['account_id' => $cash->id,  'debit'  => 100000],
            ['account_id' => $sales->id, 'credit' => 90000], // ناقص 100 ريال
        ]);
    }

    /** @test */
    public function it_rejects_posting_to_group_account(): void
    {
        $assetsGroup = Account::where('code', '1')->first(); // تجميعي
        $sales       = Account::where('code', '4110')->first();

        $this->expectExceptionMessage('تجميعي');

        $this->ledger->post([
            ['account_id' => $assetsGroup->id, 'debit'  => 100000],
            ['account_id' => $sales->id,       'credit' => 100000],
        ]);
    }

    /** @test */
    public function it_reverses_an_entry(): void
    {
        $cash  = Account::where('code', '1110')->first();
        $sales = Account::where('code', '4110')->first();

        $entry = $this->ledger->post([
            ['account_id' => $cash->id,  'debit'  => 100000],
            ['account_id' => $sales->id, 'credit' => 100000],
        ]);

        $reversal = $this->ledger->reverse($entry);

        $this->assertEquals('reversed', $entry->fresh()->status);
        $this->assertNotNull($reversal->reversal_of);

        // الرصيد عاد صفراً بعد العكس
        $cash->load('balance');
        $this->assertEquals(0, $cash->balance->balance);
    }

    /** @test */
    public function tenants_are_isolated(): void
    {
        // المستأجر الأول لديه حساباته
        $countA = Account::count();
        $this->assertGreaterThan(0, $countA);

        // مستأجر ثانٍ
        $tenantB = Tenant::create(['name' => 'شركة ثانية', 'slug' => 'other']);
        app(TenantContext::class)->set($tenantB->id);

        // لا يرى أي حساب من المستأجر الأول
        $this->assertEquals(0, Account::count());
    }
}
