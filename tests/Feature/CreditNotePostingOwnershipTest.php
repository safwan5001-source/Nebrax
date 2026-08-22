<?php

namespace Tests\Feature;

use App\Models\CreditNote;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\Purchase;
use App\Services\Accounting\CreditNoteService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

/**
 * ملكية المصدر لا تنتهي عند الإنشاء: الصف المحفوظ يعاد فحصه قبل أي أثر دفتر.
 * تشغيل: php artisan test --filter=CreditNotePostingOwnershipTest
 */
class CreditNotePostingOwnershipTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function supplier(string $token, string $suffix): string
    {
        return $this->withToken($token)->postJson('/api/partners', [
            'name' => "مورد ترحيل {$suffix}",
            'type' => 'supplier',
        ])->assertCreated()['data']['id'];
    }

    private function customer(string $token, string $suffix): string
    {
        return $this->withToken($token)->postJson('/api/partners', [
            'name' => "عميل ترحيل {$suffix}",
            'type' => 'customer',
        ])->assertCreated()['data']['id'];
    }

    private function purchaseSource(string $token, string $suffix): array
    {
        $supplierId = $this->supplier($token, $suffix);
        $productId = $this->withToken($token)->postJson('/api/products', [
            'name' => "صنف ترحيل شراء {$suffix}",
            'sku' => "CN-POST-P-{$suffix}",
            'type' => 'good',
            'sale_price' => 20000,
            'purchase_price' => 10000,
        ])->assertCreated()['data']['id'];

        return $this->withToken($token)->postJson('/api/purchases', [
            'partner_id' => $supplierId,
            'items' => [['product_id' => $productId, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertCreated()['data'];
    }

    private function invoiceSource(string $token, string $suffix): array
    {
        $customerId = $this->customer($token, $suffix);

        return $this->withToken($token)->postJson('/api/invoices', [
            'partner_id' => $customerId,
            'payment_type' => 'credit',
            'items' => [['description' => 'خدمة ترحيل', 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertCreated()['data'];
    }

    private function createSourceNote(string $token, array $source, string $sourceKey): array
    {
        return $this->withToken($token)->postJson('/api/credit-notes', [
            'partner_id' => $source['partner_id'],
            $sourceKey => $source['id'],
            'items' => [['description' => 'تصحيح مصدر', 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertCreated()['data'];
    }

    private function assertNoPostEffects(string $noteId): void
    {
        $note = CreditNote::findOrFail($noteId);
        $this->assertSame('draft', $note->status);
        $this->assertNull($note->journal_entry_id);
        $this->assertSame(0, JournalEntry::where('source_type', CreditNote::class)
            ->where('source_id', $noteId)->count());
    }

    private function accountCodesFor(string $noteId): array
    {
        return JournalEntry::with('lines.account')
            ->where('source_type', CreditNote::class)
            ->where('source_id', $noteId)
            ->sole()
            ->lines
            ->map(fn ($line) => $line->account->code)
            ->all();
    }

    /** @test */
    public function persisted_source_type_divergence_and_dual_sources_are_rejected_before_any_post_effect(): void
    {
        $auth = $this->registerTenant('post-persisted-conflicts', 'owner@post-persisted-conflicts.test');
        $purchase = $this->purchaseSource($auth['token'], 'conflict');
        $invoice = $this->invoiceSource($auth['token'], 'conflict');

        $purchaseNote = $this->createSourceNote($auth['token'], $purchase, 'original_purchase_id');
        app(TenantContext::class)->set($auth['tenant_id']);
        CreditNote::findOrFail($purchaseNote['id'])->update(['type' => 'sales']);
        $this->withToken($auth['token'])->getJson("/api/credit-notes/{$purchaseNote['id']}")->assertStatus(422);
        $this->withToken($auth['token'])->postJson("/api/credit-notes/{$purchaseNote['id']}/post")->assertStatus(422);
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertNoPostEffects($purchaseNote['id']);

        $invoiceNote = $this->createSourceNote($auth['token'], $invoice, 'original_invoice_id');
        app(TenantContext::class)->set($auth['tenant_id']);
        CreditNote::findOrFail($invoiceNote['id'])->update(['type' => 'purchase']);
        $this->withToken($auth['token'])->postJson("/api/credit-notes/{$invoiceNote['id']}/post")->assertStatus(422);
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertNoPostEffects($invoiceNote['id']);

        $dual = CreditNote::create([
            'number' => 'CN-DUAL-SOURCE-1',
            'type' => 'sales',
            'partner_id' => $purchase['partner_id'],
            'refund_type' => 'credit',
            'note_date' => '2026-01-01',
            'status' => 'draft',
            'subtotal' => 0,
            'tax_amount' => 0,
            'total' => 0,
            'original_purchase_id' => $purchase['id'],
            'original_invoice_id' => $invoice['id'],
        ]);
        $this->withToken($auth['token'])->postJson("/api/credit-notes/{$dual->id}/post")->assertStatus(422);
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertNoPostEffects($dual->id);
    }

    /** @test */
    public function post_service_itself_revalidates_a_persisted_conflicting_purchase_source_before_journal_work(): void
    {
        $auth = $this->registerTenant('post-service-boundary', 'owner@post-service-boundary.test');
        $purchase = $this->purchaseSource($auth['token'], 'service');
        $note = $this->createSourceNote($auth['token'], $purchase, 'original_purchase_id');
        app(TenantContext::class)->set($auth['tenant_id']);
        $persisted = CreditNote::findOrFail($note['id']);
        $persisted->update(['type' => 'sales']);

        try {
            app(CreditNoteService::class)->post($persisted->fresh());
            $this->fail('The service must reject persisted source/type divergence.');
        } catch (RuntimeException) {
            // حد الخدمة يعيد التحقق حتى إذا استدعاها مسار غير HTTP.
        }

        $this->assertNoPostEffects($note['id']);
    }

    /** @test */
    public function purchase_sourced_note_is_denied_when_purchases_is_disabled_or_suspended_without_status_or_journal_mutation(): void
    {
        $disabled = $this->registerTenant('post-purchase-disabled', 'owner@post-purchase-disabled.test', autoEnableApplications: false);
        app(TenantContext::class)->set($disabled['tenant_id']);
        $supplier = Partner::create(['name' => 'مورد تعطيل الترحيل', 'type' => 'supplier']);
        $purchase = Purchase::create([
            'number' => 'BILL-POST-DISABLED-1',
            'partner_id' => $supplier->id,
            'purchase_date' => '2026-01-01',
            'status' => 'draft',
            'subtotal' => 0,
            'tax_amount' => 0,
            'total' => 0,
        ]);
        $disabledNote = CreditNote::create([
            'number' => 'DN-POST-DISABLED-1',
            'type' => 'purchase',
            'partner_id' => $supplier->id,
            'refund_type' => 'credit',
            'note_date' => '2026-01-01',
            'status' => 'draft',
            'subtotal' => 0,
            'tax_amount' => 0,
            'total' => 0,
            'original_purchase_id' => $purchase->id,
        ]);
        $this->withToken($disabled['token'])->postJson("/api/credit-notes/{$disabledNote->id}/post")->assertForbidden();
        app(TenantContext::class)->set($disabled['tenant_id']);
        $this->assertNoPostEffects($disabledNote->id);

        $suspended = $this->registerTenant('post-purchase-suspended', 'owner@post-purchase-suspended.test');
        $suspendedPurchase = $this->purchaseSource($suspended['token'], 'suspended');
        $suspendedNote = $this->createSourceNote($suspended['token'], $suspendedPurchase, 'original_purchase_id');
        $this->withToken($suspended['token'])->postJson('/api/applications/disable', [
            'application_key' => 'purchases.cycle',
        ])->assertOk()->assertJsonPath('data.status', 'suspended');
        $this->withToken($suspended['token'])->getJson("/api/credit-notes/{$suspendedNote['id']}")->assertOk();
        $this->withToken($suspended['token'])->postJson("/api/credit-notes/{$suspendedNote['id']}/post")->assertForbidden();
        app(TenantContext::class)->set($suspended['tenant_id']);
        $this->assertNoPostEffects($suspendedNote['id']);
    }

    /** @test */
    public function valid_purchase_and_invoice_sources_post_with_their_respective_accounting_semantics(): void
    {
        $auth = $this->registerTenant('post-valid-sources', 'owner@post-valid-sources.test');
        $purchase = $this->purchaseSource($auth['token'], 'valid');
        $invoice = $this->invoiceSource($auth['token'], 'valid');
        $purchaseNote = $this->createSourceNote($auth['token'], $purchase, 'original_purchase_id');
        $invoiceNote = $this->createSourceNote($auth['token'], $invoice, 'original_invoice_id');

        $this->withToken($auth['token'])->postJson("/api/credit-notes/{$purchaseNote['id']}/post")->assertOk();
        $this->withToken($auth['token'])->postJson("/api/credit-notes/{$invoiceNote['id']}/post")->assertOk();

        app(TenantContext::class)->set($auth['tenant_id']);
        $purchaseCodes = $this->accountCodesFor($purchaseNote['id']);
        $salesCodes = $this->accountCodesFor($invoiceNote['id']);

        $this->assertContains('2110', $purchaseCodes);
        $this->assertContains('5115', $purchaseCodes);
        $this->assertContains('1150', $purchaseCodes);
        $this->assertNotContains('4110', $purchaseCodes);
        $this->assertContains('4110', $salesCodes);
        $this->assertContains('2120', $salesCodes);
        $this->assertContains('1130', $salesCodes);
        $this->assertNotContains('5115', $salesCodes);
    }

    /** @test */
    public function persisted_foreign_purchase_source_remains_non_leaking_at_post_and_standalone_explicit_type_still_works(): void
    {
        $owner = $this->registerTenant('post-source-owner', 'owner@post-source-owner.test');
        $purchase = $this->purchaseSource($owner['token'], 'foreign');
        $other = $this->registerTenant('post-source-other', 'owner@post-source-other.test');
        app(TenantContext::class)->set($other['tenant_id']);
        $supplier = Partner::create(['name' => 'مورد مصدر أجنبي', 'type' => 'supplier']);
        $foreign = CreditNote::create([
            'number' => 'DN-FOREIGN-SOURCE-1',
            'type' => 'purchase',
            'partner_id' => $supplier->id,
            'refund_type' => 'credit',
            'note_date' => '2026-01-01',
            'status' => 'draft',
            'subtotal' => 0,
            'tax_amount' => 0,
            'total' => 0,
            'original_purchase_id' => $purchase['id'],
        ]);
        $this->withToken($other['token'])->postJson("/api/credit-notes/{$foreign->id}/post")->assertNotFound();
        app(TenantContext::class)->set($other['tenant_id']);
        $this->assertNoPostEffects($foreign->id);

        $customerId = $this->customer($other['token'], 'مستقل صريح');
        $standalone = $this->withToken($other['token'])->postJson('/api/credit-notes', [
            'partner_id' => $customerId,
            'type' => 'sales',
            'items' => [['description' => 'خصم مستقل', 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertCreated()['data'];
        $this->assertSame('sales', $standalone['type']);
    }
}
