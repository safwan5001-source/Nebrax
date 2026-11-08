<?php

namespace Tests\Feature;

use App\Models\PrintTemplate;
use App\Models\PrintTemplateRevision;
use App\Services\PrintTemplates\PrintTemplateService;
use App\Support\PrintTemplateContract;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Output Profile عبر واجهة قوالب الطباعة (DOC-V2-PR3A): الحفظ، الرفض، الصلاحيات،
 * عزل المستأجرين، ثبات المراجعة المنشورة، والتوافق مع قوالب بلا ملف.
 * تشغيل:  php artisan test --filter=PrintTemplateOutputProfileTest
 */
class PrintTemplateOutputProfileTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function create(string $token, array $definition, string $name = 'قالب بملف إخراج'): \Illuminate\Testing\TestResponse
    {
        return $this->withToken($token)->postJson('/api/print-templates', [
            'name' => $name,
            'document_types' => ['tax_invoice'],
            'definition' => $definition,
        ]);
    }

    /** @test */
    public function a_profile_is_stored_normalized_inside_the_revision_definition(): void
    {
        ['token' => $token] = $this->registerTenant('op-store', 'owner@op-store.test');

        $response = $this->create($token, [
            'template_id' => 'tax-invoice-classic',
            'output_profile' => ['paper' => 'a5', 'orientation' => 'landscape', 'margins_mm' => ['top' => 12]],
        ])->assertCreated();

        $this->assertEquals([
            'version' => 1,
            'paper' => 'a5_landscape',
            'orientation' => 'landscape',
            'output_mode' => 'page',
            'margins_mm' => ['top' => 12, 'right' => 10, 'bottom' => 10, 'left' => 10],
        ], $response->json('data.draft_revision.definition.output_profile'));

        // لا جدول ولا عمود: المخزَّن هو التعريف نفسه والبصمة تغطيه.
        $revision = PrintTemplateRevision::firstOrFail();
        $this->assertSame('a5_landscape', $revision->definition['output_profile']['paper']);
        $this->assertSame(PrintTemplateContract::checksum($revision->definition), $revision->checksum);
    }

    /** @test */
    public function a_template_without_a_profile_behaves_exactly_as_before(): void
    {
        ['token' => $token] = $this->registerTenant('op-legacy', 'owner@op-legacy.test');
        $definition = ['page' => ['size' => 'a4', 'direction' => 'rtl'], 'template' => 'classic'];

        $response = $this->create($token, $definition)->assertCreated();

        $stored = $response->json('data.draft_revision.definition');
        $this->assertArrayNotHasKey('output_profile', $stored);
        $this->assertEquals($definition['page'], $stored['page']);
        // البصمة هي بصمة التعريف كما أُرسل — لا مفتاح مُضاف ولا افتراضي مُدرَج.
        $this->assertSame(
            PrintTemplateContract::checksum($definition),
            $response->json('data.draft_revision.checksum'),
        );
    }

    /** @test */
    public function editing_a_legacy_template_never_injects_a_profile(): void
    {
        ['token' => $token] = $this->registerTenant('op-legacy-edit', 'owner@op-legacy-edit.test');
        $id = $this->create($token, ['template_id' => 'tax-invoice-classic'])->assertCreated()->json('data.id');
        $this->withToken($token)->postJson("/api/print-templates/{$id}/publish")->assertOk();

        $this->withToken($token)->putJson("/api/print-templates/{$id}/draft", ['name' => 'اسم جديد'])
            ->assertOk();

        $draft = PrintTemplate::findOrFail($id)->draftRevision;
        $this->assertArrayNotHasKey('output_profile', $draft->definition);
        $this->assertSame(['template_id' => 'tax-invoice-classic'], $draft->definition);
    }

    /** @test */
    public function invalid_profiles_are_rejected_with_422_and_nothing_is_stored(): void
    {
        ['token' => $token] = $this->registerTenant('op-reject', 'owner@op-reject.test');

        $bad = [
            'unknown paper' => ['paper' => 'a3'],
            'raw css key' => ['paper' => 'a4', 'css' => '@page{size:1px}'],
            'css in margin' => ['paper' => 'a4', 'margins_mm' => ['top' => '10mm']],
            'custom too wide' => ['paper' => 'custom', 'custom' => ['width_mm' => 500, 'height_mm' => 200]],
            'custom too small' => ['paper' => 'custom', 'custom' => ['width_mm' => 20, 'height_mm' => 20]],
            'roll for a4' => ['paper' => 'a4', 'output_mode' => 'roll'],
            'landscape letter' => ['paper' => 'letter', 'orientation' => 'landscape'],
            'margins eat the page' => ['paper' => 'thermal_58', 'margins_mm' => ['left' => 20, 'right' => 20]],
            'not an object' => 'a4',
        ];

        foreach ($bad as $label => $profile) {
            $this->create($token, ['template_id' => 'tax-invoice-classic', 'output_profile' => $profile], "مرفوض {$label}")
                ->assertUnprocessable();
        }

        $this->assertSame(0, PrintTemplate::count());
        $this->assertSame(0, PrintTemplateRevision::count());
    }

    /** @test */
    public function a_registered_thermal_template_rejects_a_profile_of_another_width(): void
    {
        ['token' => $token] = $this->registerTenant('op-thermal', 'owner@op-thermal.test');

        $this->create($token, ['template_id' => 'tax-invoice-thermal80', 'output_profile' => ['paper' => 'thermal_58']], 'حراري غير متطابق')
            ->assertUnprocessable();

        $this->create($token, ['template_id' => 'tax-invoice-thermal80', 'output_profile' => ['paper' => 'thermal_80']], 'حراري متطابق')
            ->assertCreated()
            ->assertJsonPath('data.draft_revision.definition.output_profile.paper', 'thermal_80')
            ->assertJsonPath('data.draft_revision.definition.output_profile.output_mode', 'roll');
    }

    /** @test */
    public function a_thermal_assignment_still_works_with_a_matching_profile(): void
    {
        ['token' => $token] = $this->registerTenant('op-thermal-assign', 'owner@op-thermal-assign.test');
        $id = $this->create($token, ['template_id' => 'tax-invoice-thermal58', 'output_profile' => ['paper' => 'thermal_58']], 'حراري 58')
            ->assertCreated()->json('data.id');
        $revisionId = $this->withToken($token)->postJson("/api/print-templates/{$id}/publish")
            ->assertOk()->json('data.published_revision.id');

        $this->withToken($token)->putJson('/api/print-templates/assignments/default', [
            'document_type' => 'tax_invoice',
            'usage' => 'thermal',
            'print_template_revision_id' => $revisionId,
        ])->assertOk();
    }

    /** @test */
    public function a_null_profile_clears_it_from_the_draft(): void
    {
        ['token' => $token] = $this->registerTenant('op-clear', 'owner@op-clear.test');
        $id = $this->create($token, ['template_id' => 'tax-invoice-classic', 'output_profile' => ['paper' => 'a6']])
            ->assertCreated()->json('data.id');

        $this->withToken($token)->putJson("/api/print-templates/{$id}/draft", [
            'definition' => ['template_id' => 'tax-invoice-classic', 'output_profile' => null],
        ])->assertOk();

        $this->assertArrayNotHasKey('output_profile', PrintTemplate::findOrFail($id)->draftRevision->definition);
    }

    /** @test */
    public function publishing_freezes_the_profile_and_a_later_edit_creates_a_new_draft(): void
    {
        ['token' => $token] = $this->registerTenant('op-freeze', 'owner@op-freeze.test');
        $created = $this->create($token, ['template_id' => 'tax-invoice-classic', 'output_profile' => ['paper' => 'a4']])
            ->assertCreated();
        $id = $created->json('data.id');
        $publishedId = $created->json('data.draft_revision.id');

        $this->withToken($token)->postJson("/api/print-templates/{$id}/publish")->assertOk();
        $before = PrintTemplateRevision::findOrFail($publishedId);
        $checksumBefore = $before->checksum;

        $this->withToken($token)->putJson("/api/print-templates/{$id}/draft", [
            'definition' => ['template_id' => 'tax-invoice-classic', 'output_profile' => ['paper' => 'a5', 'orientation' => 'landscape']],
        ])->assertOk()
            ->assertJsonPath('data.draft_revision.version', 2)
            ->assertJsonPath('data.draft_revision.definition.output_profile.paper', 'a5_landscape')
            ->assertJsonPath('data.published_revision.id', $publishedId)
            ->assertJsonPath('data.published_revision.definition.output_profile.paper', 'a4');

        $after = PrintTemplateRevision::findOrFail($publishedId);
        $this->assertSame('a4', $after->definition['output_profile']['paper']);
        $this->assertSame($checksumBefore, $after->checksum);
        $this->assertSame(PrintTemplateRevision::STATUS_PUBLISHED, $after->status);

        // ولا مسار مباشر لتعديل ملف إخراج منشور.
        $this->expectException(\RuntimeException::class);
        $after->update(['definition' => ['template_id' => 'tax-invoice-classic', 'output_profile' => ['paper' => 'a6']]]);
    }

    /** @test */
    public function a_draft_cloned_from_a_published_revision_inherits_its_profile(): void
    {
        ['token' => $token] = $this->registerTenant('op-inherit', 'owner@op-inherit.test');
        $id = $this->create($token, ['template_id' => 'tax-invoice-classic', 'output_profile' => ['paper' => 'legal']])
            ->assertCreated()->json('data.id');
        $this->withToken($token)->postJson("/api/print-templates/{$id}/publish")->assertOk();

        // تعديل الاسم وحده يولّد مسودة جديدة من المنشورة ويحمل ملفها كما هو.
        $this->withToken($token)->putJson("/api/print-templates/{$id}/draft", ['name' => 'اسم آخر'])
            ->assertOk()
            ->assertJsonPath('data.draft_revision.version', 2)
            ->assertJsonPath('data.draft_revision.definition.output_profile.paper', 'legal');
    }

    /** @test */
    public function duplicating_a_template_carries_the_profile_into_the_independent_draft(): void
    {
        ['token' => $token] = $this->registerTenant('op-dup', 'owner@op-dup.test');
        $id = $this->create($token, ['template_id' => 'tax-invoice-classic', 'output_profile' => ['paper' => 'a6', 'orientation' => 'landscape']])
            ->assertCreated()->json('data.id');
        $this->withToken($token)->postJson("/api/print-templates/{$id}/publish")->assertOk();

        $this->withToken($token)->postJson("/api/print-templates/{$id}/duplicate", ['name' => 'نسخة'])
            ->assertCreated()
            ->assertJsonPath('data.draft_revision.definition.output_profile.paper', 'a6_landscape');
    }

    /** @test */
    public function publish_revalidates_and_refuses_a_corrupt_profile_injected_around_the_api(): void
    {
        ['token' => $token] = $this->registerTenant('op-corrupt', 'owner@op-corrupt.test');
        $id = $this->create($token, ['template_id' => 'tax-invoice-classic', 'output_profile' => ['paper' => 'a4']])
            ->assertCreated()->json('data.id');

        // سكربت/عميل قديم يكتب مباشرة في المسودة متجاوزاً الواجهة.
        $revision = PrintTemplate::findOrFail($id)->draftRevision;
        DB::table('print_template_revisions')->where('id', $revision->id)->update([
            'definition' => json_encode(['template_id' => 'tax-invoice-classic', 'output_profile' => ['paper' => 'a4', 'css' => 'x']]),
        ]);

        $this->withToken($token)->postJson("/api/print-templates/{$id}/publish")->assertUnprocessable();

        $this->assertSame(PrintTemplateRevision::STATUS_DRAFT, $revision->fresh()->status);
        $this->assertNull(PrintTemplate::findOrFail($id)->published_revision_id);
    }

    /** @test */
    public function staff_cannot_write_a_profile_through_any_template_endpoint(): void
    {
        ['token' => $owner, 'tenant_id' => $tenantId] = $this->registerTenant('op-rbac', 'owner@op-rbac.test');
        $staff = $this->tokenForRole($tenantId, 'staff', 'staff@op-rbac.test');
        $id = $this->create($owner, ['template_id' => 'tax-invoice-classic'])->assertCreated()->json('data.id');

        $this->create($staff, ['template_id' => 'tax-invoice-classic', 'output_profile' => ['paper' => 'a5']], 'ممنوع')
            ->assertForbidden();
        $this->withToken($staff)->putJson("/api/print-templates/{$id}/draft", [
            'definition' => ['template_id' => 'tax-invoice-classic', 'output_profile' => ['paper' => 'a5']],
        ])->assertForbidden();
        $this->withToken($staff)->postJson("/api/print-templates/{$id}/publish")->assertForbidden();
        $this->withToken($staff)->postJson("/api/print-templates/{$id}/duplicate", ['name' => 'نسخة'])->assertForbidden();

        $this->assertArrayNotHasKey('output_profile', PrintTemplate::findOrFail($id)->draftRevision->definition);
    }

    /** @test */
    public function profiles_are_tenant_isolated(): void
    {
        ['token' => $aToken] = $this->registerTenant('op-alpha', 'owner@op-alpha.test');
        ['token' => $bToken] = $this->registerTenant('op-beta', 'owner@op-beta.test');
        $aId = $this->create($aToken, ['template_id' => 'tax-invoice-classic', 'output_profile' => ['paper' => 'a5']], 'قالب ألفا')
            ->assertCreated()->json('data.id');

        $this->withToken($bToken)->getJson('/api/print-templates')->assertOk()->assertJsonCount(0, 'data');
        $this->withToken($bToken)->getJson("/api/print-templates/{$aId}")->assertNotFound();
        $this->withToken($bToken)->putJson("/api/print-templates/{$aId}/draft", [
            'definition' => ['template_id' => 'tax-invoice-classic', 'output_profile' => ['paper' => 'a6']],
        ])->assertNotFound();
        $this->withToken($bToken)->postJson("/api/print-templates/{$aId}/publish")->assertNotFound();

        $this->assertSame('a5', PrintTemplate::withoutGlobalScopes()->findOrFail($aId)->draftRevision()->withoutGlobalScopes()->first()->definition['output_profile']['paper']);
    }

    /** @test */
    public function the_service_applies_the_same_contract_as_the_api(): void
    {
        ['tenant_id' => $tenantId] = $this->registerTenant('op-service', 'owner@op-service.test');
        app(TenantContext::class)->set($tenantId);

        $template = app(PrintTemplateService::class)->create([
            'name' => 'عبر الخدمة',
            'document_types' => ['tax_invoice'],
            'definition' => ['output_profile' => ['paper' => 'custom', 'custom' => ['width_mm' => 100, 'height_mm' => 150]]],
        ], null);

        $profile = $template->draftRevision->definition['output_profile'];
        $this->assertSame('custom', $profile['paper']);
        $this->assertEquals(['width_mm' => 100, 'height_mm' => 150], $profile['custom']);

        $this->expectException(\RuntimeException::class);
        app(PrintTemplateService::class)->create([
            'name' => 'مرفوض عبر الخدمة',
            'document_types' => ['tax_invoice'],
            'definition' => ['output_profile' => ['paper' => 'custom', 'custom' => ['width_mm' => 9999, 'height_mm' => 150]]],
        ], null);
    }
}
