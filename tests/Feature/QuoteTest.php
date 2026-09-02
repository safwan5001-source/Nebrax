<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Quote;
use App\Services\PrintTemplates\PrintTemplateService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات عروض الأسعار: الإجماليات مشتقّة من السطور، والتحويل ينشئ فاتورة
 * draft (بلا قيد محاسبي حتى تُرحَّل). تشغيل: php artisan test --filter=QuoteTest
 */
class QuoteTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function partner(string $token): string
    {
        return $this->withToken($token)->postJson('/api/partners', [
            'name' => 'عميل', 'type' => 'customer',
        ])->assertCreated()['data']['id'];
    }

    /** @test */
    public function creating_a_quote_derives_totals_from_lines_without_any_journal_entry(): void
    {
        $auth = $this->registerTenant();
        $partnerId = $this->partner($auth['token']);

        $res = $this->withToken($auth['token'])->postJson('/api/quotes', [
            'partner_id' => $partnerId,
            'items'      => [['quantity' => 2, 'unit_price' => 50000, 'tax_rate' => 15]],
        ])->assertCreated();

        $this->assertSame('draft', $res['data']['status']);
        $this->assertSame('1000.00', $res['data']['subtotal']); // 2 × 500
        $this->assertSame('150.00', $res['data']['tax_amount']);
        $this->assertSame('1150.00', $res['data']['total']);

        // عرض السعر لا يولّد أي قيد محاسبي
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(0, JournalEntry::where('source_type', Quote::class)->count());
    }

    /** @test */
    public function inclusive_quote_extracts_tax_from_price_and_preserves_mode_on_convert(): void
    {
        $auth = $this->registerTenant();
        $partnerId = $this->partner($auth['token']);

        // 115.00 شامل 15% → صافي 100.00 + ضريبة 15.00 (تُستخرَج لا تُضاف)
        $res = $this->withToken($auth['token'])->postJson('/api/quotes', [
            'partner_id'    => $partnerId,
            'tax_inclusive' => true,
            'items'         => [['quantity' => 1, 'unit_price' => 11500, 'tax_rate' => 15]],
        ])->assertCreated();

        $this->assertTrue($res['data']['tax_inclusive']);
        $this->assertSame('100.00', $res['data']['subtotal']);
        $this->assertSame('15.00', $res['data']['tax_amount']);
        $this->assertSame('115.00', $res['data']['total']);

        // التحويل يحافظ على الوضع والإجمالي (لا يتضاعف)
        $invoice = $this->withToken($auth['token'])
            ->postJson("/api/quotes/{$res['data']['id']}/convert", ['payment_type' => 'credit'])
            ->assertCreated();
        $this->assertSame('115.00', $invoice['data']['total']);
    }

    /** @test */
    public function quote_requires_at_least_one_line(): void
    {
        $auth = $this->registerTenant();
        $partnerId = $this->partner($auth['token']);

        $this->withToken($auth['token'])->postJson('/api/quotes', [
            'partner_id' => $partnerId, 'items' => [],
        ])->assertStatus(422)->assertJsonValidationErrors('items');
    }

    /** @test */
    public function converting_a_quote_creates_a_draft_invoice_and_marks_it_converted(): void
    {
        $auth = $this->registerTenant();
        $partnerId = $this->partner($auth['token']);

        $quoteId = $this->withToken($auth['token'])->postJson('/api/quotes', [
            'partner_id' => $partnerId,
            'items'      => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])['data']['id'];

        $invoice = $this->withToken($auth['token'])
            ->postJson("/api/quotes/{$quoteId}/convert", ['payment_type' => 'credit'])
            ->assertCreated();

        // الفاتورة الناتجة draft بنفس الإجمالي، وبلا قيد (لم تُرحَّل بعد)
        $this->assertSame('draft', $invoice['data']['status']);
        $this->assertSame('1150.00', $invoice['data']['total']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertTrue(Quote::find($quoteId)->isConverted());
        $this->assertSame(0, JournalEntry::where('source_type', Invoice::class)->count());
    }

    /** @test */
    public function a_quote_cannot_be_converted_twice(): void
    {
        $auth = $this->registerTenant();
        $partnerId = $this->partner($auth['token']);

        $quoteId = $this->withToken($auth['token'])->postJson('/api/quotes', [
            'partner_id' => $partnerId,
            'items'      => [['quantity' => 1, 'unit_price' => 10000]],
        ])['data']['id'];

        $this->withToken($auth['token'])->postJson("/api/quotes/{$quoteId}/convert")->assertCreated();
        $this->withToken($auth['token'])->postJson("/api/quotes/{$quoteId}/convert")->assertStatus(422);
    }

    /** @test */
    public function issuing_a_quote_freezes_templates_locks_the_source_and_creates_a_working_revision(): void
    {
        $auth = $this->registerTenant();
        $partnerId = $this->partner($auth['token']);
        app(TenantContext::class)->set($auth['tenant_id']);

        $templates = app(PrintTemplateService::class);
        $print = $templates->publish($templates->create([
            'name' => 'قالب عرض ثابت',
            'document_types' => ['quotation'],
            'definition' => ['template_id' => 'tax-invoice-classic', 'footer_text' => 'نسخة صادرة'],
        ], null));
        $pdf = $templates->publish($templates->create([
            'name' => 'قالب PDF لعرض ثابت',
            'document_types' => ['quotation'],
            'definition' => ['template_id' => 'tax-invoice-minimal', 'footer_text' => 'أرشيف PDF'],
        ], null));
        $templates->assign([
            'document_type' => 'quotation',
            'usage' => 'print',
            'print_template_revision_id' => $print->published_revision_id,
        ], null);
        $templates->assign([
            'document_type' => 'quotation',
            'usage' => 'pdf',
            'print_template_revision_id' => $pdf->published_revision_id,
        ], null);

        $quoteId = $this->withToken($auth['token'])->postJson('/api/quotes', [
            'partner_id' => $partnerId,
            'items' => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated()['data']['id'];

        $issued = $this->withToken($auth['token'])->postJson("/api/quotes/{$quoteId}/issue")
            ->assertOk()
            ->assertJsonPath('data.print_template_revision_id', $print->published_revision_id)
            ->assertJsonPath('data.pdf_template_revision_id', $pdf->published_revision_id);
        $this->assertNotNull($issued['data']['print_issued_at']);

        $this->withToken($auth['token'])->putJson("/api/quotes/{$quoteId}", [
            'partner_id' => $partnerId,
            'items' => [['quantity' => 2, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertStatus(422);
        $this->withToken($auth['token'])->deleteJson("/api/quotes/{$quoteId}")->assertStatus(422);

        $templates->updateDraft($print, [
            'definition' => ['template_id' => 'tax-invoice-modern', 'footer_text' => 'قالب أحدث'],
        ], null);
        $templates->publish($print);
        $frozen = $this->withToken($auth['token'])->getJson("/api/quotes/{$quoteId}")->assertOk();
        $this->assertSame('tax-invoice-classic', $frozen['data']['print_template_revision']['definition']['template_id']);

        $revision = $this->withToken($auth['token'])->postJson("/api/quotes/{$quoteId}/revise")
            ->assertCreated();
        $this->assertSame('draft', $revision['data']['status']);
        $this->assertSame($quoteId, $revision['data']['revised_from_id']);
        $this->assertNull($revision['data']['print_issued_at']);
        $this->assertSame('1150.00', $revision['data']['total']);

        $invoice = $this->withToken($auth['token'])->postJson("/api/quotes/{$quoteId}/convert")
            ->assertCreated();
        $this->assertSame('draft', $invoice['data']['status']);
        $this->assertSame(0, JournalEntry::where('source_type', Invoice::class)->count());
    }

    /** @test */
    public function reassigning_print_after_issue_does_not_change_the_frozen_quote(): void
    {
        $auth = $this->registerTenant();
        $partnerId = $this->partner($auth['token']);
        app(TenantContext::class)->set($auth['tenant_id']);

        $templates = app(PrintTemplateService::class);
        $print = $templates->publish($templates->create([
            'name' => 'طباعة عرض مجمّدة',
            'document_types' => ['quotation'],
            'definition' => ['template_id' => 'tax-invoice-classic'],
        ], null));
        $templates->assign([
            'document_type' => 'quotation',
            'usage' => 'print',
            'print_template_revision_id' => $print->published_revision_id,
        ], null);

        $quoteId = $this->withToken($auth['token'])->postJson('/api/quotes', [
            'partner_id' => $partnerId,
            'items' => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated()['data']['id'];
        $this->withToken($auth['token'])->postJson("/api/quotes/{$quoteId}/issue")->assertOk();
        $frozenId = $print->published_revision_id;

        $replacement = $templates->publish($templates->create([
            'name' => 'طباعة لاحقة',
            'document_types' => ['quotation'],
            'definition' => ['template_id' => 'tax-invoice-retail'],
        ], null));
        $templates->assign([
            'document_type' => 'quotation',
            'usage' => 'print',
            'print_template_revision_id' => $replacement->published_revision_id,
        ], null);

        $this->assertSame($frozenId, Quote::findOrFail($quoteId)->print_template_revision_id);
    }

    /** @test */
    public function issuing_a_quote_without_pdf_assignment_leaves_pdf_revision_null(): void
    {
        $auth = $this->registerTenant();
        $partnerId = $this->partner($auth['token']);
        app(TenantContext::class)->set($auth['tenant_id']);

        $templates = app(PrintTemplateService::class);
        $print = $templates->publish($templates->create([
            'name' => 'طباعة عرض فقط',
            'document_types' => ['quotation'],
            'definition' => ['template_id' => 'tax-invoice-classic'],
        ], null));
        $templates->assign([
            'document_type' => 'quotation',
            'usage' => 'print',
            'print_template_revision_id' => $print->published_revision_id,
        ], null);

        $quoteId = $this->withToken($auth['token'])->postJson('/api/quotes', [
            'partner_id' => $partnerId,
            'items' => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated()['data']['id'];
        $issued = $this->withToken($auth['token'])->postJson("/api/quotes/{$quoteId}/issue")->assertOk();

        $this->assertSame($print->published_revision_id, $issued['data']['print_template_revision_id']);
        $this->assertNull($issued['data']['pdf_template_revision_id']);
    }

    /** @test */
    public function quotes_are_tenant_isolated(): void
    {
        $a = $this->registerTenant('acme', 'owner@acme.test');
        $partnerA = $this->partner($a['token']);
        $quoteId = $this->withToken($a['token'])->postJson('/api/quotes', [
            'partner_id' => $partnerA, 'items' => [['quantity' => 1, 'unit_price' => 10000]],
        ])['data']['id'];

        $b = $this->registerTenant('globex', 'owner@globex.test');
        $this->withToken($b['token'])->getJson("/api/quotes/{$quoteId}")->assertNotFound();
        $this->withToken($b['token'])->getJson('/api/quotes')->assertOk()->assertJsonCount(0, 'data');
    }
}
