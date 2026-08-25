<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\DocumentBatch;
use App\Models\Tenant;
use App\Services\EntitlementGrantService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DocumentReviewListTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function review_list_is_tenant_scoped_and_uses_server_side_search_contract(): void
    {
        $first = $this->registerTenant('review-list-a', 'review-list-a@test.local');
        $firstBranch = Branch::query()->where('tenant_id', $first['tenant_id'])->value('id');
        app(TenantContext::class)->set($first['tenant_id']);
        app(BranchContext::class)->set($firstBranch);
        app(EntitlementGrantService::class)->grant(Tenant::findOrFail($first['tenant_id']), 'document_center.core', EntitlementAccessMode::FULL, EntitlementSourceType::ADDON, now('UTC')->subMinute(), null, 'document-review-list-test', (string) \Illuminate\Support\Str::uuid());
        $visible = DocumentBatch::create(['document_type' => 'purchase_invoice', 'source_type' => 'manual']);

        $second = $this->registerTenant('review-list-b', 'review-list-b@test.local');
        $secondBranch = Branch::query()->where('tenant_id', $second['tenant_id'])->value('id');
        app(TenantContext::class)->set($second['tenant_id']);
        app(BranchContext::class)->set($secondBranch);
        $hidden = DocumentBatch::create(['document_type' => 'sales_invoice', 'source_type' => 'manual']);

        $this->withToken($first['token'])->withHeader('X-Branch-Id', $firstBranch)->getJson('/api/document-batches?search=purchase_invoice&per_page=10')
            ->assertOk()
            ->assertJsonPath('data.0.id', $visible->id)
            ->assertJsonMissing(['id' => $hidden->id]);
    }

    /** @test */
    public function stale_review_version_returns_a_safe_http_conflict(): void
    {
        $auth = $this->registerTenant('review-stale', 'review-stale@test.local');
        $branchId = Branch::query()->where('tenant_id', $auth['tenant_id'])->value('id');
        app(TenantContext::class)->set($auth['tenant_id']);
        app(BranchContext::class)->set($branchId);
        app(EntitlementGrantService::class)->grant(Tenant::findOrFail($auth['tenant_id']), 'document_center.core', EntitlementAccessMode::FULL, EntitlementSourceType::ADDON, now('UTC')->subMinute(), null, 'document-review-stale-test', (string) \Illuminate\Support\Str::uuid());
        $batch = DocumentBatch::create(['document_type' => 'purchase_invoice', 'source_type' => 'manual']);

        $this->withToken($auth['token'])->withHeader('X-Branch-Id', $branchId)
            ->postJson("/api/document-batches/{$batch->id}/assign-reviewer", ['expected_version' => 1, 'reason' => 'اختبار تعارض النسخة'])
            ->assertStatus(409)
            ->assertJsonPath('message', 'stale_review_version');
    }
}
