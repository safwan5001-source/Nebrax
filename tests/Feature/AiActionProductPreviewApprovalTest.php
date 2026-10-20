<?php

namespace Tests\Feature;

use App\Models\AiAction;
use App\Models\AiActionApproval;
use App\Models\AiActionEvent;
use App\Models\AiActionExtraction;
use App\Models\AiActionFile;
use App\Models\AiActionPreview;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Product;
use App\Models\Role;
use App\Models\StockMovement;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * AI-ACTIONS-04: preview + approval only. Every scenario also proves that no
 * product, stock movement, invoice or journal entry is created or changed.
 */
class AiActionProductPreviewApprovalTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function enable(string $tenant): void
    {
        config(['ai_actions.enabled' => true]);
        app(TenantContext::class)->set($tenant);
        Settings::put('ai_actions', ['enabled' => true]);
    }

    /** @param array<string,mixed> $values */
    private function row(string $id, int $source, array $values, string $decision = 'create'): array
    {
        $fields = [];
        foreach ($values as $key => $value) {
            $fields[$key] = ['value' => $value, 'origin' => $value === null ? 'missing' : 'extracted', 'confidence' => $value === null ? null : 100];
        }

        return [
            'row_id' => $id, 'source_row' => $source,
            'match' => ['kind' => 'none', 'value' => null, 'target_product_id' => null, 'target_version' => null],
            'decision' => $decision, 'fields' => $fields, 'violations' => [], 'media' => null,
        ];
    }

    /** A complete, valid create row. */
    private function good(string $id, int $source, string $sku, array $extra = []): array
    {
        return $this->row($id, $source, array_merge(['sku' => $sku, 'name' => 'منتج '.$sku, 'type' => 'good', 'sale_price' => '10.50', 'purchase_price' => '5', 'tax_rate' => '15', 'unit' => 'قطعة'], $extra));
    }

    private function makeAction(array $auth, array $rows, string $key = 'pa-action-0001'): string
    {
        $this->enable($auth['tenant_id']);
        $id = $this->withToken($auth['token'])->withHeader('Idempotency-Key', $key)->postJson('/api/ai-actions', ['type' => 'product_import.v1', 'proposal' => ['schema_version' => 1, 'rows' => []]])->assertCreated()->json('data.id');
        $actorId = AiAction::findOrFail($id)->created_by;
        $file = AiActionFile::create(['ai_action_id' => $id, 'action_version' => 1, 'original_name' => 'products.csv', 'extension' => 'csv', 'size_bytes' => 20, 'content_sha256' => str_repeat('a', 64), 'storage_profile' => 'platform', 'storage_key' => 'private/source.csv', 'uploaded_by' => $actorId]);
        AiActionExtraction::create(['ai_action_file_id' => $file->id, 'ai_action_id' => $id, 'action_version' => 1, 'schema_version' => 1,
            'manifest' => ['source' => ['content_sha256' => str_repeat('a', 64)], 'rows' => $rows], 'manifest_hash' => str_repeat('b', 64), 'created_by' => $actorId, 'created_at' => now()]);

        return $id;
    }

    private function preview(string $token, string $id, int $version = 1, string $key = 'pa-preview-0001', array $headers = [])
    {
        return $this->withToken($token)->withHeaders($headers + ['Idempotency-Key' => $key])->postJson("/api/ai-actions/{$id}/previews", ['expected_version' => $version]);
    }

    private function approve(string $token, string $id, array $preview, int $version = 1, string $key = 'pa-approve-0001', array $headers = [])
    {
        return $this->withToken($token)->withHeaders($headers + ['Idempotency-Key' => $key])->postJson("/api/ai-actions/{$id}/approvals", [
            'expected_version' => $version, 'preview_id' => $preview['id'], 'preview_hash' => $preview['preview_hash'], 'acknowledged' => true,
        ]);
    }

    private function product(string $token, array $attributes): array
    {
        return $this->withToken($token)->postJson('/api/products', $attributes + ['type' => 'good', 'sale_price' => 1000, 'purchase_price' => 500])->assertCreated()['data'];
    }

    /** @return array<string,array<string,mixed>> */
    private function rows(array $preview): array
    {
        return collect($preview['rows'])->keyBy('row_id')->all();
    }

    private function codes(array $row): array
    {
        return array_column($row['issues'], 'code');
    }

    private function errorCodes(array $row): array
    {
        return array_column(array_filter($row['issues'], fn (array $issue) => $issue['severity'] === 'error'), 'code');
    }

    private function assertNothingWritten(int $products = 0): void
    {
        $this->assertSame($products, Product::withoutGlobalScopes()->count());
        $this->assertSame(0, StockMovement::withoutGlobalScopes()->count());
        $this->assertSame(0, Invoice::withoutGlobalScopes()->count());
        $this->assertSame(0, JournalEntry::withoutGlobalScopes()->count());
    }

    private function customRole(string $tenantId, string $slug, array $permissions, string $email): string
    {
        app(TenantContext::class)->set($tenantId);
        Role::create(['slug' => $slug, 'name' => $slug, 'permissions' => $permissions, 'is_system' => false]);

        return $this->tokenForRole($tenantId, $slug, $email);
    }

    /** @test */
    public function preview_classifies_create_update_skip_and_blocked_rows_without_writing_anything(): void
    {
        $auth = $this->registerTenant();
        $existing = $this->product($auth['token'], ['name' => 'قهوة قائمة', 'sku' => 'EX-1', 'sale_price' => 1000, 'purchase_price' => 500]);
        $this->product($auth['token'], ['name' => 'مطابق تماماً', 'sku' => 'EX-2', 'sale_price' => 1000, 'purchase_price' => 500]);
        $id = $this->makeAction($auth, [
            $this->good('new', 2, 'NEW-1', ['primary_image_url' => 'https://img.example/a.jpg', 'additional_image_urls' => 'https://img.example/b.jpg;https://img.example/c.jpg']),
            $this->row('upd', 3, ['sku' => 'EX-1', 'sale_price' => '12', 'purchase_price' => '6.5'], 'update'),
            $this->row('skp', 4, ['sku' => 'SKP-1', 'name' => 'متخطّى'], 'skip'),
            $this->good('dup', 5, 'EX-1'),
            $this->row('same', 6, ['sku' => 'EX-2', 'sale_price' => '10'], 'update'),
        ]);

        $response = $this->preview($auth['token'], $id)->assertCreated();
        $preview = $response->json('data');
        $rows = $this->rows($preview);

        $this->assertSame(['rows' => 5, 'create' => 1, 'update' => 1, 'skip' => 2, 'blocked' => 1], array_intersect_key($preview['totals'], array_flip(['rows', 'create', 'update', 'skip', 'blocked'])));
        $this->assertFalse($preview['approvable']);
        $this->assertSame('create', $rows['new']['operation']);
        $this->assertSame(1050, $rows['new']['prices']['sale_price']['after']);
        $this->assertSame(500, $rows['new']['prices']['purchase_price']['after']);
        $this->assertSame(3, $rows['new']['images']['count']);
        $this->assertFalse($rows['new']['images']['will_apply']);
        $this->assertSame('deferred', $rows['new']['images']['status']);
        $this->assertContains('media_deferred', $this->codes($rows['new']));
        $this->assertFalse($rows['new']['images']['fetched']);

        $this->assertSame('update', $rows['upd']['operation']);
        $this->assertSame($existing['id'], $rows['upd']['match']['target_product_id']);
        $this->assertContains(['field' => 'sale_price', 'before' => 1000, 'after' => 1200], $rows['upd']['changes']);
        $this->assertContains(['field' => 'purchase_price', 'before' => 500, 'after' => 650], $rows['upd']['changes']);

        $this->assertSame('skip', $rows['skp']['operation']);
        $this->assertSame('user_skip', $rows['skp']['skip_reason']);
        $this->assertSame('blocked', $rows['dup']['operation']);
        $this->assertContains('existing_product_matches', $this->codes($rows['dup']));
        $this->assertSame('skip', $rows['same']['operation']);
        $this->assertSame('no_changes', $rows['same']['skip_reason']);
        $this->assertSame('created', AiAction::findOrFail($id)->status);
        $this->assertNothingWritten(2);
        $this->assertSame(1000, (int) Product::withoutGlobalScopes()->findOrFail($existing['id'])->sale_price);
    }

    /** @test */
    public function missing_required_fields_and_invalid_values_block_approval(): void
    {
        $auth = $this->registerTenant();
        $id = $this->makeAction($auth, [
            $this->row('r1', 2, ['sku' => 'A-1', 'name' => null, 'type' => 'good', 'sale_price' => null]),
            $this->row('r2', 3, ['sku' => 'A-2', 'name' => 'س', 'type' => 'good', 'sale_price' => '10.555', 'tax_rate' => '150', 'reorder_level' => '-1']),
            $this->row('r3', 4, ['sku' => 'A-3', 'name' => 'ص', 'type' => 'good', 'sale_price' => '10', 'min_sale_price' => '20', 'primary_image_url' => 'javascript:alert(1)']),
            $this->row('r4', 5, ['sku' => 'A-4', 'name' => 'ع', 'type' => 'service', 'sale_price' => '10', 'track_inventory' => 'yes']),
            $this->row('r5', 6, ['sku' => 'A-5', 'name' => 'ف', 'sale_price' => '10'], 'needs_review'),
        ]);
        $preview = $this->preview($auth['token'], $id)->assertCreated()->json('data');
        $rows = $this->rows($preview);

        $this->assertFalse($preview['approvable']);
        $this->assertSame(5, $preview['totals']['blocked']);
        $this->assertSame(2, count(array_filter($this->errorCodes($rows['r1']), fn ($code) => $code === 'required_missing')));
        $this->assertEqualsCanonicalizing(['name', 'sale_price'], array_column(array_filter($rows['r1']['issues'], fn ($i) => $i['code'] === 'required_missing'), 'field'));
        $this->assertContains('invalid_money', $this->codes($rows['r2']));
        $this->assertContains('integer_out_of_range', $this->codes($rows['r2']));
        $this->assertContains('min_sale_price_above_sale_price', $this->codes($rows['r3']));
        $this->assertContains('invalid_image_url', $this->codes($rows['r3']));
        $this->assertContains('service_tracks_inventory', $this->codes($rows['r4']));
        $this->assertContains('decision_required', $this->codes($rows['r5']));

        $this->approve($auth['token'], $id, $preview)->assertStatus(422)->assertJsonPath('error.code', 'preview_blocked');
        $this->assertSame(0, AiActionApproval::withoutGlobalScopes()->count());
        $this->assertNothingWritten();
    }

    /** @test */
    public function a_forged_proposal_cannot_hide_errors_by_omitting_violations(): void
    {
        $auth = $this->registerTenant();
        $id = $this->makeAction($auth, [$this->good('seed', 2, 'SEED-1')]);
        $forged = $this->row('forged', 2, ['sku' => 'F-1', 'name' => null, 'sale_price' => 'abc']);
        $forged['violations'] = [];
        $forged['match'] = ['kind' => 'sku', 'value' => 'F-1', 'target_product_id' => '00000000-0000-4000-8000-000000000000', 'target_version' => null];
        $this->withToken($auth['token'])->withHeader('Idempotency-Key', 'pa-forged-0001')->postJson("/api/ai-actions/{$id}/versions", ['expected_version' => 1, 'proposal' => ['schema_version' => 1, 'rows' => [$forged]]])->assertCreated();

        $preview = $this->preview($auth['token'], $id, 2)->assertCreated()->json('data');
        $this->assertFalse($preview['approvable']);
        $this->assertContains('required_missing', $this->codes($this->rows($preview)['forged']));
        $this->assertContains('invalid_money', $this->codes($this->rows($preview)['forged']));
        $this->assertNull($this->rows($preview)['forged']['match']['target_product_id']);
    }

    /** @test */
    public function duplicates_and_identifier_conflicts_are_detected_against_the_file_and_live_data(): void
    {
        $auth = $this->registerTenant();
        $a = $this->product($auth['token'], ['name' => 'أ', 'sku' => 'LIVE-A', 'barcode' => '1000000000001']);
        $b = $this->product($auth['token'], ['name' => 'ب', 'sku' => 'LIVE-B', 'barcode' => '1000000000002']);
        $id = $this->makeAction($auth, [
            $this->good('f1', 2, 'FILE-1'),
            $this->good('f2', 3, 'file-1'),
            $this->row('mix', 4, ['sku' => 'LIVE-A', 'barcode' => '1000000000002', 'sale_price' => '20'], 'update'),
            $this->row('t1', 5, ['sku' => 'LIVE-B', 'sale_price' => '20'], 'update'),
            $this->row('t2', 6, ['barcode' => '1000000000002', 'sale_price' => '30'], 'update'),
            $this->row('ghost', 7, ['sku' => 'NO-SUCH', 'sale_price' => '30'], 'update'),
            $this->row('bad-id', 8, ['nebrax_id' => 'not-a-uuid', 'sale_price' => '30'], 'update'),
            $this->row('no-id', 9, ['nebrax_id' => '00000000-0000-4000-8000-000000000000', 'sale_price' => '30'], 'update'),
            $this->row('locked', 10, ['nebrax_id' => $a['id'], 'type' => 'service'], 'update'),
            $this->good('bc', 11, 'BC-NEW', ['barcode' => '1000000000001']),
        ]);
        $rows = $this->rows($this->preview($auth['token'], $id)->assertCreated()->json('data'));

        $this->assertContains('duplicate_in_file', $this->codes($rows['f2']));
        $this->assertNotContains('duplicate_in_file', $this->codes($rows['f1']));
        $this->assertContains('identifier_conflict', $this->codes($rows['mix']));
        $this->assertContains('duplicate_target', $this->codes($rows['t2']));
        $this->assertSame($b['id'], $rows['t2']['match']['target_product_id']);
        $this->assertContains('update_target_missing', $this->codes($rows['ghost']));
        $this->assertContains('invalid_nebrax_id', $this->codes($rows['bad-id']));
        $this->assertContains('target_not_found', $this->codes($rows['no-id']));
        $this->assertContains('update_locked', $this->codes($rows['locked']));
        $this->assertContains('existing_product_matches', $this->codes($rows['bc']));
        $this->assertSame('barcode', $rows['bc']['match']['kind']);
        $this->assertSame($a['id'], $rows['bc']['match']['target_product_id']);
        $this->assertNothingWritten(2);
    }

    /** @test */
    public function a_name_alone_never_matches_an_existing_product(): void
    {
        $auth = $this->registerTenant();
        $this->product($auth['token'], ['name' => 'قهوة عربية', 'sku' => 'COF-1']);
        $id = $this->makeAction($auth, [$this->row('n', 2, ['name' => 'قهوة عربية', 'type' => 'good', 'sale_price' => '10'], 'update')]);
        $row = $this->rows($this->preview($auth['token'], $id)->assertCreated()->json('data'))['n'];

        $this->assertNull($row['match']['target_product_id']);
        $this->assertContains('update_target_missing', $this->codes($row));
    }

    /** @test */
    public function approval_binds_the_exact_preview_and_a_replay_is_idempotent(): void
    {
        $auth = $this->registerTenant();
        $id = $this->makeAction($auth, [$this->good('a', 2, 'OK-1'), $this->good('b', 3, 'OK-2')]);
        $preview = $this->preview($auth['token'], $id)->assertCreated()->json('data');
        $this->assertTrue($preview['approvable']);
        $this->assertSame('ready_for_approval', AiAction::findOrFail($id)->status);
        $this->assertSame(64, strlen($preview['preview_hash']));

        // Re-previewing an unchanged draft returns the same record.
        $again = $this->preview($auth['token'], $id, 1, 'pa-preview-0002')->assertOk()->assertHeader('AI-Action-Preview-Replayed', 'true')->json('data');
        $this->assertSame($preview['id'], $again['id']);

        // A tampered hash is refused before anything is recorded.
        $this->approve($auth['token'], $id, ['id' => $preview['id'], 'preview_hash' => str_repeat('0', 64)])->assertConflict()->assertJsonPath('error.code', 'preview_hash_mismatch');
        $this->withToken($auth['token'])->withHeader('Idempotency-Key', 'pa-approve-noack')->postJson("/api/ai-actions/{$id}/approvals", ['expected_version' => 1, 'preview_id' => $preview['id'], 'preview_hash' => $preview['preview_hash']])->assertStatus(422);

        $approved = $this->approve($auth['token'], $id, $preview)->assertCreated()->assertJsonPath('data.status', 'active')->assertJsonPath('data.action.status', 'approved');
        $this->assertSame($preview['preview_hash'], $approved->json('data.preview_hash'));
        $this->assertSame('approved', AiAction::findOrFail($id)->status);
        $this->assertSame(1, AiActionApproval::withoutGlobalScopes()->count());
        $this->assertSame(64, strlen(AiActionApproval::first()->permission_digest));

        // Same user, different idempotency key: the original approval is returned, not a second one.
        $this->approve($auth['token'], $id, $preview, 1, 'pa-approve-0002')->assertOk()->assertHeader('AI-Action-Approval-Replayed', 'true')->assertJsonPath('data.id', $approved->json('data.id'));
        $this->assertSame(1, AiActionApproval::withoutGlobalScopes()->count());
        $this->assertSame(1, AiActionEvent::withoutGlobalScopes()->where('event', 'approval_granted')->count());

        $show = $this->withToken($auth['token'])->getJson("/api/ai-actions/{$id}/previews/latest")->assertOk();
        $show->assertJsonPath('data.approval.status', 'active')->assertJsonPath('data.id', $preview['id']);
        $this->assertNothingWritten();
    }

    /** @test */
    public function any_edit_invalidates_the_preview_and_the_approval(): void
    {
        $auth = $this->registerTenant();
        $id = $this->makeAction($auth, [$this->good('a', 2, 'ED-1')]);
        $preview = $this->preview($auth['token'], $id)->assertCreated()->json('data');
        $this->approve($auth['token'], $id, $preview)->assertCreated();

        $this->withToken($auth['token'])->withHeader('Idempotency-Key', 'pa-edit-0001')->postJson("/api/ai-actions/{$id}/review/versions", [
            'expected_version' => 1, 'edits' => [['row_id' => 'a', 'fields' => ['sale_price' => '99']]],
        ])->assertCreated()->assertJsonPath('data.status', 'editing');

        $this->assertSame('editing', AiAction::findOrFail($id)->status);
        $this->assertSame('proposal_edited', AiActionPreview::findOrFail($preview['id'])->invalidation_reason);
        $revoked = AiActionApproval::first();
        $this->assertNotNull($revoked->revoked_at);
        $this->assertSame('proposal_edited', $revoked->revocation_reason);
        $this->approve($auth['token'], $id, $preview, 2, 'pa-approve-0003')->assertConflict();
        $this->approve($auth['token'], $id, $preview, 1, 'pa-approve-0004')->assertConflict();

        // The new version needs its own preview, with a different identity.
        $next = $this->preview($auth['token'], $id, 2, 'pa-preview-0003')->assertCreated()->json('data');
        $this->assertNotSame($preview['preview_hash'], $next['preview_hash']);
        $this->assertSame(9900, $this->rows($next)['a']['prices']['sale_price']['after']);
        $this->approve($auth['token'], $id, $next, 2, 'pa-approve-0005')->assertCreated();
        $this->assertNothingWritten();
    }

    /** @test */
    public function cancelling_withdraws_an_approval(): void
    {
        $auth = $this->registerTenant();
        $id = $this->makeAction($auth, [$this->good('a', 2, 'CN-1')]);
        $preview = $this->preview($auth['token'], $id)->assertCreated()->json('data');
        $this->approve($auth['token'], $id, $preview)->assertCreated();

        $this->withToken($auth['token'])->withHeader('Idempotency-Key', 'pa-cancel-0001')->postJson("/api/ai-actions/{$id}/cancel", ['expected_version' => 1])->assertOk()->assertJsonPath('data.status', 'cancelled');
        $this->assertNotNull(AiActionApproval::first()->revoked_at);
        $this->preview($auth['token'], $id, 1, 'pa-preview-0009')->assertConflict()->assertJsonPath('error.code', 'state_conflict');
    }

    /** @test */
    public function a_catalogue_change_after_preview_makes_the_preview_stale_at_approval(): void
    {
        $auth = $this->registerTenant();
        $id = $this->makeAction($auth, [$this->good('a', 2, 'RACE-1')]);
        $preview = $this->preview($auth['token'], $id)->assertCreated()->json('data');
        $this->assertTrue($preview['approvable']);

        // Someone else creates the same SKU after the preview was generated.
        $this->product($auth['token'], ['name' => 'سبق', 'sku' => 'RACE-1']);

        $this->approve($auth['token'], $id, $preview)->assertConflict()->assertJsonPath('error.code', 'preview_stale');
        $this->assertSame(0, AiActionApproval::withoutGlobalScopes()->count());
        $this->assertSame('live_state_changed', AiActionPreview::findOrFail($preview['id'])->invalidation_reason);
        $this->assertSame('editing', AiAction::findOrFail($id)->status);

        $fresh = $this->preview($auth['token'], $id, 1, 'pa-preview-0004')->assertCreated()->json('data');
        $this->assertFalse($fresh['approvable']);
        $this->assertContains('existing_product_matches', $this->codes($this->rows($fresh)['a']));
    }

    /** @test */
    public function an_edit_to_a_target_product_after_preview_makes_the_preview_stale(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token'], ['name' => 'هدف', 'sku' => 'TGT-1', 'sale_price' => 1000]);
        $id = $this->makeAction($auth, [$this->row('u', 2, ['sku' => 'TGT-1', 'sale_price' => '12'], 'update')]);
        $preview = $this->preview($auth['token'], $id)->assertCreated()->json('data');
        $this->assertTrue($preview['approvable']);

        $this->travel(2)->seconds();
        $this->withToken($auth['token'])->putJson("/api/products/{$product['id']}", ['name' => 'هدف معدّل', 'type' => 'good', 'sale_price' => 1000])->assertOk();

        $this->approve($auth['token'], $id, $preview)->assertConflict()->assertJsonPath('error.code', 'preview_stale');
    }

    /** @test */
    public function previews_and_approvals_expire(): void
    {
        $auth = $this->registerTenant();
        $id = $this->makeAction($auth, [$this->good('a', 2, 'EXP-1')]);
        $preview = $this->preview($auth['token'], $id)->assertCreated()->json('data');

        $this->travel((int) config('ai_actions.preview_ttl_minutes') + 1)->minutes();
        $this->approve($auth['token'], $id, $preview)->assertConflict()->assertJsonPath('error.code', 'preview_expired');
        $this->assertSame('expired', AiAction::findOrFail($id)->status);

        $next = $this->preview($auth['token'], $id, 1, 'pa-preview-0005')->assertCreated()->json('data');
        $this->approve($auth['token'], $id, $next, 1, 'pa-approve-0006')->assertCreated();

        $this->travel((int) config('ai_actions.approval_ttl_minutes') + 1)->minutes();
        $this->withToken($auth['token'])->getJson("/api/ai-actions/{$id}")->assertOk()->assertJsonPath('data.status', 'expired');
        $this->approve($auth['token'], $id, $next, 1, 'pa-approve-0007')->assertConflict();
        $this->assertNothingWritten();
    }

    /** @test */
    public function approval_requires_its_own_permission_and_cost_visibility(): void
    {
        $auth = $this->registerTenant();
        $id = $this->makeAction($auth, [$this->good('a', 2, 'PERM-1')]);
        $owner = $this->preview($auth['token'], $id)->assertCreated()->json('data');

        $maker = $this->customRole($auth['tenant_id'], 'maker', ['ai.actions.use', 'products.manage'], 'maker@acme.test');
        $this->approve($maker, $id, $owner, 1, 'pa-approve-m1')->assertForbidden();

        // A maker without cost visibility sees the preview with the purchase price withheld.
        $seen = $this->withToken($maker)->getJson("/api/ai-actions/{$id}/previews/{$owner['id']}")->assertOk();
        $seen->assertJsonPath('data.permissions.cost_hidden', true)->assertJsonPath('data.permissions.can_approve', false);
        $row = $this->rows($seen->json('data'))['a'];
        $this->assertNull($row['prices']['purchase_price']['after']);
        $this->assertTrue($row['prices']['purchase_price']['redacted']);
        $this->assertStringNotContainsString('500', json_encode(array_filter($row['changes'], fn ($c) => $c['field'] === 'purchase_price')));

        // An approver who cannot see cost cannot approve a preview that contains it.
        $blind = $this->customRole($auth['tenant_id'], 'blind-approver', ['ai.actions.use', 'ai.actions.approve', 'products.manage'], 'blind@acme.test');
        $this->approve($blind, $id, $owner, 1, 'pa-approve-b1')->assertForbidden()->assertJsonPath('error.code', 'cost_permission_required');

        $sighted = $this->customRole($auth['tenant_id'], 'sighted-approver', ['ai.actions.use', 'ai.actions.approve', 'products.manage', 'products.view_cost'], 'sighted@acme.test');
        $this->approve($sighted, $id, $owner, 1, 'pa-approve-s1')->assertCreated();

        // Without products.manage the underlying domain permission is missing, even with approve.
        $noDomain = $this->customRole($auth['tenant_id'], 'no-domain', ['ai.actions.use', 'ai.actions.approve'], 'nodomain@acme.test');
        $other = $this->makeAction($auth, [$this->good('a', 2, 'PERM-2')], 'pa-action-0002');
        $otherPreview = $this->preview($auth['token'], $other, 1, 'pa-preview-p2')->assertCreated()->json('data');
        $this->approve($noDomain, $other, $otherPreview, 1, 'pa-approve-n1')->assertForbidden()->assertJsonPath('error.code', 'permission_denied');
        $this->assertSame(1, AiActionApproval::withoutGlobalScopes()->count());
    }

    /** @test */
    public function permission_revoked_before_approval_is_rechecked_live(): void
    {
        $auth = $this->registerTenant();
        $id = $this->makeAction($auth, [$this->good('a', 2, 'REV-1')]);
        $preview = $this->preview($auth['token'], $id)->assertCreated()->json('data');
        $token = $this->customRole($auth['tenant_id'], 'approver', ['ai.actions.use', 'ai.actions.approve', 'products.manage', 'products.view_cost'], 'approver@acme.test');

        app(TenantContext::class)->set($auth['tenant_id']);
        Role::where('slug', 'approver')->update(['permissions' => ['ai.actions.use', 'products.manage', 'products.view_cost']]);
        $this->approve($token, $id, $preview)->assertForbidden();

        $this->assertSame(0, AiActionApproval::withoutGlobalScopes()->count());

        // Restored authority works again — the check is live, not cached from the first attempt.
        Role::where('slug', 'approver')->update(['permissions' => ['ai.actions.use', 'ai.actions.approve', 'products.manage', 'products.view_cost']]);
        $this->approve($token, $id, $preview, 1, 'pa-approve-r2')->assertCreated();
        $this->assertSame(1, AiActionApproval::withoutGlobalScopes()->count());
    }

    /** @test */
    public function branch_context_and_tenant_isolation_are_enforced(): void
    {
        $auth = $this->registerTenant();
        $other = $this->registerTenant('beta', 'owner@beta.test');
        $this->enable($other['tenant_id']);
        $id = $this->makeAction($auth, [$this->good('a', 2, 'ISO-1')]);
        $preview = $this->preview($auth['token'], $id)->assertCreated()->json('data');

        // Another tenant cannot see, preview or approve this action — it does not exist for them.
        // (Route binding precedes SetTenant, so the test sets the ambient context a real request would carry.)
        app(TenantContext::class)->set($other['tenant_id']);
        $this->withToken($other['token'])->getJson("/api/ai-actions/{$id}/previews/{$preview['id']}")->assertNotFound();
        $this->preview($other['token'], $id, 1, 'pa-preview-x1')->assertNotFound();
        $this->approve($other['token'], $id, $preview, 1, 'pa-approve-x1')->assertNotFound();

        // Their identical SKU is invisible to this tenant's matching.
        app(TenantContext::class)->set($other['tenant_id']);
        $this->product($other['token'], ['name' => 'غريب', 'sku' => 'ISO-1']);
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertTrue($this->preview($auth['token'], $id, 1, 'pa-preview-x2')->assertOk()->json('data.approvable'));

        // The action belongs to the branch it was created in.
        $branch = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع الخبر'])->assertCreated()['data']['id'];
        $this->approve($auth['token'], $id, $preview, 1, 'pa-approve-x3', ['X-Branch-Id' => $branch])->assertConflict()->assertJsonPath('error.code', 'branch_context_conflict');
        $this->preview($auth['token'], $id, 1, 'pa-preview-x3', ['X-Branch-Id' => $branch])->assertConflict()->assertJsonPath('error.code', 'branch_context_conflict');
        $this->assertSame(0, AiActionApproval::withoutGlobalScopes()->count());
    }

    /** @test */
    public function the_feature_remains_gated_and_has_no_execution_route(): void
    {
        $auth = $this->registerTenant();
        $this->withToken($auth['token'])->withHeader('Idempotency-Key', 'pa-gate-0001')->postJson('/api/ai-actions/00000000-0000-4000-8000-000000000000/previews', ['expected_version' => 1])->assertNotFound();
        $id = $this->makeAction($auth, [$this->good('a', 2, 'GATE-1')]);
        config(['ai_actions.enabled' => false]);
        $this->preview($auth['token'], $id)->assertForbidden();
        config(['ai_actions.enabled' => true]);
        $this->withToken($auth['token'])->postJson("/api/ai-actions/{$id}/execute")->assertNotFound();
        $this->assertNothingWritten();
    }

    /** @test */
    public function reviewers_can_set_decisions_and_a_decision_survives_later_field_edits(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token'], ['name' => 'قائم', 'sku' => 'DEC-1', 'sale_price' => 1000]);
        $id = $this->makeAction($auth, [$this->row('r', 2, ['sku' => 'DEC-1', 'name' => 'قائم', 'type' => 'good', 'sale_price' => '15'], 'needs_review')]);

        $edit = fn (int $version, string $key, array $edit) => $this->withToken($auth['token'])->withHeader('Idempotency-Key', $key)
            ->postJson("/api/ai-actions/{$id}/review/versions", ['expected_version' => $version, 'edits' => [['row_id' => 'r'] + $edit]]);

        $edit(1, 'pa-dec-0001', ['decision' => 'needs_review'])->assertStatus(422);
        $edit(1, 'pa-dec-0002', [])->assertStatus(422);
        $edit(1, 'pa-dec-0003', ['decision' => 'update'])->assertCreated()->assertJsonPath('data.latest_version.proposal.rows.0.decision', 'update');
        $edit(2, 'pa-dec-0004', ['fields' => ['sale_price' => '16']])->assertCreated()->assertJsonPath('data.latest_version.proposal.rows.0.decision', 'update');

        $row = $this->rows($this->preview($auth['token'], $id, 3, 'pa-preview-d1')->assertCreated()->json('data'))['r'];
        $this->assertSame('update', $row['operation']);
        $this->assertSame($product['id'], $row['match']['target_product_id']);
        $this->assertContains(['field' => 'sale_price', 'before' => 1000, 'after' => 1600], $row['changes']);
    }

    /** @test */
    public function paging_and_operation_filters_do_not_change_the_preview_identity(): void
    {
        $auth = $this->registerTenant();
        $rows = [];
        foreach (range(1, 5) as $i) $rows[] = $this->good("r{$i}", $i + 1, "PG-{$i}");
        $rows[] = $this->row('s', 7, ['sku' => 'PG-S'], 'skip');
        $id = $this->makeAction($auth, $rows);
        $preview = $this->preview($auth['token'], $id)->assertCreated()->json('data');

        $page = $this->withToken($auth['token'])->getJson("/api/ai-actions/{$id}/previews/{$preview['id']}?operation=create&per_page=2&page=3")->assertOk();
        $page->assertJsonPath('data.pagination.total', 5)->assertJsonPath('data.pagination.last_page', 3)->assertJsonCount(1, 'data.rows');
        $this->assertSame($preview['preview_hash'], $page->json('data.preview_hash'));
        $this->withToken($auth['token'])->getJson("/api/ai-actions/{$id}/previews/not-a-uuid")->assertNotFound();
    }

    /** @test */
    public function a_second_approver_cannot_reuse_an_already_approved_preview(): void
    {
        $auth = $this->registerTenant();
        $id = $this->makeAction($auth, [$this->good('a', 2, 'TWO-1')]);
        $preview = $this->preview($auth['token'], $id)->assertCreated()->json('data');
        $this->approve($auth['token'], $id, $preview)->assertCreated();

        $second = $this->customRole($auth['tenant_id'], 'second', ['ai.actions.use', 'ai.actions.approve', 'products.manage', 'products.view_cost'], 'second@acme.test');
        $this->approve($second, $id, $preview, 1, 'pa-approve-t2')->assertConflict()->assertJsonPath('error.code', 'already_decided');
        $this->assertSame(1, AiActionApproval::withoutGlobalScopes()->count());
    }

    /** @test */
    public function previews_and_approvals_cannot_be_rewritten_or_deleted(): void
    {
        $auth = $this->registerTenant();
        $id = $this->makeAction($auth, [$this->good('a', 2, 'IMM-1')]);
        $preview = $this->preview($auth['token'], $id)->assertCreated()->json('data');
        $this->approve($auth['token'], $id, $preview)->assertCreated();

        $model = AiActionPreview::findOrFail($preview['id']);
        $model->preview_hash = str_repeat('f', 64);
        try {
            $model->save();
            $this->fail('A preview was rewritten.');
        } catch (\LogicException) {
            $this->assertSame($preview['preview_hash'], AiActionPreview::findOrFail($preview['id'])->preview_hash);
        }
        $approval = AiActionApproval::firstOrFail();
        $approval->preview_hash = str_repeat('f', 64);
        $this->expectException(\LogicException::class);
        $approval->save();
    }

    /** @test */
    public function the_preview_hash_is_stable_and_sensitive_to_every_bound_input(): void
    {
        $preview = ['totals' => ['rows' => 1], 'rows' => [['row_id' => 'a', 'b' => 2, 'a' => 1]]];
        $reordered = ['rows' => [['a' => 1, 'row_id' => 'a', 'b' => 2]], 'totals' => ['rows' => 1]];
        $hash = \App\Support\AiActionCanonicalJson::previewHash('t', 'a', 'product_import.v1', 1, $preview);

        $this->assertSame($hash, \App\Support\AiActionCanonicalJson::previewHash('t', 'a', 'product_import.v1', 1, $reordered));
        $this->assertNotSame($hash, \App\Support\AiActionCanonicalJson::previewHash('t', 'a', 'product_import.v1', 2, $preview));
        $this->assertNotSame($hash, \App\Support\AiActionCanonicalJson::previewHash('other', 'a', 'product_import.v1', 1, $preview));
        $this->assertNotSame($hash, \App\Support\AiActionCanonicalJson::previewHash('t', 'b', 'product_import.v1', 1, $preview));
        $this->assertNotSame($hash, \App\Support\AiActionCanonicalJson::previewHash('t', 'a', 'product_import.v1', 1, ['totals' => ['rows' => 2]] + $preview));
        $this->assertNotSame($hash, \App\Support\AiActionCanonicalJson::hash('t', 'a', 1, $preview), 'a preview hash is never a proposal hash');
    }

    /** @test */
    public function money_is_typed_as_integer_minor_units_without_floats(): void
    {
        $money = fn (string $v) => \App\Support\ProductImportValueNormalizer::normalize('sale_price', $v);

        $this->assertSame([1050, null], $money('10.50'));
        $this->assertSame([1999, null], $money('١٩٫٩٩'));
        $this->assertSame([123456, null], $money('1,234.56'));
        $this->assertSame([10, null], $money('0.1'));
        $this->assertSame([null, 'invalid_money'], $money('10.555'));
        $this->assertSame([null, 'invalid_money'], $money('-1'));
        $this->assertSame([null, 'invalid_money'], $money('1e3'));
        $this->assertSame([null, null], $money('  '));
        $this->assertSame([15, null], \App\Support\ProductImportValueNormalizer::normalize('tax_rate', '15%'));
        $this->assertSame([null, 'integer_out_of_range'], \App\Support\ProductImportValueNormalizer::normalize('tax_rate', '101'));
        $this->assertSame(['service', null], \App\Support\ProductImportValueNormalizer::normalize('type', 'خدمة'));
    }

    /** @test */
    public function creating_a_product_requires_explicit_price_tax_unit_and_an_identifier_without_defaults(): void
    {
        $auth = $this->registerTenant();
        $id = $this->makeAction($auth, [
            $this->row('bare', 2, ['name' => 'عارٍ', 'type' => 'good', 'sale_price' => '10']),
            $this->row('nocost', 3, ['sku' => 'N-1', 'name' => 'ب', 'type' => 'good', 'sale_price' => '10', 'tax_rate' => '15', 'unit' => 'قطعة']),
            $this->row('notax', 4, ['sku' => 'N-2', 'name' => 'ج', 'type' => 'good', 'sale_price' => '10', 'purchase_price' => '5', 'unit' => 'قطعة']),
            $this->row('nounit', 5, ['sku' => 'N-3', 'name' => 'د', 'type' => 'good', 'sale_price' => '10', 'purchase_price' => '5', 'tax_rate' => '15']),
            $this->row('noid', 6, ['name' => 'هـ', 'type' => 'good', 'sale_price' => '10', 'purchase_price' => '5', 'tax_rate' => '15', 'unit' => 'قطعة']),
        ]);
        $preview = $this->preview($auth['token'], $id)->assertCreated()->json('data');
        $rows = $this->rows($preview);

        $this->assertFalse($preview['approvable']);
        $this->assertEqualsCanonicalizing(['purchase_price_missing', 'tax_rate_missing', 'unit_missing', 'trusted_identifier_missing'], $this->errorCodes($rows['bare']));
        $this->assertSame(['purchase_price_missing'], $this->errorCodes($rows['nocost']));
        $this->assertSame(['tax_rate_missing'], $this->errorCodes($rows['notax']));
        $this->assertSame(['unit_missing'], $this->errorCodes($rows['nounit']));
        $this->assertSame(['trusted_identifier_missing'], $this->errorCodes($rows['noid']));
        foreach ($rows as $row) {
            $this->assertSame('blocked', $row['operation']);
        }
        // Nothing is invented for a missing value: no defaulted purchase price, tax, unit or generated SKU.
        $this->assertSame(['name', 'type', 'sale_price'], array_column($rows['bare']['changes'], 'field'));
        $this->assertArrayNotHasKey('purchase_price', $rows['bare']['prices']);
        $this->assertArrayNotHasKey('tax_rate', $rows['bare']['prices']);
        $this->assertNotContains('purchase_price', array_column($rows['nocost']['changes'], 'field'));
        $this->assertNotContains('tax_rate', array_column($rows['notax']['changes'], 'field'));
        $this->assertNotContains('unit', array_column($rows['nounit']['changes'], 'field'));
        $this->assertNotContains('sku', array_column($rows['noid']['changes'], 'field'));
        $this->approve($auth['token'], $id, $preview)->assertStatus(422)->assertJsonPath('error.code', 'preview_blocked');
        $this->assertSame(0, AiActionApproval::withoutGlobalScopes()->count());
        $this->assertNothingWritten();
    }

    /** @test */
    public function explicit_zero_values_and_a_barcode_satisfy_the_contract_and_optional_fields_stay_optional(): void
    {
        $auth = $this->registerTenant();
        $id = $this->makeAction($auth, [
            // Explicit zeros are explicit; a barcode alone is a trusted identifier; no optional field is demanded.
            $this->row('zero', 2, ['barcode' => '9000000000001', 'name' => 'صفري', 'type' => 'service', 'sale_price' => '0', 'purchase_price' => '0', 'tax_rate' => '0', 'unit' => 'ساعة']),
            // An update needs none of unit/tax/purchase price/identifiers beyond its target.
            $this->row('upd', 3, ['sku' => 'EXIST-1', 'sale_price' => '12'], 'update'),
        ]);
        $this->product($auth['token'], ['name' => 'قائم', 'sku' => 'EXIST-1', 'sale_price' => 1000]);
        $preview = $this->preview($auth['token'], $id)->assertCreated()->json('data');
        $rows = $this->rows($preview);

        $this->assertTrue($preview['approvable'], json_encode($preview['issues'] + array_map(fn ($r) => $r['issues'], $preview['rows'])));
        $this->assertSame('create', $rows['zero']['operation']);
        $this->assertSame([], $this->codes($rows['zero']));
        $this->assertSame(0, $rows['zero']['prices']['purchase_price']['after']);
        $this->assertSame('update', $rows['upd']['operation']);
        $this->approve($auth['token'], $id, $preview)->assertCreated();
    }

    /** @test */
    public function purchase_price_is_withheld_from_every_payload_for_users_without_cost_permission(): void
    {
        $auth = $this->registerTenant();
        $id = $this->makeAction($auth, [$this->good('a', 2, 'COST-1', ['purchase_price' => '7.77'])]);
        $blind = $this->customRole($auth['tenant_id'], 'blind', ['ai.actions.use', 'ai.actions.approve', 'products.manage'], 'blind@acme.test');
        $fileId = AiActionFile::withoutGlobalScopes()->where('ai_action_id', $id)->value('id');

        // The permitted owner sees the value everywhere it is exposed.
        $this->withToken($auth['token'])->getJson("/api/ai-actions/{$id}/review")->assertOk()->assertJsonPath('data.proposal.rows.0.fields.purchase_price.value', '7.77')->assertJsonPath('data.action.cost_hidden', false);
        $this->withToken($auth['token'])->getJson("/api/ai-actions/{$id}/files/{$fileId}/extraction")->assertOk()->assertJsonPath('data.manifest.rows.0.fields.purchase_price.value', '7.77');
        $this->preview($auth['token'], $id)->assertCreated();

        $responses = [
            'review' => $this->withToken($blind)->getJson("/api/ai-actions/{$id}/review"),
            'show' => $this->withToken($blind)->getJson("/api/ai-actions/{$id}"),
            'extraction' => $this->withToken($blind)->getJson("/api/ai-actions/{$id}/files/{$fileId}/extraction"),
            'preview' => $this->withToken($blind)->getJson("/api/ai-actions/{$id}/previews/latest"),
        ];
        foreach ($responses as $name => $response) {
            $response->assertOk();
            $this->assertStringNotContainsString('7.77', $response->getContent(), "{$name} leaked the purchase price");
            $this->assertStringNotContainsString('777', $response->getContent(), "{$name} leaked the purchase price in minor units");
        }
        $responses['review']->assertJsonPath('data.proposal.rows.0.fields.purchase_price.value', null)->assertJsonPath('data.action.cost_hidden', true);
        $responses['show']->assertJsonPath('data.cost_hidden', true);
        $responses['extraction']->assertJsonPath('data.cost_hidden', true)->assertJsonPath('data.manifest.rows.0.fields.purchase_price.value', null);
        $responses['preview']->assertJsonPath('data.permissions.cost_hidden', true);

        // Saving through the review flow returns a redacted version too, and does not disturb the stored cost.
        $saved = $this->withToken($blind)->withHeader('Idempotency-Key', 'pa-cost-edit-1')->postJson("/api/ai-actions/{$id}/review/versions", ['expected_version' => 1, 'edits' => [['row_id' => 'a', 'fields' => ['name' => 'اسم جديد']]]])->assertCreated();
        $this->assertStringNotContainsString('7.77', $saved->getContent());
        $this->withToken($auth['token'])->getJson("/api/ai-actions/{$id}/review")->assertJsonPath('data.proposal.rows.0.fields.purchase_price.value', '7.77')->assertJsonPath('data.proposal.rows.0.fields.name.value', 'اسم جديد');
        $this->assertNothingWritten();
    }

    /** @test */
    public function a_user_without_cost_permission_cannot_write_purchase_prices_or_wipe_them(): void
    {
        $auth = $this->registerTenant();
        $id = $this->makeAction($auth, [$this->good('a', 2, 'COST-2', ['purchase_price' => '7.77'])]);
        $blind = $this->customRole($auth['tenant_id'], 'blind-writer', ['ai.actions.use', 'products.manage'], 'blindw@acme.test');

        // Review edit and raw version/create with a purchase price are refused.
        $this->withToken($blind)->withHeader('Idempotency-Key', 'pa-cost-w1')->postJson("/api/ai-actions/{$id}/review/versions", ['expected_version' => 1, 'edits' => [['row_id' => 'a', 'fields' => ['purchase_price' => '1']]]])
            ->assertForbidden()->assertJsonPath('error.code', 'cost_permission_required');
        $row = $this->row('a', 2, ['sku' => 'COST-2', 'name' => 'x', 'type' => 'good', 'sale_price' => '10', 'purchase_price' => '1']);
        $this->withToken($blind)->withHeader('Idempotency-Key', 'pa-cost-w2')->postJson("/api/ai-actions/{$id}/versions", ['expected_version' => 1, 'proposal' => ['schema_version' => 1, 'rows' => [$row]]])
            ->assertForbidden()->assertJsonPath('error.code', 'cost_permission_required');
        $this->withToken($blind)->withHeader('Idempotency-Key', 'pa-cost-w3')->postJson('/api/ai-actions', ['type' => 'product_import.v1', 'proposal' => ['schema_version' => 1, 'rows' => [$row]]])
            ->assertForbidden()->assertJsonPath('error.code', 'cost_permission_required');
        $this->assertSame(1, AiAction::findOrFail($id)->version);

        // Echoing the redacted proposal back (no cost) keeps the stored cost instead of wiping it.
        $echo = $this->withToken($blind)->getJson("/api/ai-actions/{$id}/review")->json('data.proposal');
        $this->withToken($blind)->withHeader('Idempotency-Key', 'pa-cost-w4')->postJson("/api/ai-actions/{$id}/versions", ['expected_version' => 1, 'proposal' => $echo])->assertCreated();
        $this->withToken($auth['token'])->getJson("/api/ai-actions/{$id}/review")->assertJsonPath('data.proposal.rows.0.fields.purchase_price.value', '7.77');
        $preview = $this->preview($auth['token'], $id, 2, 'pa-preview-cw')->assertCreated()->json('data');
        $this->assertSame(777, $this->rows($preview)['a']['prices']['purchase_price']['after']);
    }

    /** @test */
    public function cost_data_never_crosses_tenants_and_is_scoped_per_role(): void
    {
        $auth = $this->registerTenant();
        $other = $this->registerTenant('beta', 'owner@beta.test');
        $this->enable($other['tenant_id']);
        $id = $this->makeAction($auth, [$this->good('a', 2, 'TEN-1', ['purchase_price' => '7.77'])]);
        $preview = $this->preview($auth['token'], $id)->assertCreated()->json('data');
        $fileId = AiActionFile::withoutGlobalScopes()->where('ai_action_id', $id)->value('id');

        // The other tenant's owner holds products.view_cost in their own tenant, but the action is not theirs.
        app(TenantContext::class)->set($other['tenant_id']);
        foreach (["/api/ai-actions/{$id}", "/api/ai-actions/{$id}/review", "/api/ai-actions/{$id}/files/{$fileId}/extraction", "/api/ai-actions/{$id}/previews/{$preview['id']}", "/api/ai-actions/{$id}/previews/latest"] as $url) {
            $response = $this->withToken($other['token'])->getJson($url);
            $response->assertNotFound();
            $this->assertStringNotContainsString('7.77', $response->getContent());
        }

        // Cost permission is per role, resolved live: revoking it hides the value on the very next read.
        $role = $this->customRole($auth['tenant_id'], 'cost-viewer', ['ai.actions.use', 'products.manage', 'products.view_cost'], 'costviewer@acme.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->withToken($role)->getJson("/api/ai-actions/{$id}/review")->assertJsonPath('data.proposal.rows.0.fields.purchase_price.value', '7.77');
        Role::where('slug', 'cost-viewer')->update(['permissions' => ['ai.actions.use', 'products.manage']]);
        $after = $this->withToken($role)->getJson("/api/ai-actions/{$id}/review");
        $this->assertStringNotContainsString('7.77', $after->getContent());
    }

    /** @test */
    public function a_user_who_can_approve_and_see_cost_still_approves_their_own_preview(): void
    {
        $auth = $this->registerTenant();
        $solo = $this->customRole($auth['tenant_id'], 'solo', ['ai.actions.use', 'ai.actions.approve', 'products.manage', 'products.view_cost'], 'solo@acme.test');
        $id = $this->makeAction(['token' => $solo, 'tenant_id' => $auth['tenant_id']], [$this->good('a', 2, 'SOLO-1')]);
        $preview = $this->preview($solo, $id)->assertCreated()->json('data');

        $this->assertSame(AiAction::findOrFail($id)->created_by, $preview['generated_by']);
        $this->approve($solo, $id, $preview)->assertCreated();
        $this->assertSame(AiAction::findOrFail($id)->created_by, AiActionApproval::firstOrFail()->approved_by);
    }
}
