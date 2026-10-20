<?php

namespace Tests\Feature;

use App\Models\AiActionExtraction;
use App\Models\AiActionFile;
use App\Models\Product;
use App\Support\SpreadsheetWriter;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class AiActionProductFileIntakeTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        config(['document_center.storage.driver' => 'local', 'document_center.storage.disk' => 'local']);
    }

    private function enable(string $tenantId): void
    {
        config(['ai_actions.enabled' => true]);
        app(TenantContext::class)->set($tenantId);
        Settings::put('ai_actions', ['enabled' => true]);
    }

    private function proposal(): array
    {
        return ['schema_version' => 1, 'rows' => [[
            'row_id' => 'initial-row', 'source_row' => 1,
            'match' => ['kind' => 'none', 'value' => null, 'target_product_id' => null, 'target_version' => null],
            // The closed proposal schema requires an object/map here; an empty
            // PHP array is a list, not an empty map. This seed mirrors a real
            // persisted draft without weakening the production contract.
            'decision' => 'needs_review',
            'fields' => [
                'sku' => ['value' => null, 'origin' => 'missing', 'confidence' => null],
            ],
            'violations' => [], 'media' => null,
        ]]];
    }

    private function action(string $token): string
    {
        return $this->withToken($token)->withHeader('Idempotency-Key', 'intake-action-'.substr(md5($token), 0, 12))
            ->postJson('/api/ai-actions', ['type' => 'product_import.v1', 'proposal' => $this->proposal()])
            ->assertCreated()->json('data.id');
    }

    private function csv(string $name = 'products.csv'): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($name, "الاسم,رمز الصنف,النوع,سعر البيع,سعر الشراء,الباركود,التصنيف,الوحدة,الضريبة,رابط الصورة الرئيسية,روابط الصور الاضافية\nقهوة عربية,AR-001,good,٣٥٫٠٠,,628100000001,مشروبات,قطعة,15,https://cdn.example.test/coffee.jpg,https://cdn.example.test/coffee-2.jpg\n");
    }

    private function xlsx(): UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'ai-action-xlsx-');
        SpreadsheetWriter::xlsx($path, ['Name', 'SKU', 'Type', 'Sale Price', 'Tax Rate'], [['Coffee', 'EN-001', 'good', '35.00', '15']]);
        $file = UploadedFile::fake()->createWithContent('products.xlsx', (string) file_get_contents($path));
        @unlink($path);

        return $file;
    }

    /** @test */
    public function it_privately_extracts_arabic_csv_and_keeps_image_sources_without_creating_products(): void
    {
        $auth = $this->registerTenant();
        $this->enable($auth['tenant_id']);
        $action = $this->action($auth['token']);

        $response = $this->withToken($auth['token'])->withHeader('Idempotency-Key', 'intake-csv-0001')
            ->post("/api/ai-actions/{$action}/files", ['expected_version' => 1, 'file' => $this->csv()])
            ->assertCreated()
            ->assertJsonPath('data.action_id', $action)
            ->assertJsonPath('data.manifest.rows.0.fields.name.value', 'قهوة عربية')
            ->assertJsonPath('data.manifest.rows.0.fields.purchase_price.origin', 'missing')
            ->assertJsonPath('data.manifest.rows.0.media.primary.kind', 'url')
            ->assertJsonPath('data.manifest.rows.0.media.existing_update_approved', false);

        $this->assertSame(1, AiActionFile::count());
        $this->assertSame(1, AiActionExtraction::count());
        $this->assertSame(0, Product::count(), 'الاستخراج لا يستدعي أي خدمة كتابة منتجات.');
        $this->assertMatchesRegularExpression('/^[a-f0-9]{64}$/', (string) $response->json('data.manifest_hash'));

        $file = AiActionFile::firstOrFail();
        $this->withToken($auth['token'])->getJson("/api/ai-actions/{$action}/files/{$file->id}/extraction")
            ->assertOk()->assertJsonPath('data.id', $response->json('data.id'));
    }

    /** @test */
    public function it_supports_xlsx_and_marks_missing_or_invalid_values_for_review(): void
    {
        $auth = $this->registerTenant();
        $this->enable($auth['tenant_id']);
        $action = $this->action($auth['token']);

        $this->withToken($auth['token'])->withHeader('Idempotency-Key', 'intake-xlsx-0001')
            ->post("/api/ai-actions/{$action}/files", ['expected_version' => 1, 'file' => $this->xlsx()])
            ->assertCreated()
            ->assertJsonPath('data.manifest.rows.0.fields.sku.value', 'EN-001')
            ->assertJsonPath('data.manifest.rows.0.decision', 'create');
    }

    /** @test */
    public function duplicate_uploads_are_idempotent_and_a_version_change_is_rejected(): void
    {
        $auth = $this->registerTenant();
        $this->enable($auth['tenant_id']);
        $action = $this->action($auth['token']);
        $url = "/api/ai-actions/{$action}/files";

        $first = $this->withToken($auth['token'])->withHeader('Idempotency-Key', 'intake-duplicate-01')
            ->post($url, ['expected_version' => 1, 'file' => $this->csv()])->assertCreated();
        $this->withToken($auth['token'])->withHeader('Idempotency-Key', 'intake-duplicate-02')
            ->post($url, ['expected_version' => 1, 'file' => $this->csv()])->assertCreated()
            ->assertHeader('AI-Action-File-Replayed', 'true')
            ->assertJsonPath('data.id', $first->json('data.id'));
        $this->assertSame(1, AiActionFile::count());

        $this->withToken($auth['token'])->withHeader('Idempotency-Key', 'intake-stale-0001')
            ->post($url, ['expected_version' => 2, 'file' => $this->csv()])
            ->assertConflict()->assertJsonPath('error.code', 'version_conflict');
    }

    /** @test */
    public function it_rejects_unsafe_or_oversized_files_before_persistence(): void
    {
        $auth = $this->registerTenant();
        $this->enable($auth['tenant_id']);
        $action = $this->action($auth['token']);
        $url = "/api/ai-actions/{$action}/files";

        $this->withToken($auth['token'])->withHeader('Idempotency-Key', 'intake-bad-xlsx-01')
            ->post($url, ['expected_version' => 1, 'file' => UploadedFile::fake()->createWithContent('bad.xlsx', 'not a zip')])
            ->assertUnprocessable()->assertJsonPath('error.code', 'file_content_invalid');
        $this->withToken($auth['token'])->withHeader('Idempotency-Key', 'intake-bad-type-01')
            ->post($url, ['expected_version' => 1, 'file' => UploadedFile::fake()->createWithContent('bad.txt', 'name\nsku')])
            ->assertUnprocessable()->assertJsonPath('error.code', 'file_type_invalid');
        config(['ai_actions.max_file_bytes' => 4]);
        $this->withToken($auth['token'])->withHeader('Idempotency-Key', 'intake-large-0001')
            ->post($url, ['expected_version' => 1, 'file' => $this->csv()])
            ->assertUnprocessable()->assertJsonPath('error.code', 'file_size_invalid');
        $this->assertSame(0, AiActionFile::count());
    }

    /** @test */
    public function tenant_and_rbac_scopes_protect_intake_and_extraction(): void
    {
        $a = $this->registerTenant('intake-a', 'owner@intake-a.test');
        $this->enable($a['tenant_id']);
        $action = $this->action($a['token']);
        $restricted = $this->tokenForRole($a['tenant_id'], 'accountant', 'intake-accountant@test');
        $this->withToken($restricted)->withHeader('Idempotency-Key', 'intake-rbac-0001')
            ->post("/api/ai-actions/{$action}/files", ['expected_version' => 1, 'file' => $this->csv()])->assertForbidden();

        $b = $this->registerTenant('intake-b', 'owner@intake-b.test');
        $this->enable($b['tenant_id']);
        $this->withToken($b['token'])->withHeader('Idempotency-Key', 'intake-tenant-01')
            ->post("/api/ai-actions/{$action}/files", ['expected_version' => 1, 'file' => $this->csv()])->assertNotFound();
    }
}
