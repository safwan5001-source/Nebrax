<?php

namespace Tests\Feature;

use App\Models\FiscalYear;
use App\Models\InventoryOpening;
use App\Models\JournalEntry;
use App\Models\Product;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\Warehouse;
use App\Services\Accounting\AccountingPeriodLockedException;
use App\Services\Accounting\AccountingPeriodLockService;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\FiscalYearClosedException;
use App\Services\Accounting\InventoryOpeningService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * IMP-H1-S6 — الرصيد الافتتاحي بقيمة صفر يحترم الفترات المقفلة والسنة المالية المقفلة.
 *
 * `buildEntry` يعيد `null` لمستندٍ كلّه بتكلفة صفر فلا يبلغ `LedgerService::post` (موضع `AccountingDateGuard`)، فكانت الحركات تُؤرَّخ داخل
 * فترةٍ مقفلة. الإصلاح يطبّق **القاعدة القائمة نفسها** (ACC-6 قفل الفترة، FC-3 السنة المقفلة) ولا يغيّرها.
 */
class InventoryOpeningZeroValueDateGuardTest extends TestCase
{
    use RefreshDatabase;

    private InventoryOpeningService $openings;

    protected function setUp(): void
    {
        parent::setUp();

        $tenant = Tenant::create(['name' => 'نبراس الطموح', 'slug' => 'nibras', 'vat_number' => '300000000000003', 'currency' => 'SAR']);
        app(TenantContext::class)->set($tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($tenant->id);
        $this->openings = app(InventoryOpeningService::class);
    }

    private function draft(string $date, int $unitCost = 0, string $sku = 'ZV-1'): InventoryOpening
    {
        $product = Product::create(['name' => "صنف {$sku}", 'sku' => $sku, 'type' => 'good', 'sale_price' => 20000, 'purchase_price' => 0, 'track_inventory' => true]);
        $warehouse = Warehouse::create(['name' => 'مخزن', 'code' => 'WH-'.$sku, 'branch_id' => null]);

        return $this->openings->createDraft(
            ['opening_date' => $date, 'allow_zero_cost' => true],
            [['product_id' => $product->id, 'warehouse_id' => $warehouse->id, 'quantity' => 10, 'unit_cost' => $unitCost]]
        );
    }

    private function assertNothingWritten(InventoryOpening $draft): void
    {
        $this->assertSame(0, StockMovement::count(), 'تراجعت الحركات مع المعاملة.');
        $this->assertSame(0, JournalEntry::count());
        $fresh = InventoryOpening::findOrFail($draft->id);
        $this->assertTrue($fresh->isDraft(), 'المسودة باقية قابلة للترحيل بتاريخ مفتوح.');
    }

    /** @test */
    public function a_zero_value_document_in_a_locked_period_is_refused_and_writes_nothing(): void
    {
        app(AccountingPeriodLockService::class)->create('2026-01-01', '2026-01-31', 'إقفال يناير', null);
        $draft = $this->draft('2026-01-15');

        try {
            $this->openings->post($draft);
            $this->fail('كان يجب رفض الترحيل داخل فترة مقفلة.');
        } catch (AccountingPeriodLockedException $e) {
            $this->assertStringContainsString('2026-01-15', $e->getMessage());
        }

        $this->assertNothingWritten($draft);
    }

    /** @test */
    public function a_zero_value_document_inside_a_closed_fiscal_year_is_refused_and_writes_nothing(): void
    {
        FiscalYear::create(['name' => '2025', 'start_date' => '2025-01-01', 'end_date' => '2025-12-31', 'status' => FiscalYear::STATUS_CLOSED]);
        $draft = $this->draft('2025-06-30');

        $this->expectException(FiscalYearClosedException::class);
        try {
            $this->openings->post($draft);
        } finally {
            $this->assertNothingWritten($draft);
        }
    }

    /** @test */
    public function an_open_date_still_posts_a_zero_value_document_without_a_journal_entry(): void
    {
        app(AccountingPeriodLockService::class)->create('2026-01-01', '2026-01-31', 'إقفال يناير', null);
        $posted = $this->openings->post($this->draft('2026-02-10'));

        $this->assertSame(1, StockMovement::count());
        $this->assertSame(0, JournalEntry::count(), 'السلوك القائم: لا قيد لمستندٍ بقيمة صفر.');
        $this->assertNull($posted->journal_entry_id);
    }

    /** @test */
    public function a_valued_document_in_a_locked_period_is_refused_exactly_as_before(): void
    {
        app(AccountingPeriodLockService::class)->create('2026-01-01', '2026-01-31', 'إقفال يناير', null);
        $draft = $this->draft('2026-01-15', 1000, 'ZV-2');

        $this->expectException(AccountingPeriodLockedException::class);
        try {
            $this->openings->post($draft);
        } finally {
            $this->assertNothingWritten($draft);
        }
    }
}
