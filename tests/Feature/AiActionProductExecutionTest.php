<?php

namespace Tests\Feature;

use App\Models\AiAction;
use App\Models\AiActionApproval;
use App\Models\AiActionEvent;
use App\Models\AiActionExecution;
use App\Models\AiActionExecutionRow;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Product;
use App\Models\ProductActivity;
use App\Models\ProductCategory;
use App\Models\ProductMedia;
use App\Models\Role;
use App\Models\StockMovement;
use App\Services\ProductService;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * AI-ACTIONS-05: applying an approved preview. Each scenario checks what was written AND what was not
 * (stock, ledger, media), because the contract is "only the approved catalogue changes".
 */
class AiActionProductExecutionTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use InteractsWithAiProductActions;

    private function execute(string $token, string $id, int $version = 1, string $key = 'pe-exec-0001', array $headers = [])
    {
        return $this->withToken($token)->withHeaders($headers + ['Idempotency-Key' => $key])->postJson("/api/ai-actions/{$id}/executions", ['expected_version' => $version]);
    }

    private function retry(string $token, string $id, string $execution, string $key = 'pe-retry-0001')
    {
        return $this->withToken($token)->withHeader('Idempotency-Key', $key)->postJson("/api/ai-actions/{$id}/executions/{$execution}/retry");
    }

    /** Creates the action, previews and approves it; returns [id, preview]. */
    private function approved(array $auth, array $rows, string $key = 'pe-act-0001'): array
    {
        $id = $this->makeAction($auth, $rows, $key);
        $preview = $this->preview($auth['token'], $id, 1, $key.'-pv')->assertCreated()->json('data');
        $this->assertTrue($preview['approvable'], json_encode(array_map(fn ($r) => $r['issues'], $preview['rows'])));
        $this->approve($auth['token'], $id, $preview, 1, $key.'-ap')->assertCreated();

        return [$id, $preview];
    }

    private function assertNoAccountingOrStockEffect(): void
    {
        $this->assertSame(0, StockMovement::withoutGlobalScopes()->count());
        $this->assertSame(0, Invoice::withoutGlobalScopes()->count());
        $this->assertSame(0, JournalEntry::withoutGlobalScopes()->count());
        $this->assertSame(0, (int) Product::withoutGlobalScopes()->sum('quantity_on_hand'));
    }

    private function byRow(array $execution): array
    {
        return collect($execution['rows'])->keyBy('row_id')->all();
    }

    /** @test */
    public function approval_alone_writes_nothing_and_execution_is_dark_by_default(): void
    {
        $auth = $this->registerTenant();
        [$id] = $this->approved($auth, [$this->good('a', 2, 'DARK-1')]);

        $this->assertSame(0, Product::withoutGlobalScopes()->count());
        $this->assertSame('approved', AiAction::findOrFail($id)->status);

        config(['ai_actions.execution_enabled' => false]);
        $this->execute($auth['token'], $id)->assertForbidden()->assertJsonPath('error.code', 'execution_disabled');
        $this->assertSame(0, Product::withoutGlobalScopes()->count());
        $this->assertSame(0, AiActionExecution::withoutGlobalScopes()->count());
    }

    /** @test */
    public function it_creates_updates_and_skips_exactly_what_was_approved_without_touching_stock_or_the_ledger(): void
    {
        $auth = $this->registerTenant();
        $existing = $this->product($auth['token'], ['name' => 'قائم', 'sku' => 'EX-1', 'sale_price' => 1000, 'purchase_price' => 500, 'description' => 'قديم']);
        $category = ProductCategory::create(['name' => 'قهوة']);
        [$id, $preview] = $this->approved($auth, [
            $this->good('new', 2, 'NEW-1', ['category' => 'قهوة', 'brand' => 'علامة حرة', 'primary_image_url' => 'https://img.example/a.jpg', 'unit_template' => 'قالب']),
            $this->row('bar', 3, ['barcode' => '9000000000001', 'name' => 'باركود فقط', 'type' => 'service', 'sale_price' => '0', 'purchase_price' => '0', 'tax_rate' => '0', 'unit' => 'ساعة']),
            $this->row('upd', 4, ['sku' => 'EX-1', 'sale_price' => '12.25', 'description' => 'جديد'], 'update'),
            $this->row('skp', 5, ['sku' => 'SKP-1', 'name' => 'متخطّى'], 'skip'),
        ]);
        $beforeUpdatedAt = Product::withoutGlobalScopes()->findOrFail($existing['id'])->updated_at;
        $this->travel(2)->seconds();

        $response = $this->execute($auth['token'], $id)->assertCreated();
        $execution = $response->json('data');
        $rows = $this->byRow($execution);

        $this->assertSame('completed', $execution['status']);
        $this->assertSame(['total' => 4, 'pending' => 0, 'success' => 3, 'failed' => 0, 'skipped' => 1], $execution['progress']);
        $this->assertSame('success', $rows['new']['status']);
        $this->assertSame(['images', 'unit_template'], $rows['new']['deferred']);
        $this->assertSame('skipped', $rows['skp']['status']);

        $new = Product::withoutGlobalScopes()->where('sku', 'NEW-1')->firstOrFail();
        $this->assertSame($new->id, $rows['new']['product_id']);
        $this->assertSame([1050, 500, 15, 'قطعة', 'good'], [(int) $new->sale_price, (int) $new->purchase_price, (int) $new->tax_rate, $new->unit, $new->type]);
        $this->assertSame($category->id, $new->category_id);
        $this->assertNull($new->category);
        $this->assertSame('علامة حرة', $new->brand);
        $this->assertNull($new->unit_template_id);

        // Explicit zeros stay zero (no silent default tax/price), and a barcode-only row gets no invented SKU.
        $bar = Product::withoutGlobalScopes()->where('barcode', '9000000000001')->firstOrFail();
        $this->assertNull($bar->sku);
        $this->assertSame([0, 0, 0, 'service'], [(int) $bar->sale_price, (int) $bar->purchase_price, (int) $bar->tax_rate, $bar->type]);

        $updated = Product::withoutGlobalScopes()->findOrFail($existing['id']);
        $this->assertSame([1225, 'جديد', 'قائم', 'EX-1'], [(int) $updated->sale_price, $updated->description, $updated->name, $updated->sku]);
        $this->assertSame(500, (int) $updated->purchase_price);
        $this->assertTrue($updated->updated_at->gt($beforeUpdatedAt));
        $this->assertEqualsCanonicalizing(['sale_price', 'description'], $rows['upd']['changed_fields']);
        $this->assertNull(Product::withoutGlobalScopes()->where('sku', 'SKP-1')->first());

        // Product lifecycle audit is written by the canonical services, attributed to the executing user.
        $this->assertSame(2, ProductActivity::withoutGlobalScopes()->where('action', 'created')->whereIn('product_id', [$new->id, $bar->id])->count());
        $this->assertSame(1, ProductActivity::withoutGlobalScopes()->where('action', 'updated')->where('product_id', $updated->id)->count());
        $this->assertSame('executed', AiAction::findOrFail($id)->status);
        // Images are deferred: nothing was fetched or attached, and the result says so.
        $this->assertSame(0, ProductMedia::withoutGlobalScopes()->count());
        $this->assertSame('deferred', $execution['deferred']['images']);
        $this->assertNoAccountingOrStockEffect();
        $this->assertSame(1, AiActionEvent::withoutGlobalScopes()->where('event', 'execution_started')->count());
        $this->assertSame(1, AiActionEvent::withoutGlobalScopes()->where('event', 'execution_completed')->count());
    }

    /** @test */
    public function a_replayed_or_repeated_request_never_duplicates_products(): void
    {
        $auth = $this->registerTenant();
        [$id] = $this->approved($auth, [$this->good('a', 2, 'ONCE-1'), $this->good('b', 3, 'ONCE-2')]);

        $first = $this->execute($auth['token'], $id)->assertCreated();
        $this->assertSame(2, Product::withoutGlobalScopes()->count());
        // Same Idempotency-Key (lost response, retried): the stored response is replayed.
        $this->execute($auth['token'], $id)->assertCreated()->assertHeader('Idempotency-Replayed', 'true')->assertJsonPath('data.id', $first->json('data.id'));
        // A different key (user double-click / reconnect): the recorded execution is returned, nothing re-applied.
        $again = $this->execute($auth['token'], $id, 1, 'pe-exec-other')->assertOk()->assertHeader('AI-Action-Execution-Replayed', 'true');
        $this->assertSame($first->json('data.id'), $again->json('data.id'));
        $this->assertSame('completed', $again->json('data.status'));

        $this->assertSame(2, Product::withoutGlobalScopes()->count());
        $this->assertSame(1, AiActionExecution::withoutGlobalScopes()->count());
        $this->assertSame(2, AiActionExecutionRow::withoutGlobalScopes()->where('status', 'success')->sum('attempts'));
        $this->assertSame(1, ProductActivity::withoutGlobalScopes()->where('action', 'created')->whereHas('product', fn ($q) => $q->where('sku', 'ONCE-1'))->count());
        $this->assertNoAccountingOrStockEffect();
    }

    /** @test */
    public function an_approval_cannot_be_executed_by_another_user_tenant_or_action(): void
    {
        $auth = $this->registerTenant();
        $other = $this->registerTenant('beta', 'owner@beta.test');
        [$id] = $this->approved($auth, [$this->good('a', 2, 'OWN-1')]);
        [$second] = $this->approved($auth, [$this->good('a', 2, 'OWN-2')], 'pe-act-0002');

        // Another user who may approve — but the approval is not theirs.
        $thief = $this->customRole($auth['tenant_id'], 'thief', ['ai.actions.use', 'ai.actions.approve', 'products.manage', 'products.view_cost'], 'thief@acme.test');
        $this->execute($thief, $id, 1, 'pe-exec-thief')->assertForbidden()->assertJsonPath('error.code', 'approval_owner_mismatch');
        // A user without the approve permission never reaches the service.
        $maker = $this->customRole($auth['tenant_id'], 'maker', ['ai.actions.use', 'products.manage'], 'maker@acme.test');
        $this->execute($maker, $id, 1, 'pe-exec-maker')->assertForbidden();
        // Another tenant cannot see the action at all.
        app(TenantContext::class)->set($other['tenant_id']);
        $this->enable($other['tenant_id']);
        $this->execute($other['token'], $id, 1, 'pe-exec-x')->assertNotFound();
        app(TenantContext::class)->set($auth['tenant_id']);

        $this->assertSame(0, Product::withoutGlobalScopes()->count());
        // Each approval executes only its own preview.
        $this->execute($auth['token'], $second, 1, 'pe-exec-second')->assertCreated();
        $this->assertSame(['OWN-2'], Product::withoutGlobalScopes()->pluck('sku')->all());
        $this->assertSame('approved', AiAction::findOrFail($id)->status);
    }

    /** @test */
    public function an_expired_revoked_or_edited_approval_cannot_execute(): void
    {
        $auth = $this->registerTenant();
        [$id] = $this->approved($auth, [$this->good('a', 2, 'EXP-1')]);
        [$edited] = $this->approved($auth, [$this->good('a', 2, 'EXP-2')], 'pe-act-0002');

        $this->withToken($auth['token'])->withHeader('Idempotency-Key', 'pe-edit-1')->postJson("/api/ai-actions/{$edited}/review/versions", ['expected_version' => 1, 'edits' => [['row_id' => 'a', 'fields' => ['name' => 'معدّل']]]])->assertCreated();
        $this->execute($auth['token'], $edited, 1, 'pe-exec-edited')->assertConflict()->assertJsonPath('error.code', 'state_conflict');
        $this->execute($auth['token'], $edited, 2, 'pe-exec-edited2')->assertConflict();

        $this->travel((int) config('ai_actions.approval_ttl_minutes') + 1)->minutes();
        $this->execute($auth['token'], $id, 1, 'pe-exec-expired')->assertConflict();
        $this->assertSame(0, Product::withoutGlobalScopes()->count());
        $this->assertSame(0, AiActionExecution::withoutGlobalScopes()->count());
    }

    /** @test */
    public function a_catalogue_change_after_approval_blocks_the_whole_execution_before_any_write(): void
    {
        $auth = $this->registerTenant();
        $target = $this->product($auth['token'], ['name' => 'هدف', 'sku' => 'T-1', 'sale_price' => 1000]);
        [$id] = $this->approved($auth, [$this->good('new', 2, 'FRESH-1'), $this->row('upd', 3, ['sku' => 'T-1', 'sale_price' => '20'], 'update')]);

        $this->travel(2)->seconds();
        $this->withToken($auth['token'])->putJson("/api/products/{$target['id']}", ['name' => 'عُدّل بعد الموافقة', 'type' => 'good', 'sale_price' => 1000])->assertOk();

        $this->execute($auth['token'], $id)->assertConflict()->assertJsonPath('error.code', 'approval_stale');
        $this->assertSame(1, Product::withoutGlobalScopes()->count());
        $this->assertSame(1000, (int) Product::withoutGlobalScopes()->findOrFail($target['id'])->sale_price);
        $this->assertNotNull(AiActionApproval::first()->revoked_at);
        $this->assertSame('editing', AiAction::findOrFail($id)->status);
        $this->assertSame(0, AiActionExecution::withoutGlobalScopes()->count());
        // The stale approval cannot be reused.
        $this->execute($auth['token'], $id, 1, 'pe-exec-again')->assertConflict();
    }

    /** @test */
    public function permissions_and_cost_authority_are_rechecked_at_execution(): void
    {
        $auth = $this->registerTenant();
        $token = $this->customRole($auth['tenant_id'], 'executor', ['ai.actions.use', 'ai.actions.approve', 'products.manage', 'products.view_cost'], 'executor@acme.test');
        $asExecutor = ['token' => $token, 'tenant_id' => $auth['tenant_id']];
        [$id] = $this->approved($asExecutor, [$this->good('a', 2, 'PERM-1', ['purchase_price' => '7.77'])]);

        $set = fn (array $permissions) => Role::where('slug', 'executor')->update(['permissions' => $permissions]);
        app(TenantContext::class)->set($auth['tenant_id']);

        $set(['ai.actions.use', 'products.manage', 'products.view_cost']);
        $this->execute($token, $id, 1, 'pe-exec-p1')->assertForbidden();
        $set(['ai.actions.use', 'ai.actions.approve', 'products.view_cost']);
        $this->execute($token, $id, 1, 'pe-exec-p2')->assertForbidden()->assertJsonPath('error.code', 'permission_denied');
        // Cost data in the approved preview needs products.view_cost at execution time too.
        $set(['ai.actions.use', 'ai.actions.approve', 'products.manage']);
        $this->execute($token, $id, 1, 'pe-exec-p3')->assertForbidden()->assertJsonPath('error.code', 'cost_permission_required');
        $this->assertSame(0, Product::withoutGlobalScopes()->count());

        $set(['ai.actions.use', 'ai.actions.approve', 'products.manage', 'products.view_cost']);
        $response = $this->execute($token, $id, 1, 'pe-exec-p4')->assertCreated();
        $this->assertSame(777, (int) Product::withoutGlobalScopes()->where('sku', 'PERM-1')->value('purchase_price'));
        $this->assertStringNotContainsString('7.77', $response->getContent());

        // Results never carry cost values, even for the permitted user reading them back.
        $this->assertStringNotContainsString('777', $this->withToken($token)->getJson("/api/ai-actions/{$id}/executions/latest")->assertOk()->getContent());
    }

    /** @test */
    public function execution_is_scoped_to_the_branch_the_action_belongs_to(): void
    {
        $auth = $this->registerTenant();
        [$id] = $this->approved($auth, [$this->good('a', 2, 'BR-1')]);
        $branch = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع الخبر'])->assertCreated()['data']['id'];

        $this->execute($auth['token'], $id, 1, 'pe-exec-br', ['X-Branch-Id' => $branch])->assertConflict()->assertJsonPath('error.code', 'branch_context_conflict');
        $this->assertSame(0, Product::withoutGlobalScopes()->count());

        // `withHeaders` persists for the rest of the test; drop the other branch to use the default (main) one.
        $this->withoutHeader('X-Branch-Id');
        app(\App\Tenancy\BranchContext::class)->forget();
        $this->execute($auth['token'], $id, 1, 'pe-exec-br2')->assertCreated();
        $this->assertSame(AiAction::findOrFail($id)->branch_id, Product::withoutGlobalScopes()->where('sku', 'BR-1')->value('branch_id'));
    }

    /** @test */
    public function a_failed_row_is_isolated_and_only_retryable_failures_are_retried_without_repeating_successes(): void
    {
        $auth = $this->registerTenant();
        [$id] = $this->approved($auth, [$this->good('a', 2, 'PF-1'), $this->good('b', 3, 'PF-2'), $this->good('c', 4, 'PF-3')]);

        // The second create throws an unexpected error once.
        $real = app(ProductService::class);
        $flaky = new class($real) extends ProductService {
            public int $calls = 0;

            public function __construct(private ProductService $inner) {}

            public function create(array $data, ?string $userId = null, bool $generateSku = true): Product
            {
                if (++$this->calls === 2) {
                    throw new \Exception('transient');
                }

                return $this->inner->create($data, $userId, $generateSku);
            }
        };
        $this->app->instance(ProductService::class, $flaky);

        $execution = $this->execute($auth['token'], $id)->assertCreated()->json('data');
        $rows = $this->byRow($execution);
        $this->assertSame('partially_failed', $execution['status']);
        $this->assertSame(['a' => 'success', 'b' => 'failed', 'c' => 'success'], array_map(fn ($r) => $r['status'], $rows));
        $this->assertSame('internal_error', $rows['b']['error_code']);
        $this->assertTrue($rows['b']['retryable']);
        $this->assertStringNotContainsString('transient', json_encode($rows['b']));
        $this->assertEqualsCanonicalizing(['PF-1', 'PF-3'], Product::withoutGlobalScopes()->pluck('sku')->all());
        $this->assertSame('partially_failed', AiAction::findOrFail($id)->status);
        $this->assertTrue($execution['permissions']['can_retry']);

        // Re-running the whole thing is not allowed; only the failed row is retried.
        $this->execute($auth['token'], $id, 1, 'pe-exec-again')->assertOk()->assertJsonPath('data.status', 'partially_failed');
        $this->assertSame(2, Product::withoutGlobalScopes()->count());

        $retried = $this->retry($auth['token'], $id, $execution['id'])->assertOk()->json('data');
        $this->assertSame('completed', $retried['status']);
        $this->assertSame(1, $retried['retry_count']);
        $this->assertEqualsCanonicalizing(['PF-1', 'PF-2', 'PF-3'], Product::withoutGlobalScopes()->pluck('sku')->all());
        $this->assertSame(1, Product::withoutGlobalScopes()->where('sku', 'PF-1')->count());
        $byRow = AiActionExecutionRow::withoutGlobalScopes()->get()->keyBy('row_id');
        $this->assertSame([1, 1, 2], [$byRow['a']->attempts, $byRow['c']->attempts, $byRow['b']->attempts]);
        $this->assertSame('executed', AiAction::findOrFail($id)->status);
        $this->retry($auth['token'], $id, $execution['id'], 'pe-retry-0002')->assertConflict()->assertJsonPath('error.code', 'retry_not_available');
        $this->assertNoAccountingOrStockEffect();
    }

    /** @test */
    public function rows_stale_between_batches_fail_without_overwriting_and_are_not_retried(): void
    {
        config(['ai_actions.execution_batch_rows' => 1]);
        $auth = $this->registerTenant();
        $target = $this->product($auth['token'], ['name' => 'هدف', 'sku' => 'B-T', 'sale_price' => 1000]);
        [$id] = $this->approved($auth, [$this->good('a', 2, 'B-1'), $this->row('u', 3, ['sku' => 'B-T', 'sale_price' => '20'], 'update'), $this->good('c', 4, 'B-3')]);

        $first = $this->execute($auth['token'], $id)->assertCreated()->json('data');
        $this->assertSame('running', $first['status']);
        $this->assertSame(['pending' => 2, 'success' => 1], array_intersect_key($first['progress'], ['pending' => 1, 'success' => 1]));

        // Another user edits the target between batches; a conflicting SKU also appears.
        $this->travel(2)->seconds();
        $this->withToken($auth['token'])->putJson("/api/products/{$target['id']}", ['name' => 'تغيّر', 'type' => 'good', 'sale_price' => 1000])->assertOk();
        $this->product($auth['token'], ['name' => 'سابق', 'sku' => 'B-3']);

        $second = $this->execute($auth['token'], $id, 1, 'pe-exec-b2')->assertOk()->json('data');
        $this->assertSame('running', $second['status']);
        $final = $this->execute($auth['token'], $id, 1, 'pe-exec-b3')->assertOk()->json('data');
        $rows = $this->byRow($final);

        $this->assertSame('partially_failed', $final['status']);
        $this->assertSame('target_changed', $rows['u']['error_code']);
        $this->assertSame('conflict_existing_product', $rows['c']['error_code']);
        $this->assertFalse($rows['u']['retryable']);
        $this->assertSame(1000, (int) Product::withoutGlobalScopes()->findOrFail($target['id'])->sale_price);
        $this->assertSame(1, Product::withoutGlobalScopes()->where('sku', 'B-3')->count());
        $this->assertFalse($final['permissions']['can_retry']);
        $this->retry($auth['token'], $id, $final['id'])->assertConflict()->assertJsonPath('error.code', 'nothing_to_retry');
    }

    /** @test */
    public function two_workers_cannot_run_the_same_execution_at_once_and_a_dead_lease_is_recovered(): void
    {
        config(['ai_actions.execution_batch_rows' => 1]);
        $auth = $this->registerTenant();
        [$id] = $this->approved($auth, [$this->good('a', 2, 'LS-1'), $this->good('b', 3, 'LS-2')]);
        $execution = $this->execute($auth['token'], $id)->assertCreated()->json('data');
        $this->assertSame('running', $execution['status']);

        // Another worker holds the lease.
        AiActionExecution::withoutGlobalScopes()->whereKey($execution['id'])->update(['claim_token' => 'other-worker', 'locked_until' => now('UTC')->addSeconds(60)]);
        $this->execute($auth['token'], $id, 1, 'pe-exec-ls2')->assertConflict()->assertJsonPath('error.code', 'execution_in_progress');
        $this->assertSame(1, Product::withoutGlobalScopes()->count());

        // The worker died: once its lease expires the execution resumes and finishes, still once per row.
        $this->travel(61)->seconds();
        $done = $this->execute($auth['token'], $id, 1, 'pe-exec-ls3')->assertOk()->json('data');
        $this->assertSame('completed', $done['status']);
        $this->assertSame(2, Product::withoutGlobalScopes()->count());
        $this->assertNull(AiActionExecution::withoutGlobalScopes()->first()->claim_token);
    }

    /** @test */
    public function the_database_itself_refuses_a_second_execution_and_a_rerun_of_a_finished_row(): void
    {
        $auth = $this->registerTenant();
        [$id] = $this->approved($auth, [$this->good('a', 2, 'DB-1')]);
        $this->execute($auth['token'], $id)->assertCreated();
        $execution = AiActionExecution::withoutGlobalScopes()->firstOrFail();

        try {
            // A savepoint keeps the surrounding (PostgreSQL) test transaction usable after the violation.
            DB::transaction(fn () => AiActionExecution::create($execution->only(['ai_action_id', 'ai_action_approval_id', 'ai_action_preview_id', 'action_version', 'preview_hash', 'started_by', 'status', 'started_at'])));
            $this->fail('A second execution was created for the same approval.');
        } catch (QueryException) {
            $this->assertSame(1, AiActionExecution::withoutGlobalScopes()->count());
        }
        $row = AiActionExecutionRow::withoutGlobalScopes()->firstOrFail();
        $this->expectException(\LogicException::class);
        $row->update(['status' => 'pending']);
    }

    /** @test */
    public function execution_results_are_visible_only_inside_the_tenant(): void
    {
        $auth = $this->registerTenant();
        $other = $this->registerTenant('beta', 'owner@beta.test');
        [$id] = $this->approved($auth, [$this->good('a', 2, 'TN-1')]);
        $execution = $this->execute($auth['token'], $id)->assertCreated()->json('data');

        app(TenantContext::class)->set($other['tenant_id']);
        $this->enable($other['tenant_id']);
        $this->withToken($other['token'])->getJson("/api/ai-actions/{$id}/executions/latest")->assertNotFound();
        $this->withToken($other['token'])->getJson("/api/ai-actions/{$id}/executions/{$execution['id']}")->assertNotFound();
        $this->retry($other['token'], $id, $execution['id'], 'pe-retry-x')->assertNotFound();
        // The same SKU in another tenant is a different product space.
        $this->product($other['token'], ['name' => 'غريب', 'sku' => 'TN-1']);
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(1, Product::withoutGlobalScopes()->where('tenant_id', $auth['tenant_id'])->where('sku', 'TN-1')->count());
    }

    /** @test */
    public function the_traditional_creation_path_still_generates_a_sku_and_the_canonical_service_default_is_unchanged(): void
    {
        $auth = $this->registerTenant();
        $created = $this->withToken($auth['token'])->postJson('/api/products', ['name' => 'يدوي', 'type' => 'good', 'sale_price' => 1000])->assertCreated()['data'];
        $this->assertNotEmpty($created['sku']);

        $product = app(ProductService::class)->create(['name' => 'بلا رمز', 'type' => 'good', 'sale_price' => 100, 'tenant_id' => $auth['tenant_id']], null, false);
        $this->assertNull($product->sku);
    }
}
