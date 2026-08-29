<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\DocumentBatch;
use App\Models\Tenant;
use App\Models\User;
use App\Services\DocumentCenter\DocumentWorkflowService;
use App\Services\EntitlementGrantService;
use App\Support\DocumentProcessingStatus;
use App\Support\DocumentScanStatus;
use App\Support\DocumentWorkflowStatus;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class DocumentReviewerEligibilityTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function eligible_reviewers_endpoint_is_server_authoritative_without_users_view(): void
    {
        $auth = $this->registerTenant('doc-reviewer-eligibility', 'owner@doc-reviewer-eligibility.test');
        $branchId = Branch::query()->where('tenant_id', $auth['tenant_id'])->value('id');
        app(TenantContext::class)->set($auth['tenant_id']);
        app(BranchContext::class)->set($branchId);
        $this->grantDocumentCenter($auth['tenant_id']);

        $customRole = $this->withToken($auth['token'])->postJson('/api/roles', [
            'name' => 'مراجع مستندات',
            'permissions' => ['documents.center.view', 'documents.center.manage', 'documents.center.review'],
        ])->assertCreated()['data'];

        $reviewerToken = $this->tokenForRole($auth['tenant_id'], $customRole['slug'], 'reviewer@doc-reviewer-eligibility.test');
        $reviewer = User::query()->where('email', 'reviewer@doc-reviewer-eligibility.test')->firstOrFail();

        $managerRole = $this->withToken($auth['token'])->postJson('/api/roles', [
            'name' => 'مدير مستندات',
            'permissions' => ['documents.center.view', 'documents.center.manage'],
        ])->assertCreated()['data'];
        $managerToken = $this->tokenForRole($auth['tenant_id'], $managerRole['slug'], 'manager@doc-reviewer-eligibility.test');

        $otherBranchId = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع آخر'])->assertCreated()->json('data.id');
        $outOfBranchToken = $this->tokenForRole($auth['tenant_id'], $customRole['slug'], 'out-branch@doc-reviewer-eligibility.test');
        $outOfBranch = User::query()->where('email', 'out-branch@doc-reviewer-eligibility.test')->firstOrFail();
        $outOfBranch->branches()->sync([$otherBranchId]);

        $batch = DocumentBatch::create(['document_type' => 'purchase_invoice', 'source_type' => 'manual']);

        $this->withToken($managerToken)->withHeader('X-Branch-Id', $branchId)
            ->getJson('/api/document-batches/eligible-reviewers')
            ->assertOk()
            ->assertJsonPath('data.0.id', $reviewer->id)
            ->assertJsonMissing(['id' => $outOfBranch->id]);

        $this->withToken($managerToken)->withHeader('X-Branch-Id', $branchId)
            ->getJson("/api/document-batches/{$batch->id}/eligible-reviewers")
            ->assertOk()
            ->assertJsonPath('data.0.id', $reviewer->id)
            ->assertJsonMissing(['id' => $outOfBranch->id]);

        $this->withToken($reviewerToken)->withHeader('X-Branch-Id', $branchId)
            ->getJson('/api/users')
            ->assertForbidden();
    }

    /** @test */
    public function assign_reviewer_rejects_users_outside_branch_or_without_review_permission(): void
    {
        $auth = $this->registerTenant('doc-reviewer-assign', 'owner@doc-reviewer-assign.test');
        $branchId = Branch::query()->where('tenant_id', $auth['tenant_id'])->value('id');
        app(TenantContext::class)->set($auth['tenant_id']);
        app(BranchContext::class)->set($branchId);
        $this->grantDocumentCenter($auth['tenant_id']);

        $batch = DocumentBatch::create(['document_type' => 'purchase_invoice', 'source_type' => 'manual']);
        $workflow = app(DocumentWorkflowService::class);
        $batch = $workflow->transition($batch, DocumentWorkflowStatus::RECEIVING, 'assign_test_receiving', 'user', User::first()->id);
        $batch = $workflow->transition($batch, DocumentWorkflowStatus::RECEIVED, 'assign_test_received', 'user', User::first()->id);
        $batch = $workflow->transition($batch, DocumentWorkflowStatus::NEEDS_REVIEW, 'assign_test_needs_review', 'user', User::first()->id);

        $otherBranchId = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع معزول'])->assertCreated()->json('data.id');
        $customRole = $this->withToken($auth['token'])->postJson('/api/roles', [
            'name' => 'مراجع فرع آخر',
            'permissions' => ['documents.center.review'],
        ])->assertCreated()['data'];
        $foreignReviewerToken = $this->tokenForRole($auth['tenant_id'], $customRole['slug'], 'foreign-reviewer@doc-reviewer-assign.test');
        $foreignReviewer = User::query()->where('email', 'foreign-reviewer@doc-reviewer-assign.test')->firstOrFail();
        $foreignReviewer->branches()->sync([$otherBranchId]);

        $this->withToken($auth['token'])->withHeader('X-Branch-Id', $branchId)
            ->postJson("/api/document-batches/{$batch->id}/assign-reviewer", [
                'expected_version' => $batch->version,
                'reviewer_id' => $foreignReviewer->id,
                'reason' => 'محاولة إسناد خارج الفرع.',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['reviewer_id']);
    }

    private function grantDocumentCenter(string $tenantId): void
    {
        app(EntitlementGrantService::class)->grant(
            Tenant::findOrFail($tenantId),
            'document_center.core',
            EntitlementAccessMode::FULL,
            EntitlementSourceType::ADDON,
            now('UTC')->subMinute(),
            null,
            'document-reviewer-eligibility-test',
            (string) Str::uuid(),
        );
    }
}
