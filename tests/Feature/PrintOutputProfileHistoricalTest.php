<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\Partner;
use App\Models\PrintTemplateRevision;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\PrintTemplates\PrintTemplateService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * التوافق التاريخي لـOutput Profile (DOC-V2-PR3A): مستند مرحَّل يثبّت مراجعة القالب
 * بملفها — لا يتغيّر بنشر مراجعة لاحقة ولا بتعيين قالب جديد — ومستند تاريخي لقالب
 * بلا ملف يبقى بلا ملف. لا يُعاد حل شيء من أحدث إعدادات المؤسسة.
 * تشغيل:  php artisan test --filter=PrintOutputProfileHistoricalTest
 */
class PrintOutputProfileHistoricalTest extends TestCase
{
    use RefreshDatabase;

    private Partner $customer;
    private InvoiceService $invoices;
    private PrintTemplateService $templates;

    protected function setUp(): void
    {
        parent::setUp();

        $tenant = Tenant::create([
            'name' => 'نبراس الطموح',
            'slug' => 'nibras-op',
            'vat_number' => '300000000000003',
            'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($tenant->id);

        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $this->invoices = app(InvoiceService::class);
        $this->templates = app(PrintTemplateService::class);
    }

    private function publishAndAssign(array $definition, string $usage, string $name): PrintTemplateRevision
    {
        $template = $this->templates->publish($this->templates->create([
            'name' => $name,
            'document_types' => ['tax_invoice'],
            'definition' => $definition,
        ], null));
        $this->templates->assign([
            'document_type' => 'tax_invoice',
            'usage' => $usage,
            'print_template_revision_id' => $template->published_revision_id,
        ], null);

        return $template->publishedRevision;
    }

    private function postCashInvoice(): Invoice
    {
        return $this->invoices->post($this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ));
    }

    /** @test */
    public function a_posted_invoice_keeps_the_exact_profile_of_the_revision_it_froze(): void
    {
        $print = $this->publishAndAssign(
            ['template_id' => 'tax-invoice-classic', 'output_profile' => ['paper' => 'a5']],
            'print',
            'قالب A5 للطباعة',
        );
        $this->publishAndAssign(
            ['template_id' => 'tax-invoice-minimal', 'output_profile' => ['paper' => 'a4', 'orientation' => 'landscape']],
            'pdf',
            'قالب PDF أفقي',
        );
        $thermal = $this->publishAndAssign(
            ['template_id' => 'tax-invoice-thermal80', 'output_profile' => ['paper' => 'thermal_80']],
            'thermal',
            'إيصال حراري',
        );

        $posted = $this->postCashInvoice();
        $this->assertSame($print->id, $posted->print_template_revision_id);
        $frozenChecksum = $print->checksum;

        // القالب نفسه يُعدَّل ويُنشر بمقاس مختلف، ويُعيَّن قالب جديد بعده.
        $template = $print->template;
        $this->templates->updateDraft($template, [
            'definition' => ['template_id' => 'tax-invoice-classic', 'output_profile' => ['paper' => 'a6']],
        ], null);
        $this->templates->publish($template);
        $this->publishAndAssign(
            ['template_id' => 'tax-invoice-retail', 'output_profile' => ['paper' => 'legal']],
            'print',
            'قالب لاحق',
        );

        $frozen = Invoice::with(['printTemplateRevision', 'pdfTemplateRevision', 'thermalTemplateRevision'])->findOrFail($posted->id);
        $this->assertSame($print->id, $frozen->print_template_revision_id);
        $this->assertSame('a5', $frozen->printTemplateRevision->definition['output_profile']['paper']);
        $this->assertSame($frozenChecksum, $frozen->printTemplateRevision->checksum);
        $this->assertSame('a4_landscape', $frozen->pdfTemplateRevision->definition['output_profile']['paper']);
        $this->assertSame($thermal->id, $frozen->thermal_template_revision_id);
        $this->assertSame('thermal_80', $frozen->thermalTemplateRevision->definition['output_profile']['paper']);
        $this->assertSame(PrintTemplateRevision::STATUS_SUPERSEDED, $frozen->printTemplateRevision->fresh()->status);
    }

    /** @test */
    public function a_historical_invoice_of_a_legacy_template_stays_without_a_profile(): void
    {
        $legacy = $this->publishAndAssign(
            ['template_id' => 'tax-invoice-classic', 'theme_id' => 'blue'],
            'print',
            'قالب تاريخي بلا ملف',
        );
        $posted = $this->postCashInvoice();

        // يأتي لاحقاً قالب بملف إخراج ويُعيَّن، ثم يُنشر تعديل على القالب القديم نفسه.
        $this->publishAndAssign(
            ['template_id' => 'tax-invoice-modern', 'output_profile' => ['paper' => 'a6']],
            'print',
            'قالب جديد بملف',
        );
        $this->templates->updateDraft($legacy->template, [
            'definition' => ['template_id' => 'tax-invoice-classic', 'output_profile' => ['paper' => 'a5']],
        ], null);
        $this->templates->publish($legacy->template);

        $frozen = Invoice::with('printTemplateRevision')->findOrFail($posted->id);
        $this->assertSame($legacy->id, $frozen->print_template_revision_id);
        $this->assertArrayNotHasKey('output_profile', $frozen->printTemplateRevision->definition);
        $this->assertSame(['template_id' => 'tax-invoice-classic', 'theme_id' => 'blue'], $frozen->printTemplateRevision->definition);
    }

    /** @test */
    public function resolving_output_revisions_returns_the_assigned_revision_ids_and_never_a_profile(): void
    {
        $revision = $this->publishAndAssign(
            ['template_id' => 'tax-invoice-classic', 'output_profile' => ['paper' => 'a5']],
            'print',
            'قالب A5',
        );

        $resolved = $this->templates->resolveOutputRevisionIds('tax_invoice', null);

        // عقد الحل القائم لم يتغيّر: معرّفات مراجعات فقط؛ المستهلك يقرأ الملف من المراجعة المثبّتة.
        $this->assertSame([
            'print_template_revision_id' => $revision->id,
            'pdf_template_revision_id' => null,
            'thermal_template_revision_id' => null,
        ], $resolved);
    }
}
