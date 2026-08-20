<?php

namespace Tests\Feature;

use App\Models\DocumentRevision;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\PaymentAllocation;
use App\Models\Product;
use App\Models\Purchase;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\PurchaseRelationsService;
use App\Services\Accounting\PurchaseService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PurchaseDetailRelationsTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private Tenant $tenant;
    private Partner $supplier;
    private PurchaseService $purchases;
    private string $token;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'مؤسسة علاقات الشراء',
            'slug' => 'purchase-detail-relations',
            'vat_number' => '300000000000049',
            'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);

        $this->supplier = Partner::create(['name' => 'مورد العلاقات', 'type' => 'supplier']);
        $this->purchases = app(PurchaseService::class);
        $this->token = $this->tokenForRole($this->tenant->id, 'owner', 'owner@purchase-detail.test');
    }

    /** @test */
    public function purchase_detail_relations_keep_allocation_entry_and_stock_source_truthful(): void
    {
        $product = Product::create([
            'name' => 'صنف استلام',
            'sale_price' => 10000,
            'track_inventory' => true,
        ]);
        $purchase = $this->purchases->create(
            ['partner_id' => $this->supplier->id, 'payment_type' => 'credit'],
            [['product_id' => $product->id, 'quantity' => 2, 'unit_price' => 10000, 'tax_rate' => 15]],
        );
        $purchase = $this->purchases->post($purchase);

        $payment = Payment::create([
            'number' => 'PV-DETAIL-0001',
            'partner_id' => $this->supplier->id,
            'direction' => 'paid',
            'method' => 'cash',
            'payment_date' => '2026-08-20',
            'amount' => 11500,
            'status' => 'posted',
        ]);
        PaymentAllocation::create([
            'payment_id' => $payment->id,
            'allocatable_type' => Purchase::class,
            'allocatable_id' => $purchase->id,
            'amount' => 11500,
        ]);

        $relations = app(PurchaseRelationsService::class);
        $payments = $relations->payments($purchase, Payment::query());
        $accounting = $relations->accountingLinks($purchase);

        $this->assertCount(1, $payments);
        $this->assertSame($payment->id, $payments->first()['id']);
        $this->assertSame('115.00', $payments->first()['amount']);
        $this->assertSame('115.00', $payments->first()['allocated_amount']);
        $this->assertNotNull($accounting['purchase_entry']);
        $this->assertSame($purchase->journal_entry_id, $accounting['purchase_entry']['id']);
        $this->assertTrue(StockMovement::where('source_type', Purchase::class)->where('source_id', $purchase->id)->exists());
    }

    /** @test */
    public function purchase_relation_endpoints_return_the_read_only_detail_contract(): void
    {
        $product = Product::create([
            'name' => 'صنف واجهة الشراء',
            'sale_price' => 10000,
            'track_inventory' => true,
        ]);
        $purchase = $this->purchases->create(
            ['partner_id' => $this->supplier->id, 'payment_type' => 'credit'],
            [['product_id' => $product->id, 'quantity' => 2, 'unit_price' => 10000, 'tax_rate' => 15]],
        );
        $purchase = $this->purchases->post($purchase);

        $this->withToken($this->token)->getJson("/api/purchases/{$purchase->id}/payments")
            ->assertOk()
            ->assertJsonCount(0, 'data');
        $this->withToken($this->token)->getJson("/api/purchases/{$purchase->id}/accounting")
            ->assertOk()
            ->assertJsonPath('data.purchase_entry.id', $purchase->journal_entry_id)
            ->assertJsonPath('data.purchase_entry.status', 'posted');
        $this->withToken($this->token)->getJson("/api/purchases/{$purchase->id}/inventory")
            ->assertOk()
            ->assertJsonPath('data.0.type', 'in')
            ->assertJsonPath('data.0.product.id', $product->id);
        $this->withToken($this->token)->getJson("/api/purchases/{$purchase->id}")
            ->assertOk()
            ->assertJsonStructure(['data' => ['branch_id']]);
    }

    /** @test */
    public function purchase_records_a_revision_under_the_purchase_type(): void
    {
        $purchase = $this->purchases->create(
            ['partner_id' => $this->supplier->id, 'payment_type' => 'credit'],
            [['quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        );

        $revision = DocumentRevision::where('document_type', Purchase::class)
            ->where('document_id', $purchase->id)
            ->first();

        $this->assertSame('purchase', DocumentRevision::typeKey(Purchase::class));
        $this->assertNotNull($revision);
        $this->assertSame('created', $revision->action);
    }
}
