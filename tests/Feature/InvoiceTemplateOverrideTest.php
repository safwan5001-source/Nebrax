<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\PrintTemplateAssignment;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\PrintTemplates\PrintTemplateService;
use App\Support\PrintTemplateContract;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

/**
 * تجاوز تصميم فاتورة المسودة مستقل عن أعمدة التجميد والتعيين الحي.
 */
class InvoiceTemplateOverrideTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    protected Tenant $tenant;
    protected Partner $customer;
    protected InvoiceService $invoices;
    protected PrintTemplateService $templates;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'نبراس الطموح',
            'slug' => 'nibras-design-override',
            'vat_number' => '300000000000003',
            'currency' => 'SAR',
        ]);

        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);

        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $this->invoices = app(InvoiceService::class);
        $this->templates = app(PrintTemplateService::class);
    }

    /** @return array{0: \App\Models\PrintTemplate, 1: string} */
    private function published(string $name, array $types, array $definition): array
    {
        $template = $this->templates->publish($this->templates->create([
            'name' => $name,
            'document_types' => $types,
            'definition' => $definition,
        ], null));

        return [$template, $template->published_revision_id];
    }

    private function assign(string $documentType, string $usage, string $revisionId): void
    {
        $this->templates->assign([
            'document_type' => $documentType,
            'usage' => $usage,
            'print_template_revision_id' => $revisionId,
        ], null);
    }

    private function draft(array $extra = []): Invoice
    {
        return $this->invoices->create(
            array_merge([
                'partner_id' => $this->customer->id,
                'payment_type' => 'cash',
                'zatca_document_type' => 'standard',
            ], $extra),
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        );
    }

    /** @test */
    public function creating_without_override_leaves_both_columns_null(): void
    {
        $invoice = $this->draft();

        $this->assertNull($invoice->print_template_override_revision_id);
        $this->assertNull($invoice->pdf_template_override_revision_id);
        $this->assertNull($invoice->print_template_revision_id);
        $this->assertNull($invoice->pdf_template_revision_id);
    }

    /** @test */
    public function a_compatible_override_is_saved_on_print_and_pdf_without_changing_assignments(): void
    {
        [, $defaultId] = $this->published('افتراضي', ['tax_invoice'], ['template_id' => 'tax-invoice-classic']);
        [, $chosenId] = $this->published('مختار', ['tax_invoice'], ['template_id' => 'tax-invoice-modern']);
        $this->assign('tax_invoice', 'print', $defaultId);
        $this->assign('tax_invoice', 'pdf', $defaultId);

        $invoice = $this->draft([
            'print_template_override_revision_id' => $chosenId,
            'pdf_template_override_revision_id' => $chosenId,
        ]);

        $this->assertSame($chosenId, $invoice->print_template_override_revision_id);
        $this->assertSame($chosenId, $invoice->pdf_template_override_revision_id);
        $this->assertNull($invoice->print_template_revision_id);
        $this->assertSame($defaultId, $this->templates->resolve('tax_invoice', 'print', $invoice->branch_id)?->print_template_revision_id);
        $this->assertSame($defaultId, $this->templates->resolve('tax_invoice', 'pdf', $invoice->branch_id)?->print_template_revision_id);
        $this->assertSame(1, PrintTemplateAssignment::where('usage', 'print')->count());
    }

    /** @test */
    public function update_can_reset_override_to_null_and_omit_keeps_the_saved_choice(): void
    {
        [, $chosenId] = $this->published('مختار', ['tax_invoice'], ['template_id' => 'tax-invoice-minimal']);
        $invoice = $this->draft([
            'print_template_override_revision_id' => $chosenId,
            'pdf_template_override_revision_id' => $chosenId,
        ]);

        $kept = $this->invoices->update($invoice, [
            'partner_id' => $this->customer->id,
        ], [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]);
        $this->assertSame($chosenId, $kept->print_template_override_revision_id);
        $this->assertSame($chosenId, $kept->pdf_template_override_revision_id);

        $reset = $this->invoices->update($kept, [
            'partner_id' => $this->customer->id,
            'print_template_override_revision_id' => null,
            'pdf_template_override_revision_id' => null,
        ], [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]);
        $this->assertNull($reset->print_template_override_revision_id);
        $this->assertNull($reset->pdf_template_override_revision_id);
    }

    /** @test */
    public function posting_without_override_follows_the_live_assignment_including_later_changes(): void
    {
        [, $firstId] = $this->published('أول', ['tax_invoice'], ['template_id' => 'tax-invoice-classic']);
        $this->assign('tax_invoice', 'print', $firstId);
        $invoice = $this->draft();

        [, $secondId] = $this->published('لاحق', ['tax_invoice'], ['template_id' => 'tax-invoice-retail']);
        $this->assign('tax_invoice', 'print', $secondId);

        $posted = $this->invoices->post($invoice);
        $this->assertSame($secondId, $posted->print_template_revision_id);
        $this->assertNull($posted->print_template_override_revision_id);
    }

    /** @test */
    public function posting_with_override_freezes_it_and_ignores_a_later_assignment(): void
    {
        [, $defaultId] = $this->published('افتراضي', ['tax_invoice'], ['template_id' => 'tax-invoice-classic']);
        [, $chosenId] = $this->published('مختار', ['tax_invoice'], ['template_id' => 'tax-invoice-modern']);
        [, $thermalId] = $this->published('حراري', ['tax_invoice'], ['template_id' => 'tax-invoice-thermal80']);
        $this->assign('tax_invoice', 'print', $defaultId);
        $this->assign('tax_invoice', 'pdf', $defaultId);
        $this->assign('tax_invoice', 'thermal', $thermalId);

        $invoice = $this->draft([
            'print_template_override_revision_id' => $chosenId,
            'pdf_template_override_revision_id' => $chosenId,
        ]);

        [, $laterId] = $this->published('لاحق لا يُجمَّد', ['tax_invoice'], ['template_id' => 'tax-invoice-erp']);
        $this->assign('tax_invoice', 'print', $laterId);
        $this->assign('tax_invoice', 'pdf', $laterId);

        $posted = $this->invoices->post($invoice);

        $this->assertSame($chosenId, $posted->print_template_revision_id);
        $this->assertSame($chosenId, $posted->pdf_template_revision_id);
        $this->assertSame($thermalId, $posted->thermal_template_revision_id);
        $this->assertSame($chosenId, $posted->print_template_override_revision_id);
        $this->assertNotSame($laterId, $posted->print_template_revision_id);
        $this->assertNotNull($posted->zatca_qr);
        $this->assertNotNull($posted->zatca_uuid);

        $entry = JournalEntry::with('lines.account')
            ->where('source_type', Invoice::class)
            ->where('source_id', $posted->id)
            ->firstOrFail();
        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertEquals(115000, $entry->lines->sum('debit'));
    }

    /** @test */
    public function posting_rejects_an_unpublished_override_and_rolls_back(): void
    {
        $template = $this->templates->create([
            'name' => 'مسودة غير منشورة',
            'document_types' => ['tax_invoice'],
            'definition' => ['template_id' => 'tax-invoice-classic'],
        ], null);
        $draftRevisionId = $template->draftRevision->id;
        $invoice = $this->draft();
        $invoice->forceFill([
            'print_template_override_revision_id' => $draftRevisionId,
            'pdf_template_override_revision_id' => $draftRevisionId,
        ])->save();

        try {
            $this->invoices->post($invoice);
            $this->fail('كان يجب رفض الترحيل بتجاوز غير منشور.');
        } catch (RuntimeException $e) {
            $this->assertSame('لا يمكن اختيار مراجعة غير منشورة لتصميم الفاتورة.', $e->getMessage());
        }

        $this->assertSame('draft', $invoice->fresh()->status);
        $this->assertSame(0, JournalEntry::count());
    }

    /** @test */
    public function create_rejects_thermal_incompatible_and_missing_overrides(): void
    {
        [, $thermalId] = $this->published('حراري', ['tax_invoice'], ['template_id' => 'tax-invoice-thermal80']);
        [, $quoteId] = $this->published('عرض سعر', ['quotation'], ['template_id' => 'quotation-proposal']);

        try {
            $this->draft(['print_template_override_revision_id' => $thermalId, 'pdf_template_override_revision_id' => $thermalId]);
            $this->fail('كان يجب رفض التجاوز الحراري.');
        } catch (RuntimeException $e) {
            $this->assertSame('التصميم الحراري غير مدعوم لاختيار فاتورة طباعة أو PDF.', $e->getMessage());
        }

        try {
            $this->draft(['print_template_override_revision_id' => $quoteId, 'pdf_template_override_revision_id' => $quoteId]);
            $this->fail('كان يجب رفض نوع المستند غير المتوافق.');
        } catch (RuntimeException $e) {
            $this->assertSame('مراجعة القالب لا تدعم نوع مستند هذه الفاتورة.', $e->getMessage());
        }

        try {
            $this->draft([
                'print_template_override_revision_id' => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
                'pdf_template_override_revision_id' => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            ]);
            $this->fail('كان يجب رفض المراجعة غير الموجودة.');
        } catch (RuntimeException $e) {
            $this->assertSame('مراجعة تصميم الفاتورة غير موجودة.', $e->getMessage());
        }

        $this->assertSame(0, Invoice::count());
    }

    /** @test */
    public function duplicate_does_not_copy_the_override(): void
    {
        [, $chosenId] = $this->published('مختار', ['tax_invoice'], ['template_id' => 'tax-invoice-modern']);
        $source = $this->draft([
            'print_template_override_revision_id' => $chosenId,
            'pdf_template_override_revision_id' => $chosenId,
        ]);

        $copy = $this->invoices->duplicate($source);

        $this->assertNull($copy->print_template_override_revision_id);
        $this->assertNull($copy->pdf_template_override_revision_id);
        $this->assertSame($chosenId, $source->fresh()->print_template_override_revision_id);
    }

    /** @test */
    public function simplified_invoice_accepts_a_tax_invoice_override(): void
    {
        [, $taxId] = $this->published('ضريبية', ['tax_invoice'], ['template_id' => 'tax-invoice-classic']);
        $invoice = $this->draft([
            'zatca_document_type' => 'simplified',
            'print_template_override_revision_id' => $taxId,
            'pdf_template_override_revision_id' => $taxId,
        ]);
        $this->assertSame($taxId, $invoice->print_template_override_revision_id);
    }

    /** @test */
    public function api_create_and_show_expose_override_fields(): void
    {
        ['token' => $token] = $this->registerTenant('override-api', 'owner@override-api.test');
        $partnerId = $this->withToken($token)->postJson('/api/partners', [
            'name' => 'عميل', 'type' => 'customer',
        ])->assertCreated()['data']['id'];

        $template = $this->withToken($token)->postJson('/api/print-templates', [
            'name' => 'مخصص واجهة',
            'document_types' => ['tax_invoice'],
            'definition' => ['template_id' => 'tax-invoice-modern'],
        ])->assertCreated();
        $revisionId = $this->withToken($token)
            ->postJson('/api/print-templates/'.$template['data']['id'].'/publish')
            ->assertOk()['data']['published_revision']['id'];

        $created = $this->withToken($token)->postJson('/api/invoices', [
            'partner_id' => $partnerId,
            'zatca_document_type' => 'standard',
            'print_template_override_revision_id' => $revisionId,
            'pdf_template_override_revision_id' => $revisionId,
            'items' => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated();

        $this->assertSame($revisionId, $created['data']['print_template_override_revision_id']);
        $this->assertSame($revisionId, $created['data']['pdf_template_override_revision_id']);
        $this->assertSame('tax-invoice-modern', $created['data']['print_template_override_revision']['definition']['template_id']);

        $shown = $this->withToken($token)->getJson('/api/invoices/'.$created['data']['id'])->assertOk();
        $this->assertSame($revisionId, $shown['data']['print_template_override_revision_id']);
    }

    /** @test */
    public function api_rejects_a_cross_tenant_override_revision(): void
    {
        ['token' => $aToken] = $this->registerTenant('override-alpha', 'owner@override-alpha.test');
        ['token' => $bToken] = $this->registerTenant('override-beta', 'owner@override-beta.test');

        $template = $this->withToken($aToken)->postJson('/api/print-templates', [
            'name' => 'قالب ألفا',
            'document_types' => ['tax_invoice'],
            'definition' => ['template_id' => 'tax-invoice-classic'],
        ])->assertCreated();
        $foreignRevisionId = $this->withToken($aToken)
            ->postJson('/api/print-templates/'.$template['data']['id'].'/publish')
            ->assertOk()['data']['published_revision']['id'];

        $partnerId = $this->withToken($bToken)->postJson('/api/partners', [
            'name' => 'عميل بيتا', 'type' => 'customer',
        ])->assertCreated()['data']['id'];

        $this->withToken($bToken)->postJson('/api/invoices', [
            'partner_id' => $partnerId,
            'zatca_document_type' => 'standard',
            'print_template_override_revision_id' => $foreignRevisionId,
            'pdf_template_override_revision_id' => $foreignRevisionId,
            'items' => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertUnprocessable()
            ->assertJsonPath('message', 'مراجعة تصميم الفاتورة غير موجودة.');
    }

    /** @test */
    public function staff_cannot_write_an_invoice_override(): void
    {
        ['token' => $owner, 'tenant_id' => $tenantId] = $this->registerTenant('override-rbac', 'owner@override-rbac.test');
        $staff = $this->tokenForRole($tenantId, 'staff', 'staff@override-rbac.test');
        $partnerId = $this->withToken($owner)->postJson('/api/partners', [
            'name' => 'عميل', 'type' => 'customer',
        ])->assertCreated()['data']['id'];

        $this->withToken($staff)->postJson('/api/invoices', [
            'partner_id' => $partnerId,
            'items' => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertForbidden();
    }

    /** @test */
    public function accountant_can_create_an_invoice_with_an_override(): void
    {
        ['token' => $owner, 'tenant_id' => $tenantId] = $this->registerTenant('override-accountant', 'owner@override-accountant.test');
        $accountant = $this->tokenForRole($tenantId, 'accountant', 'accountant@override-accountant.test');
        $partnerId = $this->withToken($owner)->postJson('/api/partners', [
            'name' => 'عميل', 'type' => 'customer',
        ])->assertCreated()['data']['id'];
        $template = $this->withToken($owner)->postJson('/api/print-templates', [
            'name' => 'قالب المحاسب',
            'document_types' => ['tax_invoice'],
            'definition' => ['template_id' => 'tax-invoice-classic'],
        ])->assertCreated();
        $revisionId = $this->withToken($owner)
            ->postJson('/api/print-templates/'.$template['data']['id'].'/publish')
            ->assertOk()['data']['published_revision']['id'];

        $this->withToken($accountant)->postJson('/api/invoices', [
            'partner_id' => $partnerId,
            'zatca_document_type' => 'standard',
            'print_template_override_revision_id' => $revisionId,
            'pdf_template_override_revision_id' => $revisionId,
            'items' => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated()
            ->assertJsonPath('data.print_template_override_revision_id', $revisionId);
    }

    /** @test */
    public function contract_helpers_reject_thermal_and_accept_simplified_fallback(): void
    {
        $this->assertTrue(PrintTemplateContract::isThermalDefinition(['template_id' => 'tax-invoice-thermal58']));
        $this->assertFalse(PrintTemplateContract::isThermalDefinition(['template_id' => 'tax-invoice-classic']));
        $this->assertTrue(PrintTemplateContract::revisionSupportsInvoiceOverride(['tax_invoice'], 'simplified_tax_invoice'));
        $this->assertFalse(PrintTemplateContract::revisionSupportsInvoiceOverride(['quotation'], 'tax_invoice'));
    }
}
