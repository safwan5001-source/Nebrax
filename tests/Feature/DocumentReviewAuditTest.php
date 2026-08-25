<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\DocumentBatch;
use App\Models\DocumentReviewAction;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use LogicException;
use Tests\TestCase;

class DocumentReviewAuditTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function review_actions_are_append_only_and_bound_to_the_trusted_batch_scope(): void
    {
        $auth = $this->registerTenant('review-audit', 'review-audit@test.local');
        $branchId = Branch::query()->where('tenant_id', $auth['tenant_id'])->value('id');
        app(TenantContext::class)->set($auth['tenant_id']);
        app(BranchContext::class)->set($branchId);

        $batch = DocumentBatch::create(['document_type' => 'purchase_invoice', 'source_type' => 'manual']);
        $action = DocumentReviewAction::create([
            'document_batch_id' => $batch->id,
            'subject_type' => 'batch',
            'subject_id' => $batch->id,
            'action' => 'reviewer_assigned',
            'before' => ['review_assigned_to' => null],
            'after' => ['review_assigned_to' => null],
            'reason' => 'تهيئة أثر المراجعة',
            'review_version' => 1,
            'occurred_at' => now('UTC'),
        ]);

        $this->assertSame($auth['tenant_id'], $action->tenant_id);
        $this->assertSame($branchId, $action->branch_id);
        $this->expectException(LogicException::class);
        $action->action = 'tampered';
        $action->save();
    }

    /** @test */
    public function document_review_routes_require_authentication(): void
    {
        $this->getJson('/api/document-batches')->assertUnauthorized();
    }
}
