<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\PrintTemplate;
use App\Models\PrintTemplateRevision;
use App\Models\Tenant;
use App\Services\PrintTemplates\PrintTemplateService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PrintTemplateTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function definition(string $template = 'classic'): array
    {
        return [
            'page' => ['size' => 'a4', 'direction' => 'rtl'],
            'template' => $template,
        ];
    }

    /** @test */
    public function owner_creates_a_draft_template_with_a_versioned_revision(): void
    {
        ['token' => $token] = $this->registerTenant('templates', 'owner@templates.test');

        $this->withToken($token)->postJson('/api/print-templates', [
            'name' => 'فاتورة الشركات',
            'document_types' => ['tax_invoice', 'quotation'],
            'definition' => $this->definition(),
        ])->assertCreated()
            ->assertJsonPath('data.name', 'فاتورة الشركات')
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.draft_revision.version', 1)
            ->assertJsonPath('data.draft_revision.status', 'draft')
            ->assertJsonPath('data.draft_revision.document_types.0', 'quotation');

        $template = PrintTemplate::firstOrFail();
        $this->assertSame(['quotation', 'tax_invoice'], $template->document_types);
        $this->assertSame(1, $template->revisions()->count());
        $this->assertSame(64, strlen((string) $template->draftRevision->checksum));
    }

    /** @test */
    public function staff_cannot_create_or_publish_print_templates(): void
    {
        ['tenant_id' => $tenantId] = $this->registerTenant('templates', 'owner@templates.test');
        $staff = $this->tokenForRole($tenantId, 'staff', 'staff@templates.test');

        $this->withToken($staff)->postJson('/api/print-templates', [
            'name' => 'ممنوع',
            'document_types' => ['tax_invoice'],
            'definition' => $this->definition(),
        ])->assertForbidden();
    }

    /** @test */
    public function publishing_freezes_the_revision_and_a_later_edit_creates_a_new_draft(): void
    {
        ['token' => $token] = $this->registerTenant('templates', 'owner@templates.test');

        $created = $this->withToken($token)->postJson('/api/print-templates', [
            'name' => 'فاتورة ثابتة',
            'document_types' => ['tax_invoice'],
            'definition' => $this->definition(),
        ])->assertCreated();
        $templateId = $created['data']['id'];
        $publishedId = $created['data']['draft_revision']['id'];

        $this->withToken($token)->postJson("/api/print-templates/{$templateId}/publish")
            ->assertOk()
            ->assertJsonPath('data.status', 'published')
            ->assertJsonPath('data.published_revision.id', $publishedId)
            ->assertJsonPath('data.published_revision.status', 'published');

        $this->withToken($token)->putJson("/api/print-templates/{$templateId}/draft", [
            'definition' => $this->definition('modern'),
        ])->assertOk()
            ->assertJsonPath('data.status', 'published')
            ->assertJsonPath('data.draft_revision.version', 2)
            ->assertJsonPath('data.draft_revision.status', 'draft')
            ->assertJsonPath('data.published_revision.id', $publishedId);

        $published = PrintTemplateRevision::findOrFail($publishedId);
        $this->assertSame(PrintTemplateRevision::STATUS_PUBLISHED, $published->status);
        $this->assertSame('classic', $published->definition['template']);
        $this->assertSame(2, PrintTemplateRevision::where('print_template_id', $templateId)->count());
    }

    /** @test */
    public function duplicating_a_template_creates_an_independent_draft_from_the_published_revision(): void
    {
        ['token' => $token] = $this->registerTenant('template-copy', 'owner@template-copy.test');

        $created = $this->withToken($token)->postJson('/api/print-templates', [
            'name' => 'القالب المصدر',
            'document_types' => ['tax_invoice'],
            'definition' => $this->definition('classic'),
        ])->assertCreated();
        $sourceId = $created['data']['id'];
        $this->withToken($token)->postJson("/api/print-templates/{$sourceId}/publish")->assertOk();

        $this->withToken($token)->postJson("/api/print-templates/{$sourceId}/duplicate", [
            'name' => 'نسخة قابلة للتعديل',
        ])->assertCreated()
            ->assertJsonPath('data.name', 'نسخة قابلة للتعديل')
            ->assertJsonPath('data.source', 'custom')
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.draft_revision.version', 1)
            ->assertJsonPath('data.draft_revision.definition.template', 'classic');

        $source = PrintTemplate::with('revisions')->findOrFail($sourceId);
        $this->assertSame(1, $source->revisions->count());
        $this->assertSame('published', $source->status);
    }

    /** @test */
    public function only_published_revisions_can_be_assigned_and_the_service_resolves_company_default(): void
    {
        ['token' => $token, 'tenant_id' => $tenantId] = $this->registerTenant('templates', 'owner@templates.test');

        $created = $this->withToken($token)->postJson('/api/print-templates', [
            'name' => 'قالب التعيين',
            'document_types' => ['tax_invoice'],
            'definition' => $this->definition(),
        ])->assertCreated();
        $templateId = $created['data']['id'];
        $draftId = $created['data']['draft_revision']['id'];

        $this->withToken($token)->putJson('/api/print-templates/assignments/default', [
            'document_type' => 'tax_invoice',
            'print_template_revision_id' => $draftId,
        ])->assertUnprocessable();

        $published = $this->withToken($token)->postJson("/api/print-templates/{$templateId}/publish")->assertOk();
        $revisionId = $published['data']['published_revision']['id'];

        $this->withToken($token)->putJson('/api/print-templates/assignments/default', [
            'document_type' => 'tax_invoice',
            'print_template_revision_id' => $revisionId,
        ])->assertOk()
            ->assertJsonPath('data.scope', 'company')
            ->assertJsonPath('data.print_template_revision_id', $revisionId);

        app(TenantContext::class)->set($tenantId);
        $resolved = app(PrintTemplateService::class)->resolve('tax_invoice', 'print', null);
        $this->assertNotNull($resolved);
        $this->assertSame($revisionId, $resolved->print_template_revision_id);
    }

    /** @test */
    public function a_branch_assignment_overrides_the_company_default_and_other_branches_fall_back(): void
    {
        ['token' => $token, 'tenant_id' => $tenantId] = $this->registerTenant('template-branches', 'owner@template-branches.test');

        $company = $this->withToken($token)->postJson('/api/print-templates', [
            'name' => 'قالب المؤسسة',
            'document_types' => ['tax_invoice'],
            'definition' => $this->definition('classic'),
        ])->assertCreated();
        $companyTemplateId = $company['data']['id'];
        $companyRevisionId = $this->withToken($token)
            ->postJson("/api/print-templates/{$companyTemplateId}/publish")
            ->assertOk()['data']['published_revision']['id'];

        $branchTemplate = $this->withToken($token)->postJson('/api/print-templates', [
            'name' => 'قالب الفرع',
            'document_types' => ['tax_invoice'],
            'definition' => $this->definition('modern'),
        ])->assertCreated();
        $branchTemplateId = $branchTemplate['data']['id'];
        $branchRevisionId = $this->withToken($token)
            ->postJson("/api/print-templates/{$branchTemplateId}/publish")
            ->assertOk()['data']['published_revision']['id'];

        app(TenantContext::class)->set($tenantId);
        $riyadh = Branch::create(['name' => 'الرياض', 'code' => '90001']);
        $khobar = Branch::create(['name' => 'الخبر', 'code' => '90002']);

        $this->withToken($token)->putJson('/api/print-templates/assignments/default', [
            'document_type' => 'tax_invoice',
            'usage' => 'print',
            'print_template_revision_id' => $companyRevisionId,
        ])->assertOk()->assertJsonPath('data.scope', 'company');

        $this->withToken($token)->putJson('/api/print-templates/assignments/default', [
            'branch_id' => $riyadh->id,
            'document_type' => 'tax_invoice',
            'usage' => 'print',
            'print_template_revision_id' => $branchRevisionId,
        ])->assertOk()
            ->assertJsonPath('data.scope', 'branch')
            ->assertJsonPath('data.branch_id', $riyadh->id)
            ->assertJsonPath('data.print_template_revision_id', $branchRevisionId);

        app(TenantContext::class)->set($tenantId);
        $templates = app(PrintTemplateService::class);
        $this->assertSame($branchRevisionId, $templates->resolve('tax_invoice', 'print', $riyadh->id)?->print_template_revision_id);
        $this->assertSame($companyRevisionId, $templates->resolve('tax_invoice', 'print', $khobar->id)?->print_template_revision_id);
        $this->assertSame($companyRevisionId, $templates->resolve('tax_invoice', 'print', null)?->print_template_revision_id);
    }

    /** @test */
    public function templates_are_tenant_isolated(): void
    {
        ['token' => $aToken] = $this->registerTenant('alpha', 'owner@alpha.test');
        ['token' => $bToken] = $this->registerTenant('beta', 'owner@beta.test');

        $this->withToken($aToken)->postJson('/api/print-templates', [
            'name' => 'قالب ألفا',
            'document_types' => ['tax_invoice'],
            'definition' => $this->definition(),
        ])->assertCreated();

        $this->withToken($bToken)->getJson('/api/print-templates')
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }

    /** @test */
    public function template_layout_rejects_unsupported_duplicate_and_hidden_required_blocks(): void
    {
        ['token' => $token] = $this->registerTenant('template-layout', 'owner@template-layout.test');

        $requiredLayout = [
            ['key' => 'header', 'visible' => true],
            ['key' => 'parties', 'visible' => true],
            ['key' => 'items', 'visible' => true],
            ['key' => 'summary', 'visible' => true],
            ['key' => 'footer', 'visible' => true],
        ];

        $this->withToken($token)->postJson('/api/print-templates', [
            'name' => 'كتلة غير مدعومة',
            'document_types' => ['receipt_voucher'],
            'definition' => ['layout' => [...$requiredLayout, ['key' => 'items', 'visible' => true]]],
        ])->assertUnprocessable();

        $this->withToken($token)->postJson('/api/print-templates', [
            'name' => 'كتلة مكررة',
            'document_types' => ['tax_invoice'],
            'definition' => ['layout' => [...$requiredLayout, ['key' => 'footer', 'visible' => true]]],
        ])->assertUnprocessable();

        $hiddenSummary = array_map(
            static fn (array $item): array => $item['key'] === 'summary' ? [...$item, 'visible' => false] : $item,
            $requiredLayout,
        );
        $this->withToken($token)->postJson('/api/print-templates', [
            'name' => 'إخفاء كتلة إلزامية',
            'document_types' => ['tax_invoice'],
            'definition' => ['layout' => $hiddenSummary],
        ])->assertUnprocessable();
    }

    /** @test */
    public function template_layout_persists_supported_advanced_block_properties_and_rejects_invalid_ones(): void
    {
        ['token' => $token] = $this->registerTenant('template-properties', 'owner@template-properties.test');

        $layout = [
            ['key' => 'header', 'visible' => true],
            ['key' => 'parties', 'visible' => true],
            ['key' => 'items', 'visible' => true, 'properties' => [
                'font_size' => 'md',
                'columns' => [
                    ['id' => 'number', 'alignment' => 'center'],
                    ['id' => 'description', 'label' => 'الصنف'],
                    ['id' => 'quantity'],
                    ['id' => 'total', 'label' => 'الإجمالي'],
                ],
            ]],
            ['key' => 'summary', 'visible' => true],
            ['key' => 'terms', 'visible' => true, 'properties' => ['alignment' => 'center', 'static_content' => 'الشروط الثابتة']],
            ['key' => 'bank', 'visible' => true, 'properties' => ['font_size' => 'sm', 'static_content' => 'IBAN: SA00']],
            ['key' => 'footer', 'visible' => true, 'properties' => ['alignment' => 'end', 'static_content' => 'نص تذييل ثابت']],
        ];

        $created = $this->withToken($token)->postJson('/api/print-templates', [
            'name' => 'خصائص متقدمة',
            'document_types' => ['tax_invoice'],
            'definition' => ['layout' => $layout],
        ])->assertCreated()
            ->assertJsonPath('data.draft_revision.definition.layout.2.properties.columns.1.label', 'الصنف')
            ->assertJsonPath('data.draft_revision.definition.layout.6.properties.static_content', 'نص تذييل ثابت');

        $templateId = $created['data']['id'];
        $revisionId = $this->withToken($token)->postJson("/api/print-templates/{$templateId}/publish")
            ->assertOk()['data']['published_revision']['id'];
        $published = PrintTemplateRevision::findOrFail($revisionId);
        $this->assertSame('الشروط الثابتة', $published->definition['layout'][4]['properties']['static_content']);

        $this->withToken($token)->postJson('/api/print-templates', [
            'name' => 'خاصية غير مدعومة',
            'document_types' => ['tax_invoice'],
            'definition' => ['layout' => [
                ['key' => 'header', 'visible' => true, 'properties' => ['static_content' => 'غير مسموح']],
                ['key' => 'parties', 'visible' => true],
                ['key' => 'items', 'visible' => true],
                ['key' => 'summary', 'visible' => true],
                ['key' => 'footer', 'visible' => true],
            ]],
        ])->assertUnprocessable();

        $this->withToken($token)->postJson('/api/print-templates', [
            'name' => 'عمود إلزامي مفقود',
            'document_types' => ['tax_invoice'],
            'definition' => ['layout' => [
                ['key' => 'header', 'visible' => true],
                ['key' => 'parties', 'visible' => true],
                ['key' => 'items', 'visible' => true, 'properties' => ['columns' => [['id' => 'description']]]],
                ['key' => 'summary', 'visible' => true],
                ['key' => 'footer', 'visible' => true],
            ]],
        ])->assertUnprocessable();
    }

    /** @test */
    public function legacy_sales_design_is_copied_without_removing_the_legacy_setting(): void
    {
        ['tenant_id' => $tenantId] = $this->registerTenant('legacy', 'owner@legacy.test');
        app(TenantContext::class)->set($tenantId);

        $tenant = Tenant::findOrFail($tenantId);
        $legacy = ['template' => 'classic', 'theme' => 'blue', 'show_logo' => true, 'footer_text' => 'شكراً'];
        $tenant->update(['settings' => ['sales_config' => ['designs' => $legacy]]]);

        $migration = require base_path('database/migrations/2025_01_01_000058_migrate_legacy_print_designs.php');
        $migration->up();

        $template = PrintTemplate::where('source', 'migrated')->firstOrFail();
        $this->assertSame('published', $template->status);
        $this->assertSame('classic', $template->publishedRevision->definition['legacy_sales_designs']['template']);
        $this->assertSame($legacy, Tenant::findOrFail($tenantId)->settings['sales_config']['designs']);
        $this->assertSame(1, $template->assignments()->whereNull('branch_id')->count());
    }
}
