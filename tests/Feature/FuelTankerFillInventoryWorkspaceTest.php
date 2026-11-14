<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\AccountingPeriodLock;
use App\Models\FuelStation;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * TANKER-PR6B-5 — مساحة عمل الدمج المخزني (قراءة فقط): التبويبات والأعداد وفصل حالة السند عن نتيجة المحاولة، التفاصيل والحسابات التاريخية، الإجراءات من الخادم، الحجب المستقل للأرقام والحسابات، والعزل.
 */
class FuelTankerFillInventoryWorkspaceTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use BuildsFuelOpeningWorld;
    use BuildsTankerPostingWorld;

    private const VIEW = ['fuel_stations.view', 'fuel.tanker.fill.view', 'fuel.tanker.fill.inventory.view'];
    private const LIST = self::FILLS . '/inventory-workspace';

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootPostingWorld();
    }

    /** @return array{posted: \App\Models\FuelTankerFill, reversed: \App\Models\FuelTankerFill, pending: \App\Models\FuelTankerFill, attention: \App\Models\FuelTankerFill} */
    private function seedFills(): array
    {
        $posted = $this->fill(1_000_000);
        $this->postFill($posted)->assertCreated();
        $reversed = $this->fill(2_000_000);
        $this->postFill($reversed)->assertCreated();
        $this->reverseFill($reversed)->assertCreated();
        $pending = $this->fill(500_000);
        $attention = $this->fill(300_000);
        // محاولة مرفوضة (فترة مقفلة) على سند يبقى «بانتظار الترحيل».
        $lock = AccountingPeriodLock::create(['start_date' => now()->subDay()->toDateString(), 'end_date' => now()->addDay()->toDateString(), 'status' => 'active', 'locked_by' => $this->w['actor']->id, 'reason' => 'اختبار']);
        $this->postFill($attention)->assertStatus(422);
        $lock->forceFill(['status' => 'released'])->save();

        return compact('posted', 'reversed', 'pending', 'attention');
    }

    private function ids(string $tab, ?string $token = null): array
    {
        return collect($this->withToken($token ?? $this->w['owner_token'])->getJson(self::LIST . "?tab={$tab}")->assertOk()->json('data'))->pluck('id')->sort()->values()->all();
    }

    /** @test */
    public function the_tabs_and_counts_separate_fill_state_from_attempt_outcome(): void
    {
        $f = $this->seedFills();
        $response = $this->withToken($this->w['owner_token'])->getJson(self::LIST)->assertOk();
        $response->assertJsonPath('meta.tab', 'pending')->assertJsonPath('meta.counts', ['pending' => 2, 'posted' => 1, 'reversed' => 1, 'attention' => 1])->assertJsonPath('meta.posting_enabled', true);

        $sorted = fn (array $fills) => collect($fills)->pluck('id')->sort()->values()->all();
        $this->assertSame($sorted([$f['pending'], $f['attention']]), $this->ids('pending'));
        $this->assertSame([$f['posted']->id], $this->ids('posted'));
        $this->assertSame([$f['reversed']->id], $this->ids('reversed'));
        $this->assertSame([$f['attention']->id], $this->ids('attention'));

        // حالة السند ≠ نتيجة المحاولة: سند «بانتظار الترحيل» وآخر محاولته «مرفوضة».
        $row = collect($this->withToken($this->w['owner_token'])->getJson(self::LIST . '?tab=attention')->json('data'))->first();
        $this->assertSame('pending_integration', $row['inventory_status']);
        $this->assertNull($row['inventory']['posting_status']);
        $this->assertSame(['operation' => 'post', 'outcome' => 'rejected', 'reason_code' => 'posting_blocked'], collect($row['inventory']['last_attempt'])->only(['operation', 'outcome', 'reason_code'])->all());
        $pendingRow = collect($this->withToken($this->w['owner_token'])->getJson(self::LIST . '?tab=pending')->json('data'))->firstWhere('id', $f['attention']->id);
        $this->assertNotNull($pendingRow['readiness'], 'الجاهزية في تبويب بانتظار الترحيل');
        $this->assertSame('ready', $pendingRow['readiness']['readiness'], 'المحاولة المرفوضة سابقاً لا تغيّر جاهزية السند الحالية بعد زوال السبب');

        $reversedRow = collect($this->withToken($this->w['owner_token'])->getJson(self::LIST . '?tab=reversed')->json('data'))->first();
        $this->assertSame('reversed', $reversedRow['inventory_status']);
        $this->assertSame('reversed', $reversedRow['inventory']['posting_status']);
        $this->assertSame('succeeded', $reversedRow['inventory']['last_attempt']['outcome']);
        $this->assertSame(436_000, $reversedRow['inventory']['posted_cost_minor']);

        // بعد نجاح الترحيل لاحقاً تنتفي حاجته للانتباه (لا محاولة فاشلة بلا نجاح تالٍ).
        $this->postFill($f['attention'])->assertCreated();
        $this->assertSame([], $this->ids('attention'));
        $this->assertSame(1, $this->withToken($this->w['owner_token'])->getJson(self::LIST)->json('meta.counts.pending'));
    }

    /** @test */
    public function the_detail_shows_posting_facts_historical_accounts_attempts_and_actions_from_the_server(): void
    {
        $fill = $this->fill(3_000_000);
        $this->postFill($fill)->assertCreated();
        $url = self::FILLS . "/{$fill->id}/inventory";

        $data = $this->withToken($this->w['owner_token'])->getJson($url)->assertOk()->json('data');
        $this->assertSame('posted', $data['inventory']['status']);
        $this->assertSame('posted', $data['inventory']['posting']['status']);
        $this->assertSame(654_000, $data['inventory']['posting']['posted_cost_minor']);
        $this->assertNotNull($data['inventory']['posting']['journal_entry']['number']);
        $this->assertSame('1145', $data['inventory']['accounts']['clearing']['code']);
        $this->assertSame('1140', $data['inventory']['accounts']['inventory']['code']);
        $this->assertSame('post', $data['inventory']['attempts'][0]['operation']);
        $this->assertSame('succeeded', $data['inventory']['attempts'][0]['outcome']);
        $this->assertSame(['preview_post' => false, 'post' => false, 'post_historical' => false, 'preview_reversal' => true, 'reverse' => true], $data['actions']);
        $this->assertNull($data['readiness']);

        // بعد العكس: لا إجراءات، والحقائق التاريخية باقية (الحسابات تبقى حسابات الترحيل الأصلي).
        $this->reverseFill($fill)->assertCreated();
        $after = $this->withToken($this->w['owner_token'])->getJson($url)->assertOk()->json('data');
        $this->assertSame('reversed', $after['inventory']['posting']['status']);
        $this->assertSame('سند أُدخل بالخطأ', $after['inventory']['posting']['reversal_reason']);
        $this->assertNotNull($after['inventory']['posting']['reversal_journal_entry']['number']);
        $this->assertSame(['preview_post' => false, 'post' => false, 'post_historical' => false, 'preview_reversal' => false, 'reverse' => false], $after['actions']);
        $this->assertSame(['reverse', 'post'], array_column($after['inventory']['attempts'], 'operation'));

        // سند بانتظار الترحيل: الجاهزية والإجراءات.
        $pending = $this->fill();
        $pendingData = $this->withToken($this->w['owner_token'])->getJson(self::FILLS . "/{$pending->id}/inventory")->assertOk()->json('data');
        $this->assertNull($pendingData['inventory']['posting']);
        $this->assertSame('ready', $pendingData['readiness']['readiness']);
        $this->assertSame(['preview_post' => true, 'post' => true, 'post_historical' => true, 'preview_reversal' => false, 'reverse' => false], $pendingData['actions']);
    }

    /** @test */
    public function actions_follow_permissions_and_costs_and_accounts_are_hidden_independently(): void
    {
        $fill = $this->fill(3_000_000);
        $this->postFill($fill)->assertCreated();
        $url = self::FILLS . "/{$fill->id}/inventory";

        $low = $this->withToken($this->userWith(self::VIEW)['token'])->getJson($url)->assertOk()->json('data');
        $this->assertSame(['preview_post' => false, 'post' => false, 'post_historical' => false, 'preview_reversal' => true, 'reverse' => false], $low['actions']);
        foreach (['posted_cost_minor', 'journal_entry', 'reversal_journal_entry', 'stock_movement_id', 'cost_movement_id'] as $hidden) {
            $this->assertArrayNotHasKey($hidden, $low['inventory']['posting']);
        }
        $this->assertNull($low['inventory']['accounts']);
        $this->assertStringNotContainsString($this->clearing->id, json_encode($low));

        $cost = $this->withToken($this->userWith([...self::VIEW, 'products.view_cost'])['token'])->getJson($url)->json('data');
        $this->assertSame(654_000, $cost['inventory']['posting']['posted_cost_minor']);
        $this->assertNull($cost['inventory']['accounts']);

        $accounts = $this->withToken($this->userWith([...self::VIEW, 'accounts.view'])['token'])->getJson($url)->json('data');
        $this->assertArrayNotHasKey('posted_cost_minor', $accounts['inventory']['posting']);
        $this->assertSame('1145', $accounts['inventory']['accounts']['clearing']['code']);

        $pendingFill = $this->fill();
        $poster = $this->withToken($this->userWith([...self::VIEW, 'fuel.tanker.fill.inventory.post'])['token'])->getJson(self::FILLS . "/{$pendingFill->id}/inventory")->json('data');
        $this->assertTrue($poster['actions']['post']);
        $this->assertFalse($poster['actions']['post_historical']);
        $reverser = $this->withToken($this->userWith([...self::VIEW, 'fuel.tanker.fill.inventory.reverse'])['token'])->getJson($url)->json('data');
        $this->assertTrue($reverser['actions']['reverse']);

        // الصف الملخّص في القائمة يحجب المبلغ أيضاً.
        $row = collect($this->withToken($this->userWith(self::VIEW)['token'])->getJson(self::LIST . '?tab=posted')->json('data'))->first();
        $this->assertNull($row['inventory']['posted_cost_minor']);
        $this->assertSame(654_000, collect($this->withToken($this->w['owner_token'])->getJson(self::LIST . '?tab=posted')->json('data'))->first()['inventory']['posted_cost_minor']);
    }

    /** @test */
    public function gates_permissions_pin_scope_and_validation_are_enforced_and_nothing_is_written(): void
    {
        $fill = $this->fill();
        $this->postFill($fill)->assertCreated();
        $before = $this->state();

        foreach (['tanker_management_enabled', 'tanker_fills_enabled', 'tanker_inventory_posting_enabled'] as $gate) {
            config(["fuel_stations.{$gate}" => false]);
            $this->withToken($this->w['owner_token'])->getJson(self::LIST)->assertNotFound();
            $this->withToken($this->w['owner_token'])->getJson(self::FILLS . "/{$fill->id}/inventory")->assertNotFound();
            config(["fuel_stations.{$gate}" => true]);
        }
        $this->withToken($this->userWith(['fuel_stations.view', 'fuel.tanker.fill.view'])['token'])->getJson(self::LIST)->assertForbidden();
        $pin = User::query()->whereKey($this->w['actor']->id)->firstOrFail()->createToken('station', ['station-ops'])->plainTextToken;
        $this->withToken($pin)->getJson(self::LIST)->assertForbidden();
        $this->withToken($pin)->getJson(self::FILLS . "/{$fill->id}/inventory")->assertForbidden();

        $other = FuelStation::create(['branch_id' => $this->w['station']->branch_id, 'warehouse_id' => $this->w['warehouse']->id, 'code' => 'WS-OTHER', 'name' => 'محطة أخرى']);
        $scoped = $this->userWith(self::VIEW, [$other->id]);
        $this->withToken($scoped['token'])->getJson(self::FILLS . "/{$fill->id}/inventory")->assertNotFound();
        $this->assertSame([], $this->ids('posted', $scoped['token']), 'لا تظهر سندات محطة غير مسنَدة');
        $this->assertSame(0, $this->withToken($scoped['token'])->getJson(self::LIST)->json('meta.counts.posted'));
        $foreign = $this->openingWorld();
        $this->withToken($foreign['owner_token'])->getJson(self::FILLS . "/{$fill->id}/inventory")->assertNotFound();
        $this->assertSame([], collect($this->withToken($foreign['owner_token'])->getJson(self::LIST . '?tab=posted')->json('data'))->all());

        $this->withToken($this->w['owner_token'])->getJson(self::LIST . '?tab=bogus')->assertStatus(422);
        $this->withToken($this->w['owner_token'])->getJson(self::LIST . '?station_id=' . (string) \Illuminate\Support\Str::uuid())->assertNotFound();
        $this->assertSame($before, $this->state(), 'قراءة فقط');

        // بحث برقم السند الورقي والإلكتروني.
        $found = $this->withToken($this->w['owner_token'])->getJson(self::LIST . '?tab=posted&q=' . $fill->number)->json('data');
        $this->assertSame([$fill->id], array_column($found, 'id'));
        $this->assertSame([], $this->withToken($this->w['owner_token'])->getJson(self::LIST . '?tab=posted&q=NOPE')->json('data'));
        app(\App\Tenancy\TenantContext::class)->set($this->w['tenant_id']);
        $this->assertNotNull(Account::query()->where('code', '1145')->first());
        $this->assertSame(1, DB::table('fuel_tanker_fill_inventory_postings')->count());
    }
}
