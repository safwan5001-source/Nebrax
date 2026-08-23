<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\CommercialProduct;
use App\Models\DocumentBatch;
use App\Models\DocumentWorkflowEvent;
use App\Models\Tenant;
use App\Models\TenantApplicationState;
use App\Models\User;
use App\Services\ApplicationAccessDecision;
use App\Services\DocumentCenter\DocumentWorkflowService;
use App\Services\EntitlementGrantService;
use App\Support\ApplicationAccessLevel;
use App\Support\ApplicationOperationClass;
use App\Support\DocumentWorkflowStatus;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Support\Rbac;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;
use LogicException;
use Tests\TestCase;

class DocumentCenterFoundationTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;
    private Branch $branch;
    private User $user;
    private DocumentWorkflowService $workflow;

    protected function setUp(): void
    {
        parent::setUp();
        [$this->tenant, $this->branch, $this->user] = $this->identity('document-center-a');
        $this->useContext($this->tenant, $this->branch);
        $this->workflow = app(DocumentWorkflowService::class);
    }

    /** @test */
    public function commercial_product_registration_is_published_and_contains_only_the_center_capability(): void
    {
        $product = CommercialProduct::where('code', 'intelligent-document-center')->firstOrFail();
        $version = $product->versions()->where('version', 1)->firstOrFail();

        $this->assertNotNull($version->published_at);
        $this->assertSame(['document_center.core'], $version->capabilities()->pluck('capability_key')->all());
    }

    /** @test */
    public function current_entitlement_sources_and_application_state_compose_fail_closed(): void
    {
        $at = CarbonImmutable::parse('2026-08-23 12:00:00', 'UTC');
        $decision = app(ApplicationAccessDecision::class);
        $grants = app(EntitlementGrantService::class);

        TenantApplicationState::create([
            'application_key' => 'document_center.core',
            'requested_enabled' => true,
            'status' => 'enabled',
        ]);

        foreach ([EntitlementSourceType::ADDON, EntitlementSourceType::TRIAL, EntitlementSourceType::LEGACY_GRANDFATHER] as $index => $source) {
            $grant = $grants->grant(
                $this->tenant,
                'document_center.core',
                EntitlementAccessMode::FULL,
                $source,
                $at->subMinute(),
                $source === EntitlementSourceType::TRIAL ? $at->addMinute() : null,
                'document-center-test',
                "source-{$index}",
            );
            $this->assertSame(ApplicationAccessLevel::ALLOWED, $decision->decide($this->tenant, 'document_center.core', ApplicationOperationClass::READ, true, $at)->level);
            $grant->forceFill(['revoked_at' => $at])->save();
        }

        $expired = $grants->grant($this->tenant, 'document_center.core', EntitlementAccessMode::FULL, EntitlementSourceType::TRIAL, $at->subHours(2), $at->subHour(), 'expired', 'trial-expired');
        $this->assertNotNull($expired);
        $this->assertSame(ApplicationAccessLevel::DENIED, $decision->decide($this->tenant, 'document_center.core', ApplicationOperationClass::READ, true, $at)->level);

        $active = $grants->grant($this->tenant, 'document_center.core', EntitlementAccessMode::FULL, EntitlementSourceType::ADDON, $at, null, 'active', 'addon-active');
        $this->assertSame(ApplicationAccessLevel::DENIED, $decision->decide($this->tenant, 'document_center.core', ApplicationOperationClass::READ, false, $at)->level);

        TenantApplicationState::where('application_key', 'document_center.core')->update(['status' => 'disabled']);
        $this->assertSame(ApplicationAccessLevel::DENIED, $decision->decide($this->tenant, 'document_center.core', ApplicationOperationClass::READ, true, $at)->level);
        $this->assertNotNull($active);
    }

    /** @test */
    public function the_four_rbac_permissions_are_independent_and_not_given_to_restricted_default_roles(): void
    {
        $permissions = ['documents.center.view', 'documents.center.manage', 'documents.center.review', 'documents.center.settings'];

        foreach ($permissions as $permission) {
            $this->assertContains($permission, Rbac::PERMISSIONS);
            $this->assertTrue(Rbac::allows('admin', $permission));
            $this->assertFalse(Rbac::allows('staff', $permission));
            $this->assertFalse(Rbac::allows('accountant', $permission));
        }
        $this->assertCount(4, array_intersect($permissions, Rbac::PERMISSIONS));
    }

    /** @test */
    public function batch_creation_uses_trusted_context_and_branch_scope_blocks_spoofing(): void
    {
        [, $otherBranch] = $this->additionalBranch('002', 'Other branch');
        [$otherTenant, $foreignBranch] = $this->identity('document-center-b');
        $this->useContext($this->tenant, $this->branch);

        $batch = DocumentBatch::create([
            'tenant_id' => $otherTenant->id,
            'branch_id' => $foreignBranch->id,
            'document_type' => 'purchase_invoice',
            'source_type' => 'manual',
            'created_by' => $this->user->id,
        ]);
        $this->assertSame($this->tenant->id, $batch->tenant_id);
        $this->assertSame($this->branch->id, $batch->branch_id);

        $this->useContext($this->tenant, $otherBranch);
        $this->assertNull(DocumentBatch::find($batch->id));

        $this->useContext($otherTenant, $foreignBranch);
        $this->assertSame(0, DocumentBatch::count());
    }

    /** @test */
    public function a_batch_cannot_be_created_without_both_trusted_contexts(): void
    {
        app(BranchContext::class)->forget();
        $this->expectException(LogicException::class);
        DocumentBatch::create(['document_type' => 'expense', 'source_type' => 'manual']);
    }

    /** @test */
    public function workflow_status_contract_is_complete_and_has_no_approval_state(): void
    {
        $this->assertSame([
            'draft', 'receiving', 'received', 'queued', 'processing', 'needs_review',
            'ready_for_draft', 'creating_draft', 'draft_created', 'archived', 'failed',
            'quarantined', 'duplicate', 'cancelled',
        ], array_column(DocumentWorkflowStatus::cases(), 'value'));
        $this->assertNotContains('approved', array_column(DocumentWorkflowStatus::cases(), 'value'));
    }

    /** @test */
    public function every_declared_transition_succeeds_and_every_other_transition_is_rejected_atomically(): void
    {
        foreach (DocumentWorkflowStatus::cases() as $from) {
            foreach (DocumentWorkflowStatus::cases() as $to) {
                $batch = $this->batchAt($from);
                $before = DocumentWorkflowEvent::count();

                if ($this->workflow->allows($from, $to)) {
                    $result = $this->workflow->transition($batch, $to, 'test_transition', 'user', $this->user->id, 'reviewed', ['request_id' => 'safe']);
                    $this->assertSame($to, $result->status);
                    $this->assertSame($before + 1, DocumentWorkflowEvent::count());
                } else {
                    try {
                        $this->workflow->transition($batch, $to, 'invalid_transition', 'user', $this->user->id);
                        $this->fail("Invalid {$from->value} -> {$to->value} transition succeeded.");
                    } catch (ValidationException) {
                        $this->assertSame($from, $batch->fresh()->status);
                        $this->assertSame($before, DocumentWorkflowEvent::count());
                    }
                }
            }
        }
    }

    /** @test */
    public function transitions_record_a_safe_actor_reason_timestamp_and_are_append_only(): void
    {
        $batch = $this->batchAt(DocumentWorkflowStatus::DRAFT);
        $result = $this->workflow->transition($batch, DocumentWorkflowStatus::RECEIVING, 'receiving_started', 'user', $this->user->id, 'Manual intake', ['channel' => 'future-upload']);
        $event = $result->workflowEvents()->firstOrFail();

        $this->assertSame($this->tenant->id, $event->tenant_id);
        $this->assertSame($this->branch->id, $event->branch_id);
        $this->assertSame('user', $event->actor_type);
        $this->assertSame($this->user->id, $event->actor_id);
        $this->assertSame('Manual intake', $event->reason);
        $this->assertNotNull($event->occurred_at);
        $this->assertSame(['channel' => 'future-upload'], $event->metadata);

        [, $otherBranch] = $this->additionalBranch('003', 'Review branch');
        $this->useContext($this->tenant, $otherBranch);
        $this->assertSame(0, DocumentWorkflowEvent::count());
        $this->useContext($this->tenant, $this->branch);

        try { $event->update(['reason' => 'changed']); $this->fail('Workflow event was mutable.'); }
        catch (LogicException) { $this->addToAssertionCount(1); }
        $this->expectException(LogicException::class);
        $event->delete();
    }

    /** @test */
    public function stale_concurrent_transition_creates_no_second_event(): void
    {
        $batch = $this->batchAt(DocumentWorkflowStatus::DRAFT);
        $stale = DocumentBatch::findOrFail($batch->id);
        $this->workflow->transition($batch, DocumentWorkflowStatus::RECEIVING, 'receive', 'user', $this->user->id);

        try {
            $this->workflow->transition($stale, DocumentWorkflowStatus::CANCELLED, 'cancel', 'user', $this->user->id);
            $this->fail('Stale transition succeeded.');
        } catch (ValidationException) {
            $this->assertSame(1, DocumentWorkflowEvent::count());
            $this->assertSame(DocumentWorkflowStatus::RECEIVING, $stale->fresh()->status);
        }
    }

    /** @test */
    public function direct_state_mutation_and_sensitive_metadata_are_rejected(): void
    {
        $batch = $this->batchAt(DocumentWorkflowStatus::DRAFT);
        try {
            $batch->status = DocumentWorkflowStatus::RECEIVED;
            $batch->save();
            $this->fail('Direct state mutation succeeded.');
        } catch (LogicException) {
            $this->assertSame(DocumentWorkflowStatus::DRAFT, $batch->fresh()->status);
        }

        $this->expectException(InvalidArgumentException::class);
        $this->workflow->transition($batch, DocumentWorkflowStatus::RECEIVING, 'receive', 'user', $this->user->id, null, ['token' => 'forbidden']);
    }

    private function batchAt(DocumentWorkflowStatus $status): DocumentBatch
    {
        $id = fake()->uuid();
        DB::table('document_batches')->insert([
            'id' => $id,
            'tenant_id' => $this->tenant->id,
            'branch_id' => $this->branch->id,
            'document_type' => 'purchase_invoice',
            'source_type' => 'manual',
            'status' => $status->value,
            'schema_version' => 1,
            'version' => 1,
            'created_by' => $this->user->id,
            'created_at' => now('UTC'),
            'updated_at' => now('UTC'),
        ]);
        return DocumentBatch::findOrFail($id);
    }

    /** @return array{Tenant, Branch, User} */
    private function identity(string $slug): array
    {
        app(TenantContext::class)->forget();
        app(BranchContext::class)->forget();
        $tenant = Tenant::create(['name' => $slug, 'slug' => $slug, 'currency' => 'SAR']);
        app(TenantContext::class)->set($tenant->id);
        $branch = Branch::create(['code' => '001', 'name' => 'Main']);
        $user = User::create(['tenant_id' => $tenant->id, 'name' => 'Owner', 'email' => "owner@{$slug}.test", 'password' => 'password', 'role' => 'owner']);
        return [$tenant, $branch, $user];
    }

    /** @return array{Tenant, Branch} */
    private function additionalBranch(string $code, string $name): array
    {
        return [$this->tenant, Branch::create(['code' => $code, 'name' => $name])];
    }

    private function useContext(Tenant $tenant, Branch $branch): void
    {
        app(TenantContext::class)->set($tenant->id);
        app(BranchContext::class)->set($branch->id);
    }
}
