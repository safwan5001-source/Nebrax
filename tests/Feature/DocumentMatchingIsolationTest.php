<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Partner;
use App\Models\Product;
use App\Services\DocumentCenter\DocumentCounterpartyMatcher;
use App\Services\DocumentCenter\DocumentProductMatcher;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DocumentMatchingIsolationTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function documentMatchingNeverReturnsCounterpartyOrProductCandidatesFromAnotherTenant(): void
    {
        $tenantA = $this->registerTenant('matching-tenant-a', 'matching-a@test.local');
        $branchA = Branch::query()->where('tenant_id', $tenantA['tenant_id'])->value('id');
        app(TenantContext::class)->set($tenantA['tenant_id']);
        app(BranchContext::class)->set($branchA);
        $partnerA = Partner::create(['type' => 'supplier', 'name' => 'مورد أ', 'vat_number' => '310000000000003', 'is_active' => true]);
        $productA = Product::create(['name' => 'صنف أ', 'sku' => 'A-SKU', 'barcode' => 'A-BARCODE', 'unit' => 'piece', 'is_active' => true]);

        $tenantB = $this->registerTenant('matching-tenant-b', 'matching-b@test.local');
        $branchB = Branch::query()->where('tenant_id', $tenantB['tenant_id'])->value('id');
        app(TenantContext::class)->set($tenantB['tenant_id']);
        app(BranchContext::class)->set($branchB);
        $partnerB = Partner::create(['type' => 'supplier', 'name' => 'مورد ب', 'vat_number' => '310000000000003', 'is_active' => true]);
        $productB = Product::create(['name' => 'صنف ب', 'sku' => 'B-SKU', 'barcode' => 'A-BARCODE', 'unit' => 'box', 'is_active' => true]);

        app(TenantContext::class)->set($tenantA['tenant_id']);
        app(BranchContext::class)->set($branchA);
        $partners = app(DocumentCounterpartyMatcher::class)->candidates(['issuer_tax_number' => '310000000000003'], 'purchase_invoice');
        $products = app(DocumentProductMatcher::class)->candidates(['barcode' => 'A-BARCODE']);

        $this->assertSame([$partnerA->id], array_column($partners, 'candidate_id'));
        $this->assertSame([$productA->id], array_column($products, 'candidate_id'));
        $this->assertNotContains($partnerB->id, array_column($partners, 'candidate_id'));
        $this->assertNotContains($productB->id, array_column($products, 'candidate_id'));
    }
}
