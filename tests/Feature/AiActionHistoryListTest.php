<?php

namespace Tests\Feature;

use App\Models\AiAction;
use App\Models\AiActionExecution;
use App\Models\AiActionVersion;
use App\Models\Branch;
use App\Models\Product;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * IMP-H8-S4a: `GET ai-actions` — سجلّ AI Actions للمؤسسة. كل اختبار يتحقق مما يظهر **وما لا يظهر**: العزل بين المستأجرين، نطاق الفرع،
 * بوابات النوع (لا أضعف من `show`)، سقوف الصفحة، وأن الصف ملخّص بلا مقترح ولا تكلفة.
 */
class AiActionHistoryListTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use InteractsWithAiProductActions;

    private function list(string $token, string $query = '')
    {
        return $this->withToken($token)->getJson('/api/ai-actions'.($query === '' ? '' : '?'.$query));
    }

    /** @return string id */
    private function create(array $auth, string $key, string $sku = 'H-1'): string
    {
        $this->enable($auth['tenant_id']);

        return $this->withToken($auth['token'])->withHeader('Idempotency-Key', $key)
            ->postJson('/api/ai-actions', ['type' => 'product_import.v1', 'proposal' => ['schema_version' => 1, 'rows' => [
                $this->good('r1', 2, $sku, ['purchase_price' => '7.25']),
            ]]])->assertCreated()->json('data.id');
    }

    /** @test */
    public function it_lists_a_summary_newest_first_with_pagination_and_no_proposal_or_cost(): void
    {
        $auth = $this->registerTenant('hist-a', 'owner@hist-a.test');
        $first = $this->create($auth, 'hist-create-0001', 'H-1');
        $this->travel(2)->seconds();
        $second = $this->create($auth, 'hist-create-0002', 'H-2');

        $response = $this->list($auth['token'])->assertOk()
            ->assertJsonPath('meta.total', 2)->assertJsonPath('meta.current_page', 1)->assertJsonPath('meta.per_page', 15)
            ->assertJsonPath('data.0.id', $second)->assertJsonPath('data.1.id', $first)
            ->assertJsonPath('data.0.type', 'product_import.v1')->assertJsonPath('data.0.status', 'created')
            ->assertJsonPath('data.0.summary.row_count', 1)->assertJsonPath('data.0.created_by_name', 'المالك')
            ->assertJsonPath('data.0.execution', null);

        $body = (string) $response->getContent();
        $this->assertStringNotContainsString('proposal', $body);
        $this->assertStringNotContainsString('7.25', $body, 'التكلفة لا تظهر في القائمة.');
        $this->assertStringNotContainsString('purchase_price', $body);

        $this->list($auth['token'], 'per_page=1&page=2')->assertOk()
            ->assertJsonPath('meta.last_page', 2)->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $first);
    }

    /** @test */
    public function it_never_returns_another_tenants_actions_and_rejects_scope_override_params(): void
    {
        $a = $this->registerTenant('hist-iso-a', 'owner@hist-iso-a.test');
        $b = $this->registerTenant('hist-iso-b', 'owner@hist-iso-b.test');
        $mine = $this->create($a, 'hist-iso-0001');
        $theirs = $this->create($b, 'hist-iso-0002');

        $this->list($a['token'])->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.id', $mine);
        $this->list($b['token'])->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.id', $theirs);

        foreach (['tenant_id' => $b['tenant_id'], 'created_by' => 'x', 'branch_id' => 'x'] as $key => $value) {
            $this->list($a['token'], http_build_query([$key => $value]))->assertStatus(422);
        }
    }

    /** @test */
    public function the_surface_is_closed_until_the_platform_and_the_tenant_enable_it(): void
    {
        $auth = $this->registerTenant('hist-off', 'owner@hist-off.test');

        config(['ai_actions.enabled' => false]);
        $this->list($auth['token'])->assertForbidden()->assertJsonPath('error.code', 'platform_disabled');

        config(['ai_actions.enabled' => true]);
        $this->list($auth['token'])->assertForbidden()->assertJsonPath('error.code', 'tenant_not_enabled');
    }

    /** @test */
    public function permissions_gate_the_list_and_type_gates_hide_rows_instead_of_leaking_them(): void
    {
        $auth = $this->registerTenant('hist-rbac', 'owner@hist-rbac.test');
        $this->create($auth, 'hist-rbac-0001');

        $noAi = $this->tokenForRole($auth['tenant_id'], 'accountant', 'acc@hist-rbac.test');
        $this->list($noAi)->assertForbidden();

        // ai.actions.use بلا products.manage: يمرّ التفويض العام لكن بوابة النوع تُخفي الصفوف (show سيعطي 403 لها).
        $aiOnly = $this->customRole($auth['tenant_id'], 'ai_only', ['ai.actions.use'], 'ai-only@hist-rbac.test');
        $this->list($aiOnly)->assertOk()->assertJsonPath('meta.total', 0)->assertJsonCount(0, 'data');

        $both = $this->customRole($auth['tenant_id'], 'ai_products', ['ai.actions.use', 'products.manage'], 'ai-products@hist-rbac.test');
        $this->list($both)->assertOk()->assertJsonPath('meta.total', 1);
    }

    /** @test */
    public function operator_controls_apply_to_the_list_exactly_as_they_apply_to_show(): void
    {
        $auth = $this->registerTenant('hist-ctl', 'owner@hist-ctl.test');
        $id = $this->create($auth, 'hist-ctl-0001');
        $this->list($auth['token'])->assertOk()->assertJsonPath('meta.total', 1);

        // بوابة الضوابط مفتوحة ولا منحة للمشغّل (الافتراض الرافض D-11): `show` يُرفض، فالقائمة لا تكشف الصف.
        config(['ai_actions.runtime_controls_enforced' => true]);
        $this->withToken($auth['token'])->getJson("/api/ai-actions/{$id}")->assertForbidden();
        $this->list($auth['token'])->assertOk()->assertJsonPath('meta.total', 0);
    }

    /** @test */
    public function branch_scope_matches_show_only_unbranched_or_active_branch_rows(): void
    {
        $auth = $this->registerTenant('hist-br', 'owner@hist-br.test');
        $unbranched = $this->create($auth, 'hist-br-0001', 'B-1');
        $other = $this->create($auth, 'hist-br-0002', 'B-2');

        app(TenantContext::class)->set($auth['tenant_id']);
        $branch = Branch::create(['name' => 'فرع آخر', 'code' => 'BR-OTHER']);
        AiAction::query()->whereKey($other)->update(['branch_id' => $branch->id]);

        $response = $this->list($auth['token'])->assertOk();
        $ids = array_column($response->json('data'), 'id');
        $this->assertContains($unbranched, $ids);
        $this->assertNotContains($other, $ids, 'سجلّ فرعٍ غير النشط لا يظهر (show يعطي branch_context_conflict).');
    }

    /** @test */
    public function filters_are_a_strict_allow_list_and_page_size_is_capped(): void
    {
        $auth = $this->registerTenant('hist-flt', 'owner@hist-flt.test');
        $one = $this->create($auth, 'hist-flt-0001', 'F-1');
        $two = $this->create($auth, 'hist-flt-0002', 'F-2');
        AiAction::query()->whereKey($two)->update(['status' => AiAction::STATUS_CANCELLED]);

        $this->list($auth['token'], 'status=cancelled')->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.id', $two);
        $this->list($auth['token'], 'status=created')->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.id', $one);
        $this->list($auth['token'], 'type=product_import.v1')->assertOk()->assertJsonPath('meta.total', 2);
        $this->list($auth['token'], 'mine=1')->assertOk()->assertJsonPath('meta.total', 2);
        $this->list($auth['token'], 'mine=0')->assertOk()->assertJsonPath('meta.total', 2);
        $this->list($auth['token'], 'from=2999-01-01')->assertOk()->assertJsonPath('meta.total', 0);
        $this->list($auth['token'], 'from=2000-01-01&to=2999-01-01')->assertOk()->assertJsonPath('meta.total', 2);

        $this->list($auth['token'], 'status=bogus')->assertStatus(422);
        $this->list($auth['token'], 'type=other.v1')->assertStatus(422);
        $this->list($auth['token'], 'from=2026-02-01&to=2026-01-01')->assertStatus(422);
        $this->list($auth['token'], 'per_page=51')->assertStatus(422);
        $this->list($auth['token'], 'per_page=0')->assertStatus(422);
        $this->list($auth['token'], 'page=0')->assertStatus(422);
    }

    /** @test */
    public function mine_excludes_other_users_actions_in_the_same_tenant(): void
    {
        $auth = $this->registerTenant('hist-mine', 'owner@hist-mine.test');
        $ownerAction = $this->create($auth, 'hist-mine-0001');
        $admin = $this->customRole($auth['tenant_id'], 'ai_products', ['ai.actions.use', 'products.manage'], 'p@hist-mine.test');
        $this->withToken($admin)->withHeader('Idempotency-Key', 'hist-mine-0002')
            ->postJson('/api/ai-actions', ['type' => 'product_import.v1', 'proposal' => ['schema_version' => 1, 'rows' => [$this->row('r1', 2, ['sku' => 'M-2', 'name' => 'منتج M-2', 'type' => 'good', 'sale_price' => '10'])]]])
            ->assertCreated();

        $this->list($admin)->assertOk()->assertJsonPath('meta.total', 2);
        $this->list($admin, 'mine=1')->assertOk()->assertJsonPath('meta.total', 1);
        $this->list($auth['token'], 'mine=1')->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.id', $ownerAction);
    }

    /** @test */
    public function an_executed_action_carries_its_latest_execution_and_row_counts_without_n_plus_one(): void
    {
        $auth = $this->registerTenant('hist-exe', 'owner@hist-exe.test');
        $id = $this->makeAction($auth, [$this->good('a', 2, 'E-1'), $this->good('b', 3, 'E-2')], 'hist-exe-0001');
        $preview = $this->preview($auth['token'], $id, 1, 'hist-exe-pv')->assertCreated()->json('data');
        $this->approve($auth['token'], $id, $preview, 1, 'hist-exe-ap')->assertCreated();
        $this->withToken($auth['token'])->withHeader('Idempotency-Key', 'hist-exe-run')
            ->postJson("/api/ai-actions/{$id}/executions", ['expected_version' => 1])->assertCreated();

        $this->assertSame(2, Product::withoutGlobalScopes()->count());
        $row = $this->list($auth['token'])->assertOk()->json('data.0');
        $this->assertSame('executed', $row['status']);
        $this->assertSame('completed', $row['execution']['status']);
        $this->assertSame(['success' => 2], $row['execution']['rows']);
        $this->assertArrayNotHasKey('claim_token', $row['execution']);

        // استعلامات ثابتة لا تنمو مع عدد الصفوف: نضيف سجلات أخرى ونقارن العدد.
        $this->enable($auth['tenant_id']);
        \DB::enableQueryLog();
        $this->list($auth['token'])->assertOk();
        $few = count(\DB::getQueryLog());
        \DB::flushQueryLog();
        for ($i = 0; $i < 6; $i++) {
            $this->withToken($auth['token'])->withHeader('Idempotency-Key', 'hist-exe-more-'.$i)
                ->postJson('/api/ai-actions', ['type' => 'product_import.v1', 'proposal' => ['schema_version' => 1, 'rows' => [$this->good('r', 2, 'X-'.$i)]]])->assertCreated();
        }
        \DB::flushQueryLog();
        $this->list($auth['token'])->assertOk()->assertJsonPath('meta.total', 7);
        $many = count(\DB::getQueryLog());
        \DB::disableQueryLog();
        $this->assertSame($few, $many, 'عدد الاستعلامات لا يتغيّر بعدد الصفوف.');
    }

    /** @test */
    public function the_list_is_read_only(): void
    {
        $auth = $this->registerTenant('hist-ro', 'owner@hist-ro.test');
        $id = $this->create($auth, 'hist-ro-0001');
        $versions = AiActionVersion::withoutGlobalScopes()->count();
        $updated = AiAction::withoutGlobalScopes()->findOrFail($id)->updated_at;

        $this->travel(5)->minutes();
        $this->list($auth['token'])->assertOk();

        $this->assertSame($versions, AiActionVersion::withoutGlobalScopes()->count());
        $this->assertTrue($updated->equalTo(AiAction::withoutGlobalScopes()->findOrFail($id)->updated_at));
        $this->assertSame(0, AiActionExecution::withoutGlobalScopes()->count());
    }

    /** @test */
    public function unauthenticated_requests_are_rejected(): void
    {
        $this->getJson('/api/ai-actions')->assertUnauthorized();
    }
}
