<?php

namespace Tests\Feature;

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
