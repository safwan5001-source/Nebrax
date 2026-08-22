<?php

namespace Tests\Feature;

use App\Models\CreditNote;
use App\Models\Partner;
use App\Models\Purchase;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ملكية الإشعار من مصدره: لا يملك العميل تخفيض حارس شراء إلى مبيعات عبر type.
 * تشغيل: php artisan test --filter=CreditNoteSourceOwnershipTest
 */
class CreditNoteSourceOwnershipTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function supplier(string $token, string $name = 'مورد مصدر'): string
    {
        return $this->withToken($token)->postJson('/api/partners', [
            'name' => $name,
            'type' => 'supplier',
        ])->assertCreated()['data']['id'];
    }

    private function customer(string $token, string $name = 'عميل مصدر'): string
    {
        return $this->withToken($token)->postJson('/api/partners', [
            'name' => $name,
            'type' => 'customer',
        ])->assertCreated()['data']['id'];
    }

    private function purchaseSource(string $token, string $suffix = '1'): array
    {
        $supplierId = $this->supplier($token, "مورد شراء {$suffix}");
        $productId = $this->withToken($token)->postJson('/api/products', [
            'name' => "صنف شراء {$suffix}",
            'sku' => "CN-SRC-P-{$suffix}",
            'type' => 'good',
            'sale_price' => 20000,
            'purchase_price' => 10000,
        ])->assertCreated()['data']['id'];

        return $this->withToken($token)->postJson('/api/purchases', [
            'partner_id' => $supplierId,
            'items' => [['product_id' => $productId, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertCreated()['data'];
    }

    private function invoiceSource(string $token, string $suffix = '1'): array
    {
        $customerId = $this->customer($token, "عميل فاتورة {$suffix}");

        return $this->withToken($token)->postJson('/api/invoices', [
            'partner_id' => $customerId,
            'payment_type' => 'credit',
            'items' => [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertCreated()['data'];
    }

    private function creditNotePayload(string $partnerId, array $extra = []): array
    {
        return array_merge([
            'partner_id' => $partnerId,
            'items' => [['description' => 'تصحيح', 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ], $extra);
    }

    /** @test */
    public function a_purchase_source_derives_purchase_ownership_when_type_is_omitted(): void
    {
        $auth = $this->registerTenant('purchase-source-derived', 'owner@purchase-source-derived.test');
        $purchase = $this->purchaseSource($auth['token'], 'derive');

        $note = $this->withToken($auth['token'])->postJson('/api/credit-notes', $this->creditNotePayload(
            $purchase['partner_id'],
            ['original_purchase_id' => $purchase['id']],
        ))->assertCreated()['data'];

        $this->assertSame('purchase', $note['type']);
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame($purchase['id'], CreditNote::findOrFail($note['id'])->original_purchase_id);
    }

    /** @test */
    public function a_purchase_source_rejects_a_conflicting_sales_type(): void
    {
        $auth = $this->registerTenant('purchase-source-conflict', 'owner@purchase-source-conflict.test');
        $purchase = $this->purchaseSource($auth['token'], 'conflict');

        $this->withToken($auth['token'])->postJson('/api/credit-notes', $this->creditNotePayload(
            $purchase['partner_id'],
            ['type' => 'sales', 'original_purchase_id' => $purchase['id']],
        ))->assertStatus(422);
    }

    /** @test */
    public function an_invoice_source_derives_sales_ownership_when_type_is_omitted(): void
    {
        $auth = $this->registerTenant('invoice-source-derived', 'owner@invoice-source-derived.test');
        $invoice = $this->invoiceSource($auth['token'], 'derive');

        $note = $this->withToken($auth['token'])->postJson('/api/credit-notes', $this->creditNotePayload(
            $invoice['partner_id'],
            ['original_invoice_id' => $invoice['id']],
        ))->assertCreated()['data'];

        $this->assertSame('sales', $note['type']);
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame($invoice['id'], CreditNote::findOrFail($note['id'])->original_invoice_id);
    }

    /** @test */
    public function an_invoice_source_allows_sales_and_rejects_a_conflicting_purchase_type(): void
    {
        $auth = $this->registerTenant('invoice-source-conflict', 'owner@invoice-source-conflict.test');
        $invoice = $this->invoiceSource($auth['token'], 'conflict');

        $this->withToken($auth['token'])->postJson('/api/credit-notes', $this->creditNotePayload(
            $invoice['partner_id'],
            ['type' => 'sales', 'original_invoice_id' => $invoice['id']],
        ))->assertCreated()->assertJsonPath('data.type', 'sales');

        $this->withToken($auth['token'])->postJson('/api/credit-notes', $this->creditNotePayload(
            $invoice['partner_id'],
            ['type' => 'purchase', 'original_invoice_id' => $invoice['id']],
        ))->assertStatus(422);
    }

    /** @test */
    public function both_sources_are_rejected_and_a_standalone_note_requires_an_explicit_type(): void
    {
        $auth = $this->registerTenant('note-source-validation', 'owner@note-source-validation.test');
        $purchase = $this->purchaseSource($auth['token'], 'both');
        $invoice = $this->invoiceSource($auth['token'], 'both');

        $this->withToken($auth['token'])->postJson('/api/credit-notes', $this->creditNotePayload(
            $purchase['partner_id'],
            ['type' => 'sales', 'original_purchase_id' => $purchase['id'], 'original_invoice_id' => $invoice['id']],
        ))->assertStatus(422);

        $this->withToken($auth['token'])->postJson('/api/credit-notes', $this->creditNotePayload(
            $invoice['partner_id'],
        ))->assertStatus(422)->assertJsonValidationErrors('type');
    }

    /** @test */
    public function cross_tenant_purchase_and_invoice_sources_return_non_leaking_not_found(): void
    {
        $owner = $this->registerTenant('source-owner', 'owner@source-owner.test');
        $purchase = $this->purchaseSource($owner['token'], 'foreign');
        $invoice = $this->invoiceSource($owner['token'], 'foreign');

        $other = $this->registerTenant('source-other', 'owner@source-other.test');
        $otherSupplier = $this->supplier($other['token'], 'مورد المستأجر الآخر');
        $otherCustomer = $this->customer($other['token'], 'عميل المستأجر الآخر');

        $this->withToken($other['token'])->postJson('/api/credit-notes', $this->creditNotePayload(
            $otherSupplier,
            ['original_purchase_id' => $purchase['id']],
        ))->assertNotFound();
        $this->withToken($other['token'])->postJson('/api/credit-notes', $this->creditNotePayload(
            $otherCustomer,
            ['original_invoice_id' => $invoice['id']],
        ))->assertNotFound();
    }

    /** @test */
    public function disabled_purchases_denies_purchase_note_creation_while_sales_notes_still_work(): void
    {
        $purchaseTenant = $this->registerTenant('purchase-note-disabled', 'owner@purchase-note-disabled.test', autoEnableApplications: false);
        app(TenantContext::class)->set($purchaseTenant['tenant_id']);
        $supplierId = Partner::create(['name' => 'مورد معطّل', 'type' => 'supplier'])->id;
        $purchase = Purchase::create([
            'number' => 'BILL-DISABLED-1',
            'partner_id' => $supplierId,
            'purchase_date' => '2026-01-01',
            'status' => 'draft',
            'subtotal' => 0,
            'tax_amount' => 0,
            'total' => 0,
        ]);

        $this->withToken($purchaseTenant['token'])->postJson('/api/credit-notes', $this->creditNotePayload(
            $supplierId,
            ['type' => 'purchase', 'original_purchase_id' => $purchase->id],
        ))->assertForbidden();

        $salesTenant = $this->registerTenant('sales-note-independent', 'owner@sales-note-independent.test', autoEnableApplications: false);
        $invoice = $this->invoiceSource($salesTenant['token'], 'independent');
        $this->withToken($salesTenant['token'])->postJson('/api/credit-notes', $this->creditNotePayload(
            $invoice['partner_id'],
            ['original_invoice_id' => $invoice['id']],
        ))->assertCreated()->assertJsonPath('data.type', 'sales');
    }

    /** @test */
    public function suspended_purchases_denies_purchase_note_writes_but_keeps_safe_reads_available(): void
    {
        $auth = $this->registerTenant('purchase-note-suspended', 'owner@purchase-note-suspended.test');
        $purchase = $this->purchaseSource($auth['token'], 'suspended');
        app(TenantContext::class)->set($auth['tenant_id']);
        $existing = CreditNote::create([
            'number' => 'DN-SUSPENDED-1',
            'type' => 'purchase',
            'partner_id' => $purchase['partner_id'],
            'refund_type' => 'credit',
            'note_date' => '2026-01-01',
            'status' => 'draft',
            'subtotal' => 0,
            'tax_amount' => 0,
            'total' => 0,
        ]);

        $this->withToken($auth['token'])->postJson('/api/applications/disable', [
            'application_key' => 'purchases.cycle',
        ])->assertOk()->assertJsonPath('data.status', 'suspended');

        $this->withToken($auth['token'])->getJson("/api/credit-notes/{$existing->id}")->assertOk();
        $this->withToken($auth['token'])->postJson('/api/credit-notes', $this->creditNotePayload(
            $purchase['partner_id'],
            ['original_purchase_id' => $purchase['id']],
        ))->assertForbidden();
    }
}
