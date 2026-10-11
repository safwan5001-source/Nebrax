<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\Product;
use App\Models\ReturnDocument;
use App\Models\ReturnLine;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\ReturnService;
use App\Services\Reporting\ReturnVatDiscrepancyReport;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * AWJ-TAX-REM-01 — التقرير القرائي لمرتجعات تاريخية تخالف سطر مصدرها:
 * يعرض المخالف، يتجاهل الصحيح، لا يعبر المستأجرين، ولا يكتب شيئاً.
 *
 * تشغيل:  php artisan test --filter=ReturnVatDiscrepancyReportTest
 */
class ReturnVatDiscrepancyReportTest extends TestCase
{
    use RefreshDatabase;

    private function tenantWith(string $slug): array
    {
        $tenant = Tenant::create([
            'name' => $slug, 'slug' => $slug, 'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($tenant->id);
        $customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $product = Product::create(['name' => 'خدمة', 'track_inventory' => false]);

        return [$tenant, $customer, $product];
    }

    /** فاتورة 2 × 115.00 متضمّنة + مرتجعٌ تاريخي مخطئ (11500/1725) ثم مرتجعٌ صحيح بعده. */
    private function seedHistory(Partner $customer, Product $product): array
    {
        $svc = app(InvoiceService::class);
        $invoice = $svc->post($svc->create(
            ['partner_id' => $customer->id, 'payment_type' => 'credit', 'tax_inclusive' => true],
            [['product_id' => $product->id, 'quantity' => 2, 'unit_price' => 11500, 'tax_rate' => 15]]
        ));
        $line = $invoice->lines->first();

        $bad = ReturnDocument::create([
            'number' => 'SRET-HIST-1', 'type' => 'sales', 'partner_id' => $customer->id,
            'status' => 'posted', 'return_date' => '2026-01-10',
            'original_type' => Invoice::class, 'original_id' => $invoice->id,
            'subtotal' => 11500, 'tax_amount' => 1725, 'total' => 13225,
        ]);
        ReturnLine::create([
            'return_id' => $bad->id, 'product_id' => $product->id, 'source_line_id' => $line->id,
            'quantity' => 1, 'unit_price' => 11500, 'tax_rate' => 15,
            'line_subtotal' => 11500, 'line_discount' => 0, 'line_tax' => 1725, 'line_total' => 13225,
        ]);

        return [$invoice, $line, $bad];
    }

    /** @test */
    public function it_lists_a_historical_over_reversal_and_ignores_correct_returns(): void
    {
        [, $customer, $product] = $this->tenantWith('a');
        [$invoice, $line, $bad] = $this->seedHistory($customer, $product);

        // مرتجع صحيح على سطر منفصل (فاتورة ثانية) — لا يجب أن يظهر.
        $svc = app(InvoiceService::class);
        $clean = $svc->post($svc->create(
            ['partner_id' => $customer->id, 'payment_type' => 'credit', 'tax_inclusive' => true],
            [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 11500, 'tax_rate' => 15]]
        ));
        $ret = app(ReturnService::class)->create(
            ['type' => 'sales', 'partner_id' => $customer->id, 'payment_type' => 'credit', 'original_id' => $clean->id],
            [['product_id' => $product->id, 'source_line_id' => $clean->lines->first()->id, 'quantity' => 1, 'unit_price' => 11500]]
        );
        app(ReturnService::class)->post($ret);

        // مرتجعٌ صحيح لاحق على الفاتورة التاريخية نفسها: يقيّده المرحَّل الزائد
        // قبله (8500/1275)، فلا يجوز أن يُبلَّغ هو الآخر فرقاً.
        $later = app(ReturnService::class)->create(
            ['type' => 'sales', 'partner_id' => $customer->id, 'payment_type' => 'credit', 'original_id' => $invoice->id, 'return_date' => '2026-02-01'],
            [['product_id' => $product->id, 'source_line_id' => $line->id, 'quantity' => 1, 'unit_price' => 11500]]
        );
        $later = app(ReturnService::class)->post($later);
        $this->assertSame([8500, 1275], [(int) $later->subtotal, (int) $later->tax_amount]);

        $rows = app(ReturnVatDiscrepancyReport::class)->forCurrentTenant();

        $this->assertCount(1, $rows, 'المرتجع التاريخي وحده — لا اللاحق المقيَّد به.');
        $this->assertSame('SRET-HIST-1', $rows[0]['return_number']);
        $this->assertSame(1725, $rows[0]['recorded_tax']);
        $this->assertSame(1500, $rows[0]['expected_tax']);
        $this->assertSame(225, $rows[0]['tax_delta']);
        // الإجمالي المرحَّل 13225 مقابل 11500 متوقَّع.
        $this->assertSame(1725, $rows[0]['total_delta']);
    }

    /** @test */
    public function it_is_read_only_and_never_crosses_tenants(): void
    {
        [$tenantA, $customerA, $productA] = $this->tenantWith('a');
        $this->seedHistory($customerA, $productA);
        [$tenantB, $customerB, $productB] = $this->tenantWith('b');
        $this->seedHistory($customerB, $productB);

        $returnsBefore = ReturnDocument::withoutGlobalScopes()->count();
        $entriesBefore = JournalEntry::withoutGlobalScopes()->count();

        $this->artisan('returns:vat-discrepancies', ['--tenant' => $tenantA->id, '--json' => true])
            ->expectsOutputToContain('SRET-HIST-1')
            ->assertSuccessful();

        app(TenantContext::class)->set($tenantA->id);
        $rowsA = app(ReturnVatDiscrepancyReport::class)->forCurrentTenant();
        app(TenantContext::class)->set($tenantB->id);
        $rowsB = app(ReturnVatDiscrepancyReport::class)->forCurrentTenant();

        $this->assertCount(1, $rowsA);
        $this->assertCount(1, $rowsB);
        $this->assertNotSame($rowsA[0]['return_id'], $rowsB[0]['return_id']);

        $this->assertSame($returnsBefore, ReturnDocument::withoutGlobalScopes()->count());
        $this->assertSame($entriesBefore, JournalEntry::withoutGlobalScopes()->count());
    }

    /** @test */
    public function the_command_requires_an_exact_tenant(): void
    {
        $this->artisan('returns:vat-discrepancies')->assertExitCode(2);
        $this->artisan('returns:vat-discrepancies', ['--tenant' => 'not-a-uuid'])->assertExitCode(2);
        $this->artisan('returns:vat-discrepancies', ['--tenant' => '00000000-0000-4000-8000-000000000000'])->assertFailed();
    }
}
