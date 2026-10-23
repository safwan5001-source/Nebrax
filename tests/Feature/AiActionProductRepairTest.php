<?php

namespace Tests\Feature;

use App\Models\AiAction;
use App\Models\AiActionEvent;
use App\Models\AiActionExecutionRow;
use App\Models\AiActionImage;
use App\Models\AiActionRepair;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Product;
use App\Models\ProductActivity;
use App\Models\ProductMedia;
use App\Models\StockMovement;
use App\Services\ProductService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;
use ZipArchive;

/**
 * AI-ACTIONS-06B: a failed row is repaired by a NEW action that holds only that row. The original execution, its
 * per-row results and its audit trail never change, and a row that succeeded is never repeated.
 */
class AiActionProductRepairTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use InteractsWithAiProductActions;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        config(['document_center.storage.driver' => 'local', 'document_center.storage.disk' => 'local']);
    }

    private function execute(string $token, string $id, int $version = 1, string $key = 'rp-exec-0001')
    {
        return $this->withToken($token)->withHeader('Idempotency-Key', $key)->postJson("/api/ai-actions/{$id}/executions", ['expected_version' => $version]);
    }

    private function candidates(string $token, string $id, string $execution)
    {
        return $this->withToken($token)->getJson("/api/ai-actions/{$id}/executions/{$execution}/repair");
    }

    private function startRepair(string $token, string $id, string $execution, string $key = 'rp-start-0001')
    {
        return $this->withToken($token)->withHeader('Idempotency-Key', $key)->postJson("/api/ai-actions/{$id}/executions/{$execution}/repairs");
    }

    private function review(string $token, string $id, int $version, array $edits, string $key = 'rp-review-0001')
    {
        return $this->withToken($token)->withHeader('Idempotency-Key', $key)->postJson("/api/ai-actions/{$id}/review/versions", ['expected_version' => $version, 'edits' => $edits]);
    }

    private function assertNoAccountingOrStockEffect(): void
    {
        $this->assertSame(0, StockMovement::withoutGlobalScopes()->count());
        $this->assertSame(0, Invoice::withoutGlobalScopes()->count());
        $this->assertSame(0, JournalEntry::withoutGlobalScopes()->count());
    }

    /**
     * An execution with one success and two permanent failures (the target changed, and a SKU was taken) — exactly
     * what a retry cannot fix.
     *
     * @return array{id:string,execution:string,target:string,taken:string}
     */
    private function failedExecution(array $auth, string $prefix = 'rp'): array
    {
        config(['ai_actions.execution_batch_rows' => 1]);
        $target = $this->product($auth['token'], ['name' => 'هدف', 'sku' => 'B-T', 'sale_price' => 1000]);
        $id = $this->makeAction($auth, [$this->good('a', 2, 'B-1'), $this->row('u', 3, ['sku' => 'B-T', 'description' => 'وصف جديد'], 'update'), $this->good('c', 4, 'B-3')], $prefix.'-action');
        $preview = $this->preview($auth['token'], $id, 1, $prefix.'-preview')->assertCreated()->json('data');
        $this->approve($auth['token'], $id, $preview, 1, $prefix.'-approve')->assertCreated();

        $this->execute($auth['token'], $id, 1, $prefix.'-exec-1')->assertCreated();
        $this->travel(2)->seconds();
        $this->withToken($auth['token'])->putJson("/api/products/{$target['id']}", ['name' => 'تغيّر', 'type' => 'good', 'sale_price' => 1000])->assertOk();
        $taken = $this->product($auth['token'], ['name' => 'سابق', 'sku' => 'B-3']);
        $this->execute($auth['token'], $id, 1, $prefix.'-exec-2')->assertOk();
        $final = $this->execute($auth['token'], $id, 1, $prefix.'-exec-3')->assertOk()->json('data');
        $this->assertSame('partially_failed', $final['status']);

        return ['id' => $id, 'execution' => $final['id'], 'target' => $target['id'], 'taken' => $taken['id']];
    }

    /** @test */
    public function a_repair_holds_only_the_failed_rows_and_leaves_the_original_untouched(): void
    {
        $auth = $this->registerTenant();
        $run = $this->failedExecution($auth);
        $before = AiActionExecutionRow::withoutGlobalScopes()->orderBy('source_row')->get(['row_id', 'status', 'error_code', 'attempts', 'product_id'])->toArray();
        $events = AiActionEvent::withoutGlobalScopes()->where('ai_action_id', $run['id'])->count();

        $plan = $this->candidates($auth['token'], $run['id'], $run['execution'])->assertOk()->json('data');
        $this->assertSame(['u', 'c'], array_column($plan['rows'], 'row_id'));
        $rows = collect($plan['rows'])->keyBy('row_id');
        $this->assertSame('target_changed', $rows['u']['failure']['code']);
        $this->assertEqualsCanonicalizing(['nebrax_id', 'sku', 'barcode'], $rows['u']['affected_fields']);
        $this->assertSame('conflict_existing_product', $rows['c']['failure']['code']);
        $this->assertEqualsCanonicalizing(['sku', 'barcode'], $rows['c']['affected_fields']);
        $this->assertNull($plan['open_repair']);

        $started = $this->startRepair($auth['token'], $run['id'], $run['execution'])->assertCreated()->json('data');
        $this->assertSame(2, $started['rows']);
        $this->assertNotSame($run['id'], $started['action_id']);

        $review = $this->withToken($auth['token'])->getJson("/api/ai-actions/{$started['action_id']}/review")->assertOk()->json('data');
        $this->assertSame(['u', 'c'], array_column($review['proposal']['rows'], 'row_id'), 'the successful row is not part of the repair');
        $this->assertSame('created', $review['action']['status']);

        // Nothing about the original moved: results, statuses, attempts, and no product was written by starting a repair.
        $this->assertSame($before, AiActionExecutionRow::withoutGlobalScopes()->orderBy('source_row')->get(['row_id', 'status', 'error_code', 'attempts', 'product_id'])->toArray());
        $this->assertSame('partially_failed', AiAction::findOrFail($run['id'])->status);
        $this->assertSame($events + 1, AiActionEvent::withoutGlobalScopes()->where('ai_action_id', $run['id'])->count());
        $this->assertSame(1, AiActionEvent::withoutGlobalScopes()->where('ai_action_id', $run['id'])->where('event', 'repair_started')->count());
        $info = $this->withToken($auth['token'])->getJson("/api/ai-actions/{$started['action_id']}/repair")->assertOk()->json('data');
        $this->assertSame($run['id'], $info['origin']['action_id']);
        $this->assertSame(['u', 'c'], array_column($info['rows'], 'row_id'));
        $this->assertNoAccountingOrStockEffect();
    }

    /** @test */
    public function only_one_open_repair_exists_per_execution_and_a_repeat_returns_it(): void
    {
        $auth = $this->registerTenant();
        $run = $this->failedExecution($auth);

        $first = $this->startRepair($auth['token'], $run['id'], $run['execution'])->assertCreated()->json('data');
        $again = $this->startRepair($auth['token'], $run['id'], $run['execution'], 'rp-start-0002')->assertOk()->assertHeader('AI-Action-Repair-Replayed', 'true')->json('data');
        $this->assertSame($first['action_id'], $again['action_id']);
        $same = $this->startRepair($auth['token'], $run['id'], $run['execution'])->assertCreated(); // same key: stored response replayed
        $same->assertHeader('Idempotency-Replayed', 'true');
        $this->assertSame(1, AiActionRepair::withoutGlobalScopes()->count());
        $this->assertSame(2, AiAction::withoutGlobalScopes()->count());
        $this->assertSame($first['action_id'], $this->candidates($auth['token'], $run['id'], $run['execution'])->json('data.open_repair.action_id'));
    }

    /** @test */
    public function a_repair_may_edit_only_the_fields_tied_to_the_failure_and_keeps_every_other_value_source(): void
    {
        $auth = $this->registerTenant();
        $run = $this->failedExecution($auth);
        $repair = $this->startRepair($auth['token'], $run['id'], $run['execution'])->assertCreated()->json('data.action_id');

        // `name` did not cause a SKU conflict: it is not editable here.
        $this->review($auth['token'], $repair, 1, [['row_id' => 'c', 'fields' => ['name' => 'اسم آخر']]])->assertStatus(422)->assertJsonPath('error.code', 'repair_field_locked');
        $this->assertSame(1, AiAction::findOrFail($repair)->version);

        $this->review($auth['token'], $repair, 1, [['row_id' => 'c', 'fields' => ['sku' => 'B-3-FIXED']]], 'rp-review-0002')->assertCreated();
        $rows = collect($this->withToken($auth['token'])->getJson("/api/ai-actions/{$repair}/review")->json('data.proposal.rows'))->keyBy('row_id');
        $this->assertSame(['B-3-FIXED', 'user'], [$rows['c']['fields']['sku']['value'], $rows['c']['fields']['sku']['origin']]);
        $this->assertSame('extracted', $rows['c']['fields']['name']['origin'], 'untouched values keep their source');
        $this->assertSame('منتج B-3', $rows['c']['fields']['name']['value']);
        // The original proposal is not edited by repairing.
        $original = collect($this->withToken($auth['token'])->getJson("/api/ai-actions/{$run['id']}/review")->json('data.proposal.rows'))->keyBy('row_id');
        $this->assertSame('B-3', $original['c']['fields']['sku']['value']);
        $this->assertSame('extracted', $original['c']['fields']['sku']['origin']);

        // Changing the decision (e.g. to skip) is always allowed.
        $this->review($auth['token'], $repair, 2, [['row_id' => 'u', 'decision' => 'skip']], 'rp-review-0003')->assertCreated();
    }

    /** @test */
    public function the_repair_gets_its_own_preview_and_approval_and_repeats_no_successful_row(): void
    {
        $auth = $this->registerTenant();
        $run = $this->failedExecution($auth);
        $aProduct = Product::withoutGlobalScopes()->where('sku', 'B-1')->firstOrFail();
        $aUpdatedAt = $aProduct->updated_at;
        $repair = $this->startRepair($auth['token'], $run['id'], $run['execution'])->assertCreated()->json('data.action_id');
        $this->review($auth['token'], $repair, 1, [['row_id' => 'c', 'fields' => ['sku' => 'B-3-FIXED']]])->assertCreated();

        // No approval of the original is reused: executing the repair first fails.
        $this->execute($auth['token'], $repair, 2, 'rp-exec-r0')->assertConflict();

        $preview = $this->preview($auth['token'], $repair, 2, 'rp-preview-repair')->assertCreated()->json('data');
        $this->assertTrue($preview['approvable'], json_encode(array_map(fn ($r) => $r['issues'], $preview['rows'])));
        $byRow = $this->rows($preview);
        $this->assertSame('create', $byRow['c']['operation']);
        // The previously stale target is re-matched against the live product (fresh version), so it can now apply.
        $this->assertSame('update', $byRow['u']['operation']);
        $this->approve($auth['token'], $repair, $preview, 2, 'rp-approve-repair')->assertCreated();

        config(['ai_actions.execution_batch_rows' => 200]);
        $result = $this->execute($auth['token'], $repair, 2, 'rp-exec-r1')->assertCreated()->json('data');
        $this->assertSame('completed', $result['status']);
        $this->assertSame(['u', 'c'], array_column($result['rows'], 'row_id'));
        $this->assertNotNull(Product::withoutGlobalScopes()->where('sku', 'B-3-FIXED')->first());
        $this->assertSame('وصف جديد', Product::withoutGlobalScopes()->findOrFail($run['target'])->description);
        // The conflicting product that existed is untouched, and the product that had already succeeded is not touched again.
        $this->assertSame('سابق', Product::withoutGlobalScopes()->findOrFail($run['taken'])->name);
        $this->assertSame(1, Product::withoutGlobalScopes()->where('sku', 'B-1')->count());
        $this->assertEquals($aUpdatedAt, Product::withoutGlobalScopes()->findOrFail($aProduct->id)->updated_at);
        $this->assertSame(1, ProductActivity::withoutGlobalScopes()->where('action', 'created')->where('product_id', $aProduct->id)->count());

        // The original result history is intact; the repaired rows are no longer offered.
        $this->assertSame(['failed', 'failed'], AiActionExecutionRow::withoutGlobalScopes()->where('ai_action_id', $run['id'])->whereIn('row_id', ['u', 'c'])->orderBy('source_row')->pluck('status')->all());
        $this->assertSame('partially_failed', AiAction::findOrFail($run['id'])->status);
        $this->candidates($auth['token'], $run['id'], $run['execution'])->assertOk()->assertJsonPath('data.rows', []);
        Cache::flush();
        $this->startRepair($auth['token'], $run['id'], $run['execution'], 'rp-start-late')->assertConflict()->assertJsonPath('error.code', 'nothing_to_repair');
        $this->assertNoAccountingOrStockEffect();
    }

    /** @test */
    public function a_transient_failure_is_retried_not_repaired_until_the_approval_expires(): void
    {
        $auth = $this->registerTenant();
        $id = $this->makeAction($auth, [$this->good('a', 2, 'T-1'), $this->good('b', 3, 'T-2')], 'rp-transient');
        $preview = $this->preview($auth['token'], $id, 1, 'rp-transient-pv')->assertCreated()->json('data');
        $this->approve($auth['token'], $id, $preview, 1, 'rp-transient-ap')->assertCreated();
        $flaky = new class(app(ProductService::class)) extends ProductService {
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
        $this->assertTrue($execution['permissions']['can_retry']);

        $plan = $this->candidates($auth['token'], $id, $execution['id'])->assertOk()->json('data');
        $this->assertSame([], $plan['rows']);
        $this->assertSame(1, $plan['retry_pending']);
        $this->startRepair($auth['token'], $id, $execution['id'])->assertConflict()->assertJsonPath('error.code', 'repair_use_retry');

        // Once the approval has expired a retry is impossible; the same row becomes repairable (re-validate + re-approve).
        $this->travel(config('ai_actions.approval_ttl_minutes') + 5)->minutes();
        $plan = $this->candidates($auth['token'], $id, $execution['id'])->assertOk()->json('data');
        $this->assertSame(['b'], array_column($plan['rows'], 'row_id'));
        $this->assertSame([], $plan['rows'][0]['affected_fields'], 'a transient error is not tied to any field');
        $this->assertSame('none', $plan['rows'][0]['scope']);
        $repair = $this->startRepair($auth['token'], $id, $execution['id'], 'rp-start-exp')->assertCreated()->json('data.action_id');
        $this->review($auth['token'], $repair, 1, [['row_id' => 'b', 'fields' => ['sku' => 'T-9']]])->assertStatus(422)->assertJsonPath('error.code', 'repair_field_locked');
        $this->assertSame(1, Product::withoutGlobalScopes()->where('sku', 'T-1')->count());
    }

    /** @test */
    public function a_domain_rule_rejection_opens_the_rows_own_fields_but_never_the_identifier_or_other_rows(): void
    {
        $auth = $this->registerTenant();
        $id = $this->makeAction($auth, [$this->good('a', 2, 'R-1'), $this->good('b', 3, 'R-2')], 'rp-rule-case');
        $preview = $this->preview($auth['token'], $id, 1, 'rp-rule-pv')->assertCreated()->json('data');
        $this->approve($auth['token'], $id, $preview, 1, 'rp-rule-ap')->assertCreated();
        $strict = new class(app(ProductService::class)) extends ProductService {
            public function __construct(private ProductService $inner) {}

            public function create(array $data, ?string $userId = null, bool $generateSku = true): Product
            {
                if (($data['sku'] ?? null) === 'R-2') {
                    throw new \RuntimeException('قاعدة نشاط ترفض هذا المنتج.');
                }

                return $this->inner->create($data, $userId, $generateSku);
            }
        };
        $this->app->instance(ProductService::class, $strict);
        $execution = $this->execute($auth['token'], $id)->assertCreated()->json('data');
        $this->assertSame('rule_rejected', collect($execution['rows'])->firstWhere('row_id', 'b')['error_code']);

        $repair = $this->startRepair($auth['token'], $id, $execution['id'])->assertCreated()->json('data.action_id');
        $info = $this->withToken($auth['token'])->getJson("/api/ai-actions/{$repair}/repair")->json('data.rows.0');
        $this->assertSame('all', $info['scope']);
        $this->assertContains('name', $info['affected_fields']);
        $this->assertContains('sale_price', $info['affected_fields']);
        $this->assertNotContains('nebrax_id', $info['affected_fields']);
        $this->review($auth['token'], $repair, 1, [['row_id' => 'b', 'fields' => ['name' => 'اسم مقبول']]])->assertCreated();
        // Row `a` succeeded: it is not in the repair, so it cannot be addressed by it.
        $this->review($auth['token'], $repair, 2, [['row_id' => 'a', 'fields' => ['name' => 'x']]], 'rp-review-x')->assertStatus(422);
    }

    /** @test */
    public function repair_is_permissioned_tenant_scoped_and_requires_a_finished_failed_execution(): void
    {
        $auth = $this->registerTenant();
        $other = $this->registerTenant('beta', 'owner@beta.test');
        $run = $this->failedExecution($auth);
        $noRepair = $this->customRole($auth['tenant_id'], 'norepair', ['ai.actions.use', 'ai.actions.approve', 'products.manage', 'products.view_cost'], 'norepair@acme.test');

        $this->startRepair($noRepair, $run['id'], $run['execution'])->assertForbidden();
        $this->candidates($noRepair, $run['id'], $run['execution'])->assertOk(); // reading what could be repaired needs only `use`
        $this->assertSame(0, AiActionRepair::withoutGlobalScopes()->count());

        app(TenantContext::class)->set($other['tenant_id']);
        $this->enable($other['tenant_id']);
        $this->candidates($other['token'], $run['id'], $run['execution'])->assertNotFound();
        $this->startRepair($other['token'], $run['id'], $run['execution'], 'rp-start-x')->assertNotFound();
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->candidates($auth['token'], $run['id'], 'not-a-uuid')->assertNotFound();

        // The repair belongs to the branch of the action it repairs.
        $branch = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع الخبر'])->assertCreated()['data']['id'];
        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $branch])->getJson("/api/ai-actions/{$run['id']}/executions/{$run['execution']}/repair")->assertConflict()->assertJsonPath('error.code', 'branch_context_conflict');
        $this->withoutHeader('X-Branch-Id');
        app(\App\Tenancy\BranchContext::class)->forget();
        // An execution with no failure has nothing to repair.
        Cache::flush(); // the setup above used up the throttled routes
        $ok = $this->makeAction($auth, [$this->good('z', 2, 'OK-1')], 'rp-ok-action');
        $preview = $this->preview($auth['token'], $ok, 1, 'rp-ok-preview')->assertCreated()->json('data');
        $this->approve($auth['token'], $ok, $preview, 1, 'rp-ok-approve')->assertCreated();
        $done = $this->execute($auth['token'], $ok, 1, 'rp-ok-exec-1')->assertCreated()->json('data');
        $this->startRepair($auth['token'], $ok, $done['id'], 'rp-start-ok')->assertConflict()->assertJsonPath('error.code', 'repair_not_available');
    }

    /** @test */
    public function a_user_without_cost_visibility_cannot_start_a_repair_that_would_copy_purchase_prices(): void
    {
        $auth = $this->registerTenant();
        $run = $this->failedExecution($auth);
        $blind = $this->customRole($auth['tenant_id'], 'blindrepair', ['ai.actions.use', 'ai.actions.approve', 'ai.actions.repair', 'products.manage'], 'blind@acme.test');

        $this->startRepair($blind, $run['id'], $run['execution'])->assertForbidden()->assertJsonPath('error.code', 'cost_permission_required');
        $this->assertSame(0, AiActionRepair::withoutGlobalScopes()->count());
        $this->assertSame(1, AiAction::withoutGlobalScopes()->count(), 'the failed attempt left no half-built repair action');
    }

    /** @test */
    public function a_repair_record_is_immutable(): void
    {
        $auth = $this->registerTenant();
        $run = $this->failedExecution($auth);
        $this->startRepair($auth['token'], $run['id'], $run['execution'])->assertCreated();

        $repair = AiActionRepair::withoutGlobalScopes()->firstOrFail();
        $this->expectException(\LogicException::class);
        $repair->forceFill(['rows' => []])->save();
    }

    /** @test */
    public function a_repair_can_itself_fail_and_be_repaired(): void
    {
        $auth = $this->registerTenant();
        $id = $this->makeAction($auth, [$this->good('a', 2, 'C-1')], 'rp-chain-action');
        $this->product($auth['token'], ['name' => 'مستخدم', 'sku' => 'C-1X']);
        $preview = $this->preview($auth['token'], $id, 1, 'rp-chain-pvw')->assertCreated()->json('data');
        $this->approve($auth['token'], $id, $preview, 1, 'rp-chain-apv')->assertCreated();
        $strict = new class(app(ProductService::class)) extends ProductService {
            public int $calls = 0;

            public function __construct(private ProductService $inner) {}

            public function create(array $data, ?string $userId = null, bool $generateSku = true): Product
            {
                if (++$this->calls <= 2) {
                    throw new \RuntimeException('قاعدة نشاط ترفض هذا المنتج.');
                }

                return $this->inner->create($data, $userId, $generateSku);
            }
        };
        $this->app->instance(ProductService::class, $strict);
        $first = $this->execute($auth['token'], $id)->assertCreated()->json('data');
        $this->assertSame('failed', $first['status']);

        $repair1 = $this->startRepair($auth['token'], $id, $first['id'])->assertCreated()->json('data.action_id');
        $preview = $this->preview($auth['token'], $repair1, 1, 'rp-chain-pvw1')->assertCreated()->json('data');
        $this->approve($auth['token'], $repair1, $preview, 1, 'rp-chain-apv1')->assertCreated();
        $second = $this->execute($auth['token'], $repair1, 1, 'rp-chain-e1')->assertCreated()->json('data');
        $this->assertSame('failed', $second['status']);

        // The repair's own failure is repairable: the chain keeps every link and nothing is lost.
        $repair2 = $this->startRepair($auth['token'], $repair1, $second['id'], 'rp-start-chain2')->assertCreated()->json('data.action_id');
        $preview = $this->preview($auth['token'], $repair2, 1, 'rp-chain-pvw2')->assertCreated()->json('data');
        $this->approve($auth['token'], $repair2, $preview, 1, 'rp-chain-apv2')->assertCreated();
        $third = $this->execute($auth['token'], $repair2, 1, 'rp-chain-e2')->assertCreated()->json('data');
        $this->assertSame('completed', $third['status']);
        $this->assertSame(1, Product::withoutGlobalScopes()->where('sku', 'C-1')->count());
        $this->assertSame(2, AiActionRepair::withoutGlobalScopes()->count());
        $this->assertSame('failed', AiAction::findOrFail($id)->status);
        $this->assertSame('failed', AiAction::findOrFail($repair1)->status);
    }

    private function png(int $rgb): string
    {
        $image = imagecreatetruecolor(8, 8);
        imagefill($image, 0, 0, $rgb);
        ob_start();
        imagepng($image);

        return (string) ob_get_clean();
    }

    private function zip(array $entries): UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'ai-repair-zip-');
        $zip = new ZipArchive();
        $zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE);
        foreach ($entries as $entry => $bytes) {
            $zip->addFromString($entry, $bytes);
        }
        $zip->close();

        return new UploadedFile($path, 'images.zip', 'application/zip', null, true);
    }

    /** @test */
    public function a_product_that_lost_an_image_is_repaired_by_adding_only_that_image_never_by_rewriting_the_product(): void
    {
        $auth = $this->registerTenant();
        $bytes = $this->png(0xAA0000);
        $id = $this->makeAction($auth, [$this->good('a', 2, 'IM-1')], 'rp-image-action');
        $this->withToken($auth['token'])->withHeader('Idempotency-Key', 'rp-img-zip')
            ->post("/api/ai-actions/{$id}/image-archives", ['expected_version' => 1, 'archive' => $this->zip(['IM-1.png' => $bytes])], ['Accept' => 'application/json'])->assertCreated();
        $preview = $this->preview($auth['token'], $id, 1, 'rp-image-pv')->assertCreated()->json('data');
        $this->approve($auth['token'], $id, $preview, 1, 'rp-image-ap')->assertCreated();
        // The staged bytes are swapped for another valid image after approval: the image fails, permanently.
        $staged = AiActionImage::withoutGlobalScopes()->firstOrFail();
        Storage::disk('local')->put($staged->storage_key, $this->png(0x00AA00));
        $execution = $this->execute($auth['token'], $id)->assertCreated()->json('data');
        $this->assertSame('partially_failed', $execution['status']);
        $product = Product::withoutGlobalScopes()->where('sku', 'IM-1')->firstOrFail();
        $updatedAt = $product->updated_at;
        $this->assertSame(0, ProductMedia::withoutGlobalScopes()->count());

        $plan = $this->candidates($auth['token'], $id, $execution['id'])->assertOk()->json('data');
        $this->assertSame(['images'], array_column($plan['rows'], 'kind'));
        $this->assertSame('image_changed', $plan['rows'][0]['failure']['code']);
        $this->assertEqualsCanonicalizing(['primary_image_url', 'additional_image_urls'], $plan['rows'][0]['affected_fields']);

        $repair = $this->startRepair($auth['token'], $id, $execution['id'])->assertCreated()->json('data.action_id');
        // The stored object no longer matches its recorded hash, so it is NOT carried over: the repair has to be given
        // the picture again instead of re-blessing corrupted bytes.
        $this->assertSame(0, AiActionImage::withoutGlobalScopes()->where('ai_action_id', $repair)->count());
        $this->withToken($auth['token'])->withHeader('Idempotency-Key', 'rp-img-zip2')
            ->post("/api/ai-actions/{$repair}/image-archives", ['expected_version' => 1, 'archive' => $this->zip(['IM-1.png' => $bytes])], ['Accept' => 'application/json'])->assertCreated();
        $copied = AiActionImage::withoutGlobalScopes()->where('ai_action_id', $repair)->firstOrFail();
        $this->assertSame(hash('sha256', $bytes), $copied->content_sha256);
        $this->assertNotSame($staged->storage_key, $copied->storage_key);

        // Without the explicit decision the existing product's gallery is left alone.
        $row = $this->rows($this->preview($auth['token'], $repair, 1, 'rp-img-pv1')->assertCreated()->json('data'))['a'];
        $this->assertSame('needs_decision', $row['images']['status']);
        $this->assertSame('skip', $row['operation']);
        $this->review($auth['token'], $repair, 1, [['row_id' => 'a', 'media_update_approved' => true]], 'rp-img-rv')->assertCreated();
        Cache::flush();
        $preview = $this->preview($auth['token'], $repair, 2, 'rp-img-pv2')->assertCreated()->json('data');
        $this->assertSame('update', $this->rows($preview)['a']['operation']);
        $this->assertSame(hash('sha256', $bytes), $this->rows($preview)['a']['images']['items'][0]['image']['sha256']);
        $this->approve($auth['token'], $repair, $preview, 2, 'rp-img-ap2')->assertCreated();

        $result = $this->execute($auth['token'], $repair, 2, 'rp-img-e')->assertCreated()->json('data');
        $this->assertSame('completed', $result['status']);
        $this->assertSame([hash('sha256', $bytes)], ProductMedia::withoutGlobalScopes()->pluck('content_sha256')->all());
        $this->assertEquals($updatedAt, Product::withoutGlobalScopes()->findOrFail($product->id)->updated_at, 'the product record was not rewritten');
        $this->assertSame(1, ProductActivity::withoutGlobalScopes()->where('action', 'created')->where('product_id', $product->id)->count());
        $this->assertSame(0, ProductActivity::withoutGlobalScopes()->where('action', 'updated')->where('product_id', $product->id)->count());
        // The original keeps its failed image result.
        $this->assertSame('failed', collect($this->withToken($auth['token'])->getJson("/api/ai-actions/{$id}/executions/{$execution['id']}")->json('data.rows.0.images'))->first()['status']);
    }
}
