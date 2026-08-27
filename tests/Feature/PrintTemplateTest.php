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
    public function template_details_return_the_full_revision_history_in_descending_version_order(): void
    {
        ['token' => $token] = $this->registerTenant('template-history', 'owner@template-history.test');

        $created = $this->withToken($token)->postJson('/api/print-templates', [
            'name' => 'قالب له سجل مراجعات',
            'document_types' => ['tax_invoice'],
            'definition' => $this->definition('classic'),
        ])->assertCreated();
        $templateId = $created['data']['id'];

        $this->withToken($token)->postJson("/api/print-templates/{$templateId}/publish")->assertOk();
        $this->withToken($token)->putJson("/api/print-templates/{$templateId}/draft", [
            'definition' => $this->definition('modern'),
        ])->assertOk();

        $this->withToken($token)->getJson("/api/print-templates/{$templateId}")
            ->assertOk()
            ->assertJsonPath('data.revisions.0.version', 2)
            ->assertJsonPath('data.revisions.0.status', 'draft')
            ->assertJsonPath('data.revisions.0.definition.template', 'modern')
            ->assertJsonPath('data.revisions.1.version', 1)
            ->assertJsonPath('data.revisions.1.status', 'published')
            ->assertJsonPath('data.revisions.1.definition.template', 'classic');
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
    public function thermal_assignment_rejects_a_non_thermal_revision_and_can_return_to_engine_fallback(): void
    {
        ['token' => $token] = $this->registerTenant('thermal-assignment-guard', 'owner@thermal-assignment-guard.test');

        $nonThermal = $this->withToken($token)->postJson('/api/print-templates', [
            'name' => 'قالب صفحة غير حراري',
            'document_types' => ['tax_invoice'],
            'definition' => ['template_id' => 'tax-invoice-classic'],
        ])->assertCreated();
        $nonThermalRevisionId = $this->withToken($token)
            ->postJson('/api/print-templates/'.$nonThermal['data']['id'].'/publish')
            ->assertOk()['data']['published_revision']['id'];

        $this->withToken($token)->putJson('/api/print-templates/assignments/default', [
            'document_type' => 'tax_invoice',
            'usage' => 'thermal',
            'print_template_revision_id' => $nonThermalRevisionId,
        ])->assertUnprocessable();

        $thermal = $this->withToken($token)->postJson('/api/print-templates', [
            'name' => 'قالب حراري صالح',
            'document_types' => ['tax_invoice'],
            'definition' => ['template_id' => 'tax-invoice-thermal80'],
        ])->assertCreated();
        $thermalRevisionId = $this->withToken($token)
            ->postJson('/api/print-templates/'.$thermal['data']['id'].'/publish')
            ->assertOk()['data']['published_revision']['id'];

        $this->withToken($token)->putJson('/api/print-templates/assignments/default', [
            'document_type' => 'tax_invoice',
            'usage' => 'thermal',
            'print_template_revision_id' => $thermalRevisionId,
        ])->assertOk()->assertJsonPath('data.print_template_revision_id', $thermalRevisionId);
        $this->withToken($token)->deleteJson('/api/print-templates/assignments/default', [
            'document_type' => 'tax_invoice',
            'usage' => 'thermal',
        ])->assertOk()->assertJsonPath('data', null);

        $this->withToken($token)
            ->getJson('/api/print-templates/resolve?document_type=tax_invoice&usage=thermal')
            ->assertOk()
            ->assertJsonPath('data', null);
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
    public function thermal_assignment_rejects_a_published_revision_from_another_tenant(): void
    {
        ['token' => $aToken] = $this->registerTenant('thermal-alpha', 'owner@thermal-alpha.test');
        ['token' => $bToken] = $this->registerTenant('thermal-beta', 'owner@thermal-beta.test');

        $template = $this->withToken($aToken)->postJson('/api/print-templates', [
            'name' => 'إيصال ألفا الحراري',
            'document_types' => ['tax_invoice'],
            'definition' => ['template_id' => 'tax-invoice-thermal80'],
        ])->assertCreated();
        $foreignRevisionId = $this->withToken($aToken)
            ->postJson('/api/print-templates/'.$template['data']['id'].'/publish')
            ->assertOk()['data']['published_revision']['id'];

        $this->withToken($bToken)->putJson('/api/print-templates/assignments/default', [
            'document_type' => 'tax_invoice',
            'usage' => 'thermal',
            'print_template_revision_id' => $foreignRevisionId,
        ])->assertUnprocessable();
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
                    ['id' => 'product_code', 'label' => 'رمز الصنف'],
                    ['id' => 'barcode'],
                    ['id' => 'quantity'],
                    ['id' => 'price_before_tax', 'alignment' => 'end'],
                    ['id' => 'total', 'label' => 'الإجمالي'],
                ],
            ]],
            ['key' => 'summary', 'visible' => true],
            ['key' => 'terms', 'visible' => true, 'properties' => ['alignment' => 'center', 'static_content' => 'الشروط الثابتة']],
            ['key' => 'bank', 'visible' => true, 'properties' => ['font_size' => 'sm', 'static_content' => 'IBAN: SA00']],
            ['key' => 'stamp', 'visible' => true, 'properties' => ['image_size' => 'lg', 'image_opacity' => 'soft']],
            ['key' => 'signature', 'visible' => true, 'properties' => ['image_size' => 'sm', 'image_opacity' => 'solid']],
            ['key' => 'footer', 'visible' => true, 'properties' => ['alignment' => 'end', 'static_content' => 'نص تذييل ثابت']],
        ];

        $created = $this->withToken($token)->postJson('/api/print-templates', [
            'name' => 'خصائص متقدمة',
            'document_types' => ['tax_invoice'],
            'definition' => ['layout' => $layout],
        ])->assertCreated()
            ->assertJsonPath('data.draft_revision.definition.layout.2.properties.columns.1.label', 'الصنف')
            ->assertJsonPath('data.draft_revision.definition.layout.2.properties.columns.2.id', 'product_code')
            ->assertJsonPath('data.draft_revision.definition.layout.2.properties.columns.3.id', 'barcode')
            ->assertJsonPath('data.draft_revision.definition.layout.2.properties.columns.5.id', 'price_before_tax')
            ->assertJsonPath('data.draft_revision.definition.layout.6.properties.image_size', 'lg')
            ->assertJsonPath('data.draft_revision.definition.layout.6.properties.image_opacity', 'soft')
            ->assertJsonPath('data.draft_revision.definition.layout.7.properties.image_size', 'sm')
            ->assertJsonPath('data.draft_revision.definition.layout.7.properties.image_opacity', 'solid')
            ->assertJsonPath('data.draft_revision.definition.layout.8.properties.static_content', 'نص تذييل ثابت');

        $templateId = $created['data']['id'];
        $this->withToken($token)->putJson("/api/print-templates/{$templateId}/draft", [
            'name' => 'خصائص متقدمة محدثة',
            'document_types' => ['tax_invoice'],
            'definition' => ['layout' => $layout],
        ])->assertOk()
            ->assertJsonPath('data.draft_revision.definition.layout.2.properties.columns.2.id', 'product_code')
            ->assertJsonPath('data.draft_revision.definition.layout.2.properties.columns.3.id', 'barcode')
            ->assertJsonPath('data.draft_revision.definition.layout.2.properties.columns.5.id', 'price_before_tax');

        $revisionId = $this->withToken($token)->postJson("/api/print-templates/{$templateId}/publish")
            ->assertOk()['data']['published_revision']['id'];
        $published = PrintTemplateRevision::findOrFail($revisionId);
        $this->assertSame('الشروط الثابتة', $published->definition['layout'][4]['properties']['static_content']);
        $this->assertSame('lg', $published->definition['layout'][6]['properties']['image_size']);
        $this->assertSame('soft', $published->definition['layout'][6]['properties']['image_opacity']);
        $this->assertSame('sm', $published->definition['layout'][7]['properties']['image_size']);
        $this->assertSame('solid', $published->definition['layout'][7]['properties']['image_opacity']);

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
            'name' => 'حجم صورة غير صالح',
            'document_types' => ['tax_invoice'],
            'definition' => ['layout' => [
                ['key' => 'header', 'visible' => true],
                ['key' => 'parties', 'visible' => true],
                ['key' => 'items', 'visible' => true],
                ['key' => 'summary', 'visible' => true],
                ['key' => 'stamp', 'visible' => true, 'properties' => ['image_size' => 'xl']],
                ['key' => 'footer', 'visible' => true],
            ]],
        ])->assertUnprocessable();

        $this->withToken($token)->postJson('/api/print-templates', [
            'name' => 'شفافية صورة غير صالحة',
            'document_types' => ['tax_invoice'],
            'definition' => ['layout' => [
                ['key' => 'header', 'visible' => true],
                ['key' => 'parties', 'visible' => true],
                ['key' => 'items', 'visible' => true],
                ['key' => 'summary', 'visible' => true],
                ['key' => 'signature', 'visible' => true, 'properties' => ['image_opacity' => 'transparent']],
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

    /** @test */
    public function migrated_legacy_design_is_upgraded_to_current_revisions_without_mutating_its_original_snapshot(): void
    {
        ['tenant_id' => $tenantId] = $this->registerTenant('legacy-upgrade', 'owner@legacy-upgrade.test');
        app(TenantContext::class)->set($tenantId);

        $legacy = [
            'template' => 'modern',
            'theme' => 'green',
            'show_logo' => false,
            'logo_height' => 72,
            'footer_text' => 'تذييل موروث',
            'terms_text' => 'شروط موروثة',
            'bank_text' => 'IBAN SA0000000000000000000000',
            'stamp' => 'data:image/png;base64,stamp',
            'signature' => 'data:image/png;base64,signature',
            'sections' => [
                ['key' => 'header', 'visible' => true],
                ['key' => 'parties', 'visible' => true],
                ['key' => 'items', 'visible' => true],
                ['key' => 'summary', 'visible' => true],
                ['key' => 'footer', 'visible' => true],
            ],
        ];
        Tenant::findOrFail($tenantId)->update(['settings' => ['sales_config' => ['designs' => $legacy]]]);

        $initialMigration = require base_path('database/migrations/2025_01_01_000058_migrate_legacy_print_designs.php');
        $initialMigration->up();
        $template = PrintTemplate::where('source', 'migrated')->firstOrFail();
        $originalRevision = $template->publishedRevision;

        $upgradeMigration = require base_path('database/migrations/2025_01_01_000068_upgrade_migrated_print_template_definitions.php');
        $upgradeMigration->up();

        $template->refresh()->load('publishedRevision');
        $this->assertNotSame($originalRevision->id, $template->published_revision_id);
        $original = PrintTemplateRevision::findOrFail($originalRevision->id);
        $this->assertSame('superseded', $original->status);
        $this->assertSame(['schema_version' => 1, 'legacy_sales_designs' => $legacy], $original->definition);
        $this->assertSame('tax-invoice-modern', $template->publishedRevision->definition['template_id']);
        $this->assertSame('green', $template->publishedRevision->definition['theme_id']);
        $this->assertSame(72, $template->publishedRevision->definition['logo_height']);
        $this->assertSame('data:image/png;base64,stamp', $template->publishedRevision->definition['stamp']);
        $this->assertSame('data:image/png;base64,signature', $template->publishedRevision->definition['signature']);

        $assignments = $template->assignments()->whereNull('branch_id')->where('usage', 'print')->get();
        $this->assertSame(['tax_invoice'], $assignments->pluck('document_type')->sort()->values()->all());
        $this->assertSame($template->published_revision_id, $assignments->first()->print_template_revision_id);
        $this->assertSame($legacy, Tenant::findOrFail($tenantId)->settings['sales_config']['designs']);

        $compatibilityTypes = PrintTemplate::where('source', 'migrated')
            ->where('id', '!=', $template->id)
            ->get()
            ->flatMap(fn (PrintTemplate $compatibility) => $compatibility->assignments()->whereNull('branch_id')->where('usage', 'print')->pluck('document_type'))
            ->sort()
            ->values()
            ->all();
        $this->assertSame(['credit_note', 'debit_note', 'payment_voucher', 'quotation', 'receipt_voucher'], $compatibilityTypes);
    }

    /** @test */
    public function migrated_upgrade_preserves_an_existing_company_assignment_for_a_compatibility_type(): void
    {
        ['token' => $token, 'tenant_id' => $tenantId] = $this->registerTenant('legacy-upgrade-explicit', 'owner@legacy-upgrade-explicit.test');
        app(TenantContext::class)->set($tenantId);
        Tenant::findOrFail($tenantId)->update(['settings' => ['sales_config' => ['designs' => ['template' => 'classic']]]]);

        $initialMigration = require base_path('database/migrations/2025_01_01_000058_migrate_legacy_print_designs.php');
        $initialMigration->up();

        $created = $this->withToken($token)->postJson('/api/print-templates', [
            'name' => 'عرض سعر مؤسسي صريح',
            'document_types' => ['quotation'],
            'definition' => $this->definition(),
        ])->assertCreated();
        $templateId = $created['data']['id'];
        $published = $this->withToken($token)->postJson("/api/print-templates/{$templateId}/publish")->assertOk();
        $explicitRevisionId = $published['data']['published_revision']['id'];

        $this->withToken($token)->putJson('/api/print-templates/assignments/default', [
            'document_type' => 'quotation',
            'usage' => 'print',
            'print_template_revision_id' => $explicitRevisionId,
        ])->assertOk();

        $upgradeMigration = require base_path('database/migrations/2025_01_01_000068_upgrade_migrated_print_template_definitions.php');
        $upgradeMigration->up();

        $assignment = PrintTemplate::findOrFail($templateId)->assignments()
            ->whereNull('branch_id')
            ->where('document_type', 'quotation')
            ->where('usage', 'print')
            ->get();
        $this->assertCount(1, $assignment);
        $this->assertSame($explicitRevisionId, $assignment->sole()->print_template_revision_id);
        $this->assertSame(0, PrintTemplate::where('source', 'migrated')
            ->whereJsonContains('document_types', 'quotation')
            ->count());
    }

    /** @test */
    public function live_resolution_endpoint_prefers_branch_then_falls_back_to_company_assignment(): void
    {
        ['token' => $token, 'tenant_id' => $tenantId] = $this->registerTenant('template-live-resolution', 'owner@template-live-resolution.test');

        $company = $this->withToken($token)->postJson('/api/print-templates', [
            'name' => 'قالب المؤسسة الحي',
            'document_types' => ['tax_invoice'],
            'definition' => $this->definition('classic'),
        ])->assertCreated();
        $companyRevisionId = $this->withToken($token)
            ->postJson('/api/print-templates/'.$company['data']['id'].'/publish')
            ->assertOk()['data']['published_revision']['id'];

        $branchTemplate = $this->withToken($token)->postJson('/api/print-templates', [
            'name' => 'قالب الفرع الحي',
            'document_types' => ['tax_invoice'],
            'definition' => $this->definition('modern'),
        ])->assertCreated();
        $branchRevisionId = $this->withToken($token)
            ->postJson('/api/print-templates/'.$branchTemplate['data']['id'].'/publish')
            ->assertOk()['data']['published_revision']['id'];

        app(TenantContext::class)->set($tenantId);
        $riyadh = Branch::create(['name' => 'الرياض', 'code' => '90003']);
        $khobar = Branch::create(['name' => 'الخبر', 'code' => '90004']);

        $this->withToken($token)->putJson('/api/print-templates/assignments/default', [
            'document_type' => 'tax_invoice',
            'usage' => 'print',
            'print_template_revision_id' => $companyRevisionId,
        ])->assertOk();
        $this->withToken($token)->putJson('/api/print-templates/assignments/default', [
            'branch_id' => $riyadh->id,
            'document_type' => 'tax_invoice',
            'usage' => 'print',
            'print_template_revision_id' => $branchRevisionId,
        ])->assertOk();

        $this->withToken($token)->getJson('/api/print-templates/resolve?document_type=tax_invoice&usage=print&branch_id='.$riyadh->id)
            ->assertOk()
            ->assertJsonPath('data.scope', 'branch')
            ->assertJsonPath('data.branch_id', $riyadh->id)
            ->assertJsonPath('data.print_template_revision_id', $branchRevisionId)
            ->assertJsonPath('data.revision.id', $branchRevisionId)
            ->assertJsonPath('data.revision.definition.template', 'modern');

        $this->withToken($token)->getJson('/api/print-templates/resolve?document_type=tax_invoice&usage=print&branch_id='.$khobar->id)
            ->assertOk()
            ->assertJsonPath('data.scope', 'company')
            ->assertJsonPath('data.branch_id', null)
            ->assertJsonPath('data.print_template_revision_id', $companyRevisionId);
    }

    /** @test */
    public function live_resolution_endpoint_returns_null_when_no_assignment_exists(): void
    {
        ['token' => $token] = $this->registerTenant('template-live-empty', 'owner@template-live-empty.test');

        $this->withToken($token)->getJson('/api/print-templates/resolve?document_type=tax_invoice&usage=print')
            ->assertOk()
            ->assertJsonPath('data', null);
    }

    /** @test */
    public function live_resolution_endpoint_rejects_an_unknown_or_foreign_branch(): void
    {
        ['token' => $token] = $this->registerTenant('template-live-branch-guard', 'owner@template-live-branch-guard.test');

        $this->withToken($token)->getJson('/api/print-templates/resolve?document_type=tax_invoice&usage=print&branch_id=00000000-0000-0000-0000-000000000001')
            ->assertUnprocessable();
    }
}
