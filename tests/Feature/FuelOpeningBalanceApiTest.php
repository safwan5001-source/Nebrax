<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\FuelOpeningBalance;
use App\Models\FuelStation;
use App\Models\Role;
use App\Models\User;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * FUEL-TANKS-V2 / PR-1 — واجهة REST لمستند الرصيد الافتتاحي للوقود: البوابة، RBAC، النطاق، العزل، إخفاء التكلفة، والأخطاء.
 * البيانات المرجعية والتكاليف وهمية وللاختبارات وحدها.
 */
class FuelOpeningBalanceApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use BuildsFuelOpeningWorld;

    private const BASE = '/api/fuel-stations/opening-balances';

    /** @param array<string,mixed> $w @param list<string> $permissions @return array{user: User, token: string} */
    private function userWith(array $w, string $slug, array $permissions): array
    {
        app(TenantContext::class)->set($w['tenant_id']);
        Role::create(['tenant_id' => $w['tenant_id'], 'slug' => $slug, 'name' => $slug, 'permissions' => $permissions, 'is_system' => false]);
        $user = User::create(['tenant_id' => $w['tenant_id'], 'name' => $slug, 'email' => "{$slug}-{$w['slug']}@fob.test", 'password' => 'password123', 'role' => $slug]);

        return ['user' => $user, 'token' => $user->createToken('api')->plainTextToken];
    }

    /** @param array<string,mixed> $w */
    private function createDraftAsOwner(array $w, array $overrides = []): string
    {
        return $this->withToken($w['owner_token'])->postJson(self::BASE, $this->openingPayload($w, $overrides))->assertCreated()->json('data.id');
    }

    #[Test]
    public function every_route_is_a_404_while_the_deployment_gate_is_closed_even_for_the_owner(): void
    {
        $w = $this->openingWorld();
        $id = $this->createDraftAsOwner($w);
        config(['fuel_stations.opening_balance_enabled' => false]);
        $before = $this->openingEffects($w);
        $t = $w['owner_token'];

        $this->withToken($t)->getJson(self::BASE)->assertNotFound();
        $this->withToken($t)->getJson(self::BASE . "/{$id}")->assertNotFound();
        $this->withToken($t)->getJson(self::BASE . "/{$id}/preview")->assertNotFound();
        $this->withToken($t)->postJson(self::BASE, $this->openingPayload($w))->assertNotFound();
        $this->withToken($t)->putJson(self::BASE . "/{$id}", ['opening_date' => now()->toDateString(), 'lines' => []])->assertNotFound();
        $this->withToken($t)->deleteJson(self::BASE . "/{$id}")->assertNotFound();
        $this->withToken($t)->postJson(self::BASE . "/{$id}/post")->assertNotFound();

        $this->assertSame($before, $this->openingEffects($w));
        $this->assertSame('draft', FuelOpeningBalance::findOrFail($id)->status);
    }

    #[Test]
    public function the_owner_runs_the_whole_draft_preview_post_flow_over_http(): void
    {
        $w = $this->openingWorld();
        $t = $w['owner_token'];
        $payload = $this->openingPayload($w);

        $created = $this->withToken($t)->postJson(self::BASE, $payload)->assertCreated()
            ->assertJsonPath('meta.replayed', false)->assertJsonPath('data.status', 'draft')->assertJsonPath('data.total_liters', '76555')
            ->assertJsonCount(3, 'data.lines');
        $id = $created->json('data.id');
        $this->assertStringStartsWith('FOB-', $created->json('data.number'));

        // إعادة الإرسال بالمفتاح نفسه ⇒ 200 والمستند نفسه.
        $this->withToken($t)->postJson(self::BASE, $payload)->assertOk()->assertJsonPath('meta.replayed', true)->assertJsonPath('data.id', $id);
        $this->assertSame(1, FuelOpeningBalance::count());
        // المفتاح نفسه بمحتوى مختلف ⇒ 422 (تعارض).
        $changed = $payload;
        $changed['lines'][0]['quantity_liters'] = '1';
        $this->withToken($t)->postJson(self::BASE, $changed)->assertStatus(422);

        $this->withToken($t)->getJson(self::BASE)->assertOk()->assertJsonPath('data.0.id', $id);
        $this->withToken($t)->getJson(self::BASE . "/{$id}")->assertOk()->assertJsonPath('data.lines.0.position', 1);

        $preview = $this->withToken($t)->getJson(self::BASE . "/{$id}/preview")->assertOk()
            ->assertJsonPath('data.ready', true)->assertJsonPath('data.total_value_minor', self::TOTAL_VALUE)
            ->assertJsonPath('data.journal.debit.role', 'inventory_asset')->assertJsonPath('data.journal.credit.account_id', $w['opening_account']->id);
        $this->assertSame([], $preview->json('data.blockers'));
        $this->assertSame(0, DB::table('journal_entries')->where('source_type', FuelOpeningBalance::class)->count(), 'المعاينة لا تكتب قيداً');

        $posted = $this->withToken($t)->postJson(self::BASE . "/{$id}/post")->assertOk()
            ->assertJsonPath('data.status', 'posted')->assertJsonPath('meta.replayed', false)->assertJsonPath('data.total_value_minor', self::TOTAL_VALUE);
        $this->assertNotNull($posted->json('data.journal_entry_id'));
        $this->assertSame(1, DB::table('journal_entries')->where('source_type', FuelOpeningBalance::class)->count());

        // إعادة الترحيل ⇒ 200 replayed بلا أثر ثانٍ؛ والتعديل/الحذف بعد الترحيل مرفوض.
        $this->withToken($t)->postJson(self::BASE . "/{$id}/post")->assertOk()->assertJsonPath('meta.replayed', true);
        $this->assertSame(1, DB::table('journal_entries')->where('source_type', FuelOpeningBalance::class)->count());
        $this->withToken($t)->deleteJson(self::BASE . "/{$id}")->assertStatus(422);
        $this->withToken($t)->putJson(self::BASE . "/{$id}", ['opening_date' => now()->toDateString(), 'lines' => [['fuel_tank_id' => $w['tanks']['91']->id, 'quantity_liters' => '1']]])->assertStatus(422);
        $this->withToken($t)->getJson(self::BASE . "/{$id}/preview")->assertOk()->assertJsonPath('data.posted', true);
    }

    #[Test]
    public function a_blocked_posting_returns_422_with_machine_readable_blockers_and_no_trace(): void
    {
        $w = $this->openingWorld(configureAccount: false);
        $id = $this->createDraftAsOwner($w);
        $before = $this->openingEffects($w);

        $response = $this->withToken($w['owner_token'])->postJson(self::BASE . "/{$id}/post")->assertStatus(422)
            ->assertJsonPath('reason', 'opening_blocked');
        $this->assertContains('FUEL_OPENING_ACCOUNT_REQUIRED', array_column($response->json('blockers'), 'code'));
        $this->assertSame($before, $this->openingEffects($w));
    }

    #[Test]
    public function permissions_split_view_manage_and_post_authority(): void
    {
        $w = $this->openingWorld();
        $id = $this->createDraftAsOwner($w);
        $viewer = $this->userWith($w, 'fob-viewer', ['fuel_stations.view']);
        $manager = $this->userWith($w, 'fob-manager', ['fuel_stations.view', 'fuel_stations.manage', 'products.view_cost']);
        $governorNoCost = $this->userWith($w, 'fob-governor', ['fuel_stations.view', 'fuel.governance.manage']);
        $none = $this->userWith($w, 'fob-none', ['pos.sell']);

        // العارض يقرأ فقط.
        $this->withToken($viewer['token'])->getJson(self::BASE)->assertOk();
        $this->withToken($viewer['token'])->getJson(self::BASE . "/{$id}")->assertOk();
        $this->withToken($viewer['token'])->postJson(self::BASE, $this->openingPayload($w, ['costs' => null]))->assertForbidden();
        $this->withToken($viewer['token'])->deleteJson(self::BASE . "/{$id}")->assertForbidden();
        $this->withToken($viewer['token'])->postJson(self::BASE . "/{$id}/post")->assertForbidden();
        // بلا صلاحية وقود لا يقرأ.
        $this->withToken($none['token'])->getJson(self::BASE)->assertForbidden();
        // المدير المالي يكتب المسودة بتكاليفها لكنه لا يرحّل (لا حوكمة).
        $this->withToken($manager['token'])->postJson(self::BASE, $this->openingPayload($w))->assertCreated();
        $this->withToken($manager['token'])->postJson(self::BASE . "/{$id}/post")->assertForbidden();
        // الحوكمة وحدها لا تكفي للترحيل (سلطة التكلفة مطلوبة أيضاً).
        $this->withToken($governorNoCost['token'])->postJson(self::BASE . "/{$id}/post")->assertForbidden();

        $this->assertSame('draft', FuelOpeningBalance::findOrFail($id)->status);
        $this->assertSame(0, DB::table('journal_entries')->where('source_type', FuelOpeningBalance::class)->count());
    }

    #[Test]
    public function a_user_without_cost_authority_cannot_send_or_see_any_cost(): void
    {
        $w = $this->openingWorld();
        $id = $this->createDraftAsOwner($w);
        $clerk = $this->userWith($w, 'fob-clerk', ['fuel_stations.view', 'fuel_stations.manage']);

        // إرسال التكلفة كتابةٌ ماليةٌ ⇒ 403؛ ومن دونها مقبول.
        $this->withToken($clerk['token'])->postJson(self::BASE, $this->openingPayload($w))->assertForbidden();
        $this->withToken($clerk['token'])->postJson(self::BASE, $this->openingPayload($w, ['costs' => null]))->assertCreated();

        // القراءة بلا أي مبلغ.
        $show = $this->withToken($clerk['token'])->getJson(self::BASE . "/{$id}")->assertOk();
        $this->assertArrayNotHasKey('total_value_minor', $show->json('data'));
        foreach ($show->json('data.lines') as $line) {
            $this->assertNull($line['unit_cost_per_liter_minor']);
            $this->assertNull($line['value_minor']);
        }
        $preview = $this->withToken($clerk['token'])->getJson(self::BASE . "/{$id}/preview")->assertOk();
        $this->assertArrayNotHasKey('journal', $preview->json('data'));
        $this->assertArrayNotHasKey('total_value_minor', $preview->json('data'));
        $this->assertStringNotContainsString((string) self::VALUE_95, $preview->getContent());
        $this->assertStringNotContainsString((string) self::TOTAL_VALUE, $show->getContent());
    }

    #[Test]
    public function a_station_scoped_user_gets_404_for_documents_of_stations_outside_their_scope(): void
    {
        $w = $this->openingWorld();
        $id = $this->createDraftAsOwner($w);
        $other = FuelStation::create(['branch_id' => $w['branch']->id, 'warehouse_id' => $w['warehouse']->id, 'code' => 'OTHER-' . $w['slug'], 'name' => 'محطة أخرى']);
        $scoped = $this->userWith($w, 'fob-assigned', ['fuel_stations.view', 'fuel_stations.manage', 'products.view_cost']);
        $scoped['user']->forceFill(['fuel_station_scope' => User::FUEL_SCOPE_ASSIGNED])->save();
        $scoped['user']->fuelStations()->sync([$other->id]);

        $this->withToken($scoped['token'])->getJson(self::BASE . "/{$id}")->assertNotFound();
        $this->withToken($scoped['token'])->getJson(self::BASE . "/{$id}/preview")->assertNotFound();
        $this->withToken($scoped['token'])->putJson(self::BASE . "/{$id}", ['opening_date' => now()->toDateString(), 'lines' => [['fuel_tank_id' => $w['tanks']['91']->id, 'quantity_liters' => '1']]])->assertNotFound();
        $this->withToken($scoped['token'])->deleteJson(self::BASE . "/{$id}")->assertNotFound();
        $this->withToken($scoped['token'])->postJson(self::BASE, $this->openingPayload($w, ['costs' => null]))->assertNotFound();
        $this->assertSame([], $this->withToken($scoped['token'])->getJson(self::BASE)->assertOk()->json('data'));
    }

    #[Test]
    public function a_branch_restricted_user_cannot_reach_another_branchs_station_documents(): void
    {
        $w = $this->openingWorld();
        $id = $this->createDraftAsOwner($w);
        $branchB = Branch::create(['code' => 'FOB-B-' . $w['slug'], 'name' => 'فرع آخر']);
        $user = $this->userWith($w, 'fob-branch-b', ['fuel_stations.view', 'fuel_stations.manage']);
        $user['user']->branches()->sync([$branchB->id]);

        $this->withToken($user['token'])->getJson(self::BASE . "/{$id}")->assertNotFound();
        $this->assertSame([], $this->withToken($user['token'])->getJson(self::BASE)->assertOk()->json('data'));
        $this->withToken($user['token'])->postJson(self::BASE, $this->openingPayload($w, ['costs' => null]))->assertNotFound();
    }

    #[Test]
    public function another_tenant_can_neither_see_nor_act_on_a_document(): void
    {
        $a = $this->openingWorld();
        $id = $this->createDraftAsOwner($a);
        $payloadOfA = $this->openingPayload($a);
        $b = $this->openingWorld();

        $t = $b['owner_token'];
        $this->withToken($t)->getJson(self::BASE . "/{$id}")->assertNotFound();
        $this->withToken($t)->getJson(self::BASE . "/{$id}/preview")->assertNotFound();
        $this->withToken($t)->postJson(self::BASE . "/{$id}/post")->assertNotFound();
        $this->withToken($t)->deleteJson(self::BASE . "/{$id}")->assertNotFound();
        $this->assertSame([], $this->withToken($t)->getJson(self::BASE)->assertOk()->json('data'));
        // خزانات/محطة المستأجر الآخر لا تُستعمل.
        $this->withToken($t)->postJson(self::BASE, $payloadOfA)->assertNotFound();
        app(TenantContext::class)->set($a['tenant_id']);
        app(\App\Tenancy\BranchContext::class)->set($a['branch']->id);
        $this->assertSame('draft', FuelOpeningBalance::findOrFail($id)->status);
    }

    #[Test]
    public function request_validation_rejects_malformed_bodies_with_422(): void
    {
        $w = $this->openingWorld();
        $t = $w['owner_token'];
        $good = $this->openingPayload($w);
        foreach ([
            'no key' => array_diff_key($good, ['idempotency_key' => 1]),
            'no station' => array_diff_key($good, ['fuel_station_id' => 1]),
            'bad date' => ['opening_date' => '07/11/2026'] + $good,
            'no lines' => ['lines' => []] + $good,
            'bad liters' => ['lines' => [['fuel_tank_id' => $w['tanks']['91']->id, 'quantity_liters' => '1.2345']]] + $good,
            'neg liters' => ['lines' => [['fuel_tank_id' => $w['tanks']['91']->id, 'quantity_liters' => '-5']]] + $good,
            'bad tank id' => ['lines' => [['fuel_tank_id' => 'x', 'quantity_liters' => '5']]] + $good,
            'dup tanks' => ['lines' => [['fuel_tank_id' => $w['tanks']['91']->id, 'quantity_liters' => '5'], ['fuel_tank_id' => $w['tanks']['91']->id, 'quantity_liters' => '6']]] + $good,
            'float cost' => ['costs' => [['fuel_product_id' => $w['fuels']['91']->id, 'unit_cost_per_liter_minor' => 2.5]]] + $good,
            'neg cost' => ['costs' => [['fuel_product_id' => $w['fuels']['91']->id, 'unit_cost_per_liter_minor' => -1]]] + $good,
        ] as $name => $body) {
            $this->withToken($t)->postJson(self::BASE, $body)->assertStatus(422, $name);
        }
        $this->assertSame(0, FuelOpeningBalance::count());
    }

    #[Test]
    public function the_counter_account_setting_is_validated_over_the_settings_api(): void
    {
        $w = $this->openingWorld(configureAccount: false);
        $t = $w['owner_token'];
        $expense = \App\Models\Account::where('type', 'expense')->where('is_group', false)->firstOrFail();

        $this->withToken($t)->putJson('/api/fuel-stations/settings', ['fuel_opening_balance_account_id' => $expense->id, 'reason' => 'اختبار حساب خاطئ'])->assertStatus(422);
        $this->withToken($t)->putJson('/api/fuel-stations/settings', ['fuel_opening_balance_account_id' => $w['opening_account']->id, 'reason' => 'تعيين صريح لحساب الأرصدة الافتتاحية'])->assertOk();
        $this->assertSame(
            $w['opening_account']->id,
            $this->withToken($t)->getJson('/api/fuel-stations/settings')->assertOk()->json('data.fuel_opening_balance_account_id') ?? $this->withToken($t)->getJson('/api/fuel-stations/settings')->json('fuel_opening_balance_account_id'),
        );
        // الإعداد الافتراضي للنظام فارغ: لا حساب مُفترَض لأي مستأجر جديد.
        $this->assertNull(\App\Support\Settings::DEFAULTS['fuel_stations']['fuel_opening_balance_account_id']);
    }
}
