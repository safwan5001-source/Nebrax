<?php

namespace Tests\Feature;

use App\Models\AiActionExtraction;
use App\Models\AiActionFile;
use App\Models\AiAction;
use App\Models\Product;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AiActionProductReviewTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function enable(string $tenant): void { config(['ai_actions.enabled' => true]); app(TenantContext::class)->set($tenant); Settings::put('ai_actions', ['enabled' => true]); }
    private function createReviewableAction(array $auth): string
    {
        $this->enable($auth['tenant_id']);
        $id = $this->withToken($auth['token'])->withHeader('Idempotency-Key', 'review-action-0001')->postJson('/api/ai-actions', ['type' => 'product_import.v1', 'proposal' => ['schema_version' => 1, 'rows' => []]])->assertCreated()->json('data.id');
        $actorId = AiAction::findOrFail($id)->created_by;
        $file = AiActionFile::create(['ai_action_id' => $id, 'action_version' => 1, 'original_name' => 'products.csv', 'extension' => 'csv', 'size_bytes' => 20, 'content_sha256' => str_repeat('a', 64), 'storage_profile' => 'platform', 'storage_key' => 'private/source.csv', 'uploaded_by' => $actorId]);
        AiActionExtraction::create(['ai_action_file_id' => $file->id, 'ai_action_id' => $id, 'action_version' => 1, 'schema_version' => 1, 'manifest' => ['rows' => [[
            'row_id' => 'source-2', 'source_row' => 2, 'match' => ['kind' => 'none', 'value' => null, 'target_product_id' => null, 'target_version' => null], 'decision' => 'needs_review',
            'fields' => ['name' => ['value' => 'قهوة', 'origin' => 'extracted', 'confidence' => 100], 'sku' => ['value' => null, 'origin' => 'missing', 'confidence' => null], 'sale_price' => ['value' => '10', 'origin' => 'extracted', 'confidence' => 100]],
            'violations' => [['code' => 'trusted_identifier_missing', 'field' => null, 'severity' => 'warning', 'message' => 'SKU مفقود']], 'media' => null,
        ]]], 'manifest_hash' => str_repeat('b', 64), 'created_by' => $actorId, 'created_at' => now()]);
        return $id;
    }

    /** @test */
    public function edits_create_a_new_inert_version_and_detect_stale_edits(): void
    {
        $auth = $this->registerTenant(); $id = $this->createReviewableAction($auth);
        $this->withToken($auth['token'])->getJson("/api/ai-actions/{$id}/review")->assertOk()->assertJsonPath('data.proposal.rows.0.fields.sku.origin', 'missing');
        $payload = ['expected_version' => 1, 'edits' => [['row_id' => 'source-2', 'fields' => ['sku' => 'COFFEE-01', 'purchase_price' => '5.25']]]];
        $this->withToken($auth['token'])->withHeader('Idempotency-Key', 'review-edit-0001')->postJson("/api/ai-actions/{$id}/review/versions", $payload)->assertCreated()->assertJsonPath('data.version', 2)->assertJsonPath('data.latest_version.proposal.rows.0.fields.sku.origin', 'user');
        $this->withToken($auth['token'])->withHeader('Idempotency-Key', 'review-edit-0002')->postJson("/api/ai-actions/{$id}/review/versions", $payload)->assertConflict()->assertJsonPath('error.code', 'version_conflict');
        $this->assertSame(0, Product::count());
    }

    /** @test */
    public function the_review_step_judges_cells_exactly_like_the_final_preview(): void
    {
        $auth = $this->registerTenant(); $id = $this->createReviewableAction($auth);
        $edit = fn (array $fields, string $key) => $this->withToken($auth['token'])->withHeader('Idempotency-Key', $key)
            ->postJson("/api/ai-actions/{$id}/review/versions", ['expected_version' => 1, 'edits' => [['row_id' => 'source-2', 'fields' => $fields]]]);

        // IMP-H2-S2: حكم المعاين النهائي (`ProductImportValueNormalizer`) هو المرجع — أكثر من منزلتين عشريتين للمال مرفوض هنا لا في المعاينة وحدها.
        $edit(['sale_price' => '10.1234'], 'review-agree-0001')->assertStatus(422)->assertJsonPath('error.code', 'review_field_invalid');
        $edit(['tax_rate' => '15.5'], 'review-agree-0002')->assertStatus(422)->assertJsonPath('error.code', 'review_field_invalid');
        $edit(['track_inventory' => 'ربما'], 'review-agree-0003')->assertStatus(422)->assertJsonPath('error.code', 'review_field_invalid');

        // ويقبل ما يقبله المعاين: أرقام عربية وفاصل آلاف ونسبة بـ% وأسماء النوع البديلة.
        $edit(['sale_price' => '١٬٢٣٤٫٥٠', 'tax_rate' => '١٥%', 'type' => 'سلعة'], 'review-agree-0004')->assertCreated();
    }
}
