<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\AccountingPeriodLock;
use App\Models\FiscalYear;
use App\Models\FuelNozzle;
use App\Models\FuelOperationalLedger;
use App\Models\FuelPump;
use App\Models\FuelShift;
use App\Models\FuelStation;
use App\Models\FuelStationSettingOverride;
use App\Models\FuelTankerFill;
use App\Models\FuelTankerOwner;
use App\Models\JournalEntry;
use App\Models\Role;
use App\Models\User;
use App\Services\FuelInventoryLedgerReconciliation as Recon;
use App\Services\FuelStationSettingsService;
use App\Services\FuelTankerFillException;
use App\Services\FuelTankerFillInventoryPostingService as PostingService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * TANKER-PR6B-3 — الترحيل المخزني والمحاسبي لسند تعبئة الصهريج في معاملة واحدة (SQLite وPostgreSQL).
 *
 * عالم الاختبار: محطة نبراس الطموح المرجعية بأرصدة افتتاحية مرحَّلة فعلاً (بنزين 91 = 30,000 لتر بتكلفة وهمية 218 هللة/لتر ⇒ قيمة المجمّع 6,540,000 هللة)، فالمجمّع والأستاذ متّسقان قبل كل اختبار.
 * القيد المتوقع لسند 3,000 لتر: مدين الوسيط 654,000 / دائن المخزون 654,000 (التكلفة التاريخية لا السعر التعاقدي).
 */
class FuelTankerFillInventoryPostingTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use BuildsFuelOpeningWorld;

    private const OPENING = '/api/fuel-stations/opening-balances';
    private const FILLS = '/api/fuel-stations/tanker-fills';

    /** @var array<string,mixed> */
    private array $w;
    private FuelNozzle $nozzle;
    private FuelTankerOwner $owner;
    private Account $clearing;
    private int $seq = 0;

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'fuel_stations.tanker_management_enabled' => true, 'fuel_stations.tanker_fills_enabled' => true,
            'fuel_stations.tanker_inventory_posting_enabled' => true,
        ]);
        $this->w = $this->openingWorld();
        $id = $this->withToken($this->w['owner_token'])->postJson(self::OPENING, $this->openingPayload($this->w))->assertCreated()->json('data.id');
        $this->withToken($this->w['owner_token'])->postJson(self::OPENING . "/{$id}/post")->assertOk();

        app(TenantContext::class)->set($this->w['tenant_id']);
        $this->clearing = Account::create(['code' => '1145', 'name' => 'وسيط وقود مصروف لصهاريج', 'type' => 'asset', 'normal_balance' => 'debit', 'is_group' => false, 'is_active' => true]);
        $this->configure(['tanker_issue_clearing_account_id' => $this->clearing->id, 'tanker_inventory_posting_start_at' => now()->subDay()->utc()->format('Y-m-d\TH:i:s\Z')]);

        $station = $this->w['station'];
        $pump = FuelPump::create(['branch_id' => $station->branch_id, 'fuel_station_id' => $station->id, 'pump_number' => '01', 'name' => 'مضخة 1']);
        $this->nozzle = FuelNozzle::create([
            'branch_id' => $station->branch_id, 'fuel_station_id' => $station->id, 'fuel_pump_id' => $pump->id, 'fuel_tank_id' => $this->w['tanks']['91']->id,
            'fuel_product_id' => $this->w['fuels']['91']->id, 'nozzle_number' => '1',
        ]);
        $this->owner = FuelTankerOwner::create(['name' => 'عسكر', 'code' => 'ASK', 'status' => 'active']);
        FuelShift::create([
            'branch_id' => $station->branch_id, 'fuel_station_id' => $station->id, 'number' => 'FSH-P3-1', 'status' => FuelShift::STATUS_OPEN, 'opening_float_minor' => 0,
            'idempotency_key' => 'shift-p3-1', 'opened_by' => $this->w['actor']->id, 'opened_at' => now(),
        ]);
    }

    // ───────────────────────── أدوات ─────────────────────────

    /** @param array<string,mixed> $values */
    private function configure(array $values): void
    {
        app(TenantContext::class)->set($this->w['tenant_id']);
        app(FuelStationSettingsService::class)->putTenant($values, $this->w['actor'], 'إعداد اختبار الترحيل');
    }

    private function fill(int $milliliters = 3_000_000): FuelTankerFill
    {
        $n = ++$this->seq;
        $response = $this->withToken($this->w['owner_token'])->postJson(self::FILLS, [
            'fuel_station_id' => $this->w['station']->id, 'fuel_nozzle_id' => $this->nozzle->id, 'fuel_tanker_owner_id' => $this->owner->id,
            'voucher_number' => "P3-{$n}", 'quantity_milliliters' => $milliliters, 'idempotency_key' => "fill-p3-{$n}",
        ])->assertCreated();

        return FuelTankerFill::query()->findOrFail($response->json('data.id'));
    }

    /** @param array<string,mixed> $body */
    private function postFill(FuelTankerFill $fill, ?string $token = null, array $body = []): \Illuminate\Testing\TestResponse
    {
        return $this->withToken($token ?? $this->w['owner_token'])->postJson(self::FILLS . "/{$fill->id}/inventory-posting", $body);
    }

    /** @param list<string> $permissions @return array{user: User, token: string} */
    private function userWith(array $permissions, ?array $stations = null): array
    {
        app(TenantContext::class)->set($this->w['tenant_id']);
        $slug = 'post-role-' . (++$this->seq);
        Role::create(['tenant_id' => $this->w['tenant_id'], 'slug' => $slug, 'name' => $slug, 'permissions' => $permissions, 'is_system' => false]);
        $user = User::create(['tenant_id' => $this->w['tenant_id'], 'name' => $slug, 'email' => "{$slug}@post.test", 'password' => 'password123', 'role' => $slug]);
        if ($stations !== null) {
            $user->forceFill(['fuel_station_scope' => User::FUEL_SCOPE_ASSIGNED])->save();
            $user->fuelStations()->sync($stations);
        }

        return ['user' => $user, 'token' => $user->createToken('api')->plainTextToken];
    }

    private const POSTER = ['fuel_stations.view', 'fuel.tanker.fill.view', 'fuel.tanker.fill.inventory.view', 'fuel.tanker.fill.inventory.post'];

    /** @return array<string,int> بصمة كل ما يجب ألا يتغيّر عند الرفض/الفشل. */
    private function state(): array
    {
        $t = $this->w['tenant_id'];

        return $this->openingEffects($this->w) + [
            'postings' => (int) DB::table('fuel_tanker_fill_inventory_postings')->where('tenant_id', $t)->count(),
            'payments' => (int) DB::table('payments')->where('tenant_id', $t)->count(),
            'journal_lines' => (int) DB::table('journal_lines')->where('tenant_id', $t)->count(),
            'pool_quantity' => (int) DB::table('fuel_inventory_cost_states')->where('tenant_id', $t)->sum('quantity_milliliters'),
            'pool_value' => (int) DB::table('fuel_inventory_cost_states')->where('tenant_id', $t)->sum('cost_pool_minor'),
            'posted_fills' => (int) DB::table('fuel_tanker_fills')->where('tenant_id', $t)->where('inventory_status', '<>', 'pending_integration')->count(),
        ];
    }

    private function stock91(): int
    {
        return (int) DB::table('product_warehouse_stock')->where('warehouse_id', $this->w['warehouse']->id)->where('product_id', $this->w['fuels']['91']->product_id)->value('quantity');
    }

    /** @return array<string,mixed> */
    private function pool91(): array
    {
        return (array) DB::table('fuel_inventory_cost_states')->where('warehouse_id', $this->w['warehouse']->id)->where('fuel_product_id', $this->w['fuels']['91']->id)->first();
    }

    /** @return list<string> */
    private function attemptOutcomes(FuelTankerFill $fill): array
    {
        return DB::table('fuel_tanker_fill_inventory_posting_attempts')->where('fuel_tanker_fill_id', $fill->id)->orderBy('created_at')->get()
            ->map(fn ($r) => $r->outcome . ':' . ($r->reason_code ?? ''))->all();
    }

    // ───────────────────────── المسار السعيد والقيد ─────────────────────────

    /** @test */
    public function posting_deducts_stock_and_pool_and_posts_one_balanced_entry_at_historical_cost(): void
    {
        $fill = $this->fill(3_000_000);
        $before = $this->state();
        $this->assertSame(30_000_000, $this->stock91());
        $this->assertSame(6_540_000, (int) $this->pool91()['cost_pool_minor']);

        $response = $this->postFill($fill)->assertCreated();
        $response->assertJsonPath('meta.replayed', false)->assertJsonPath('meta.posting.status', 'posted')->assertJsonPath('meta.posting.quantity_milliliters', 3_000_000)
            ->assertJsonPath('meta.posting.posted_cost_minor', 654_000);

        // المخزون والمجمّع.
        $this->assertSame(27_000_000, $this->stock91());
        $pool = $this->pool91();
        $this->assertSame(27_000_000, (int) $pool['quantity_milliliters']);
        $this->assertSame(5_886_000, (int) $pool['cost_pool_minor']);
        $this->assertSame('posted', $fill->fresh()->inventory_status);

        // القيد: مدين الوسيط / دائن المخزون بالتكلفة التاريخية، متوازن، مربوط بالسند، بفرع المحطة.
        $entry = JournalEntry::query()->where('source_type', FuelTankerFill::class)->where('source_id', $fill->id)->sole();
        $lines = DB::table('journal_lines')->where('journal_entry_id', $entry->id)->orderBy('debit', 'desc')->get();
        $this->assertCount(2, $lines);
        $inventory = Account::query()->where('code', '1140')->firstOrFail();
        $this->assertSame($this->clearing->id, $lines[0]->account_id);
        $this->assertSame(654_000, (int) $lines[0]->debit);
        $this->assertSame($inventory->id, $lines[1]->account_id);
        $this->assertSame(654_000, (int) $lines[1]->credit);
        $this->assertSame(array_sum(array_column($lines->all(), 'debit')), array_sum(array_column($lines->all(), 'credit')));
        $this->assertSame([$this->w['station']->branch_id], array_values(array_unique(array_column($lines->all(), 'branch_id'))));
        $this->assertSame('posted', $entry->status);

        // الروابط: حركة المخزون ← حركة التكلفة (بالقيد) ← صف الترحيل ← الدفتر التشغيلي.
        $posting = (array) DB::table('fuel_tanker_fill_inventory_postings')->where('fuel_tanker_fill_id', $fill->id)->sole();
        $stock = (array) DB::table('stock_movements')->where('id', $posting['stock_movement_id'])->sole();
        $this->assertSame('out', $stock['type']);
        $this->assertSame(3_000_000, (int) $stock['quantity']);
        $this->assertSame(654_000, (int) $stock['total_cost']);
        $cost = (array) DB::table('fuel_inventory_cost_movements')->where('id', $posting['cost_movement_id'])->sole();
        $this->assertSame('issue', $cost['movement_type']);
        $this->assertSame($entry->id, $cost['journal_entry_id']);
        $this->assertSame($stock['id'], $cost['stock_movement_id']);
        $this->assertSame('tanker-fill-post:' . $fill->id, $posting['idempotency_key']);
        $ledger = FuelOperationalLedger::query()->where('source_id', $fill->id)->sole();
        $this->assertSame('tanker_fill', $ledger->movement_type);
        $this->assertSame(-3_000_000, $ledger->quantity_milliliters);
        $this->assertSame($stock['id'], $ledger->stock_movement_id);
        $this->assertSame(27_000_000, $ledger->book_balance_milliliters);

        // التدقيق (بلا مبالغ) والمحاولة الناجحة.
        $audit = DB::table('fuel_station_audit_events')->where('action', 'tanker_fill.inventory_posted')->where('subject_id', $fill->id)->sole();
        $this->assertStringNotContainsString('654000', (string) json_encode($audit));
        $this->assertSame(['succeeded:'], $this->attemptOutcomes($fill));

        // لا إيراد ولا ضريبة ولا COGS ولا ذمة ولا فاتورة ولا دفعة: قيد واحد بسطرين فقط، ولا أي حساب غير الوسيط والمخزون.
        $after = $this->state();
        $this->assertSame($before['invoices'], $after['invoices']);
        $this->assertSame($before['payments'], $after['payments']);
        $this->assertSame($before['journal_entries'] + 1, $after['journal_entries']);
        $this->assertSame($before['journal_lines'] + 2, $after['journal_lines']);
        foreach (['4110', '2120', '5110', '1130'] as $code) {
            $account = Account::query()->where('code', $code)->first();
            $this->assertSame(0, $account === null ? 0 : DB::table('journal_lines')->where('journal_entry_id', $entry->id)->where('account_id', $account->id)->count(), "لا حساب {$code} في قيد الترحيل");
        }

        // المطابقة: الكمية والقيمة والأستاذ متّسقة بعد الترحيل (الوسيط خارج حصة المخزون، المخزون نقص بالقيمة نفسها).
        app(TenantContext::class)->set($this->w['tenant_id']);
        $recon = app(Recon::class)->reconcile(null, null, true, true);
        $this->assertSame(Recon::STATUS_CONSISTENT, $recon['status'], json_encode($recon['findings']));
        $this->assertSame(5_886_000 + 3_624_315 + 5_146_000, $recon['value']['total']['pool_value_minor']);
        $this->assertSame($recon['value']['total']['pool_value_minor'], $recon['value']['total']['ledger_share_minor']);
    }

    /** @test */
    public function the_response_hides_cost_and_entry_from_users_without_cost_permission(): void
    {
        $fill = $this->fill(1_000_000);
        $poster = $this->userWith(self::POSTER);
        $json = $this->postFill($fill, $poster['token'])->assertCreated()->json();
        $this->assertArrayNotHasKey('posted_cost_minor', $json['meta']['posting']);
        $this->assertArrayNotHasKey('journal_entry_id', $json['meta']['posting']);
        $this->assertSame('posted', $json['meta']['posting']['status']);

        $withCost = $this->fill(1_000_000);
        $finance = $this->userWith([...self::POSTER, 'products.view_cost']);
        $this->postFill($withCost, $finance['token'])->assertCreated()->assertJsonPath('meta.posting.posted_cost_minor', 218_000);
    }

    /** @test */
    public function the_fractional_cost_remainder_is_carried_so_consecutive_fills_sum_to_the_exact_pool_value(): void
    {
        // 218 هللة/لتر = 0.218 هللة/مل: 1,234,567 مل ⇒ 269,135.206 ⇒ 269,135 والباقي 0.206 يُحمل؛ التالي 100,001 مل ⇒ 21,800.218 + 0.206 = 21,800.424 ⇒ 21,800.
        $first = $this->fill(1_234_567);
        $this->postFill($first)->assertCreated()->assertJsonPath('meta.posting.status', 'posted');
        $second = $this->fill(100_001);
        $this->postFill($second)->assertCreated();
        $costs = DB::table('fuel_tanker_fill_inventory_postings')->orderBy('created_at')->pluck('posted_cost_minor')->map(fn ($v) => (int) $v)->all();
        $this->assertSame([269_135, 21_800], $costs);
        $this->assertSame(6_540_000 - array_sum($costs), (int) $this->pool91()['cost_pool_minor']);
        app(TenantContext::class)->set($this->w['tenant_id']);
        $this->assertSame(Recon::STATUS_CONSISTENT, app(Recon::class)->reconcile(null, null, true, true)['status']);
    }

    // ───────────────────────── الإعادة ومنع التكرار ─────────────────────────

    /** @test */
    public function repeating_the_request_returns_the_first_posting_without_any_second_effect(): void
    {
        $fill = $this->fill();
        $this->postFill($fill)->assertCreated();
        $afterFirst = $this->state();
        $stockFirst = $this->stock91();

        $this->postFill($fill)->assertOk()->assertJsonPath('meta.replayed', true)->assertJsonPath('meta.posting.status', 'posted');
        $this->postFill($fill, null, ['reason' => 'محتوى مختلف'])->assertOk()->assertJsonPath('meta.replayed', true);
        $this->assertSame($afterFirst, $this->state(), 'الإعادة بلا أي أثر ثانٍ (مخزون/مجمّع/قيد/ترحيل/دفتر/محاولة)');
        $this->assertSame($stockFirst, $this->stock91());
        $this->assertSame(1, DB::table('fuel_tanker_fill_inventory_postings')->where('fuel_tanker_fill_id', $fill->id)->count());
        $this->assertSame(['succeeded:'], $this->attemptOutcomes($fill));
    }

    /** @test */
    public function the_request_cannot_carry_quantity_cost_accounts_or_dates(): void
    {
        $fill = $this->fill();
        foreach (['quantity_milliliters' => 1, 'posted_cost_minor' => 1, 'clearing_account_id' => (string) Str::uuid(), 'entry_date' => '2020-01-01', 'tenant_id' => (string) Str::uuid()] as $key => $value) {
            $this->postFill($fill, null, [$key => $value])->assertStatus(422);
        }
        $this->assertSame('pending_integration', $fill->fresh()->inventory_status);
    }

    // ───────────────────────── البوابات والصلاحيات ─────────────────────────

    /** @test */
    public function every_closed_gate_blocks_the_endpoint_and_the_service_with_no_effect(): void
    {
        $fill = $this->fill();
        $before = $this->state();
        foreach (['fuel_stations.tanker_inventory_posting_enabled', 'fuel_stations.tanker_fills_enabled', 'fuel_stations.tanker_management_enabled'] as $gate) {
            config([$gate => false]);
            $this->postFill($fill)->assertNotFound();
            $this->withToken($this->w['owner_token'])->getJson(self::FILLS . "/{$fill->id}/inventory-posting/preview")->assertNotFound();
            $error = $this->caught(fn () => app(PostingService::class)->post($fill, $this->w['actor']));
            $this->assertInstanceOf(FuelTankerFillException::class, $error);
            $this->assertSame(FuelTankerFillException::POSTING_DISABLED, $error->reason);
            config([$gate => true]);
        }
        $this->assertSame($before, $this->state());
        $this->assertSame([], $this->attemptOutcomes($fill), 'رفض البوابة لا يسجّل محاولة');
    }

    /** @test */
    public function the_posting_gate_is_closed_by_default(): void
    {
        $source = (string) file_get_contents(base_path('config/fuel_stations.php'));
        $this->assertMatchesRegularExpression("/'tanker_inventory_posting_enabled'\s*=>\s*\(bool\)\s*env\('FUEL_TANKER_INVENTORY_POSTING_ENABLED',\s*false\)/", $source);
    }

    /** @test */
    public function permissions_are_exact_and_pin_sessions_and_staff_templates_cannot_post(): void
    {
        $fill = $this->fill();
        $viewer = $this->userWith(['fuel_stations.view', 'fuel.tanker.fill.view', 'fuel.tanker.fill.inventory.view']);
        $this->postFill($fill, $viewer['token'])->assertForbidden();
        $manager = $this->userWith(['fuel_stations.view', 'fuel_stations.manage', 'fuel.governance.manage', 'fuel.tanker.fill.view', 'fuel.tanker.fill.record']);
        $this->postFill($fill, $manager['token'])->assertForbidden();

        // جلسة PIN (قدرة station-ops) لا تصل المسار مهما كانت الصلاحيات.
        $pin = User::query()->whereKey($this->w['actor']->id)->firstOrFail()->createToken('station', ['station-ops'])->plainTextToken;
        $this->postFill($fill, $pin)->assertForbidden();
        $this->assertSame('pending_integration', $fill->fresh()->inventory_status);

        // قوالب موظفي المحطات لا تمنح الصلاحيات المحجوزة.
        foreach (['fuel.tanker.fill.inventory.post', 'fuel.tanker.fill.inventory.post_historical', 'fuel.tanker.fill.inventory.reverse'] as $permission) {
            foreach (\App\Support\FuelStaffTemplates::all() ?? [] as $template) {
                $this->assertNotContains($permission, $template['permissions'] ?? []);
            }
        }
        $this->assertSame([], $this->attemptOutcomes($fill), 'الرفض بسبب الصلاحية لا يسجّل محاولة');
        $this->postFill($fill, $this->userWith(self::POSTER)['token'])->assertCreated();
    }

    /** @test */
    public function a_user_scoped_to_another_station_or_another_tenant_gets_a_uniform_404(): void
    {
        $fill = $this->fill();
        $other = FuelStation::create(['branch_id' => $this->w['station']->branch_id, 'warehouse_id' => $this->w['warehouse']->id, 'code' => 'P3-OTHER', 'name' => 'محطة أخرى']);
        $scoped = $this->userWith(self::POSTER, [$other->id]);
        $this->postFill($fill, $scoped['token'])->assertNotFound();

        $foreign = $this->openingWorld();
        $this->postFill($fill, $foreign['owner_token'])->assertNotFound();
        $this->assertSame('pending_integration', $fill->fresh()->inventory_status);
        $this->assertSame([], $this->attemptOutcomes($fill));
    }

    // ───────────────────────── الموانع (كلها بلا أثر) ─────────────────────────

    /** @test */
    public function an_invalid_or_missing_clearing_account_is_refused_without_any_effect(): void
    {
        $fill = $this->fill();
        $before = $this->state();

        $inventory = Account::query()->where('code', '1140')->firstOrFail();
        $this->assertStringContainsString('FUEL_TANKER_CLEARING_ACCOUNT_INVALID', (string) $this->caught(fn () => $this->configure(['tanker_issue_clearing_account_id' => $inventory->id]))->getMessage());
        // عطّل الحساب المعيَّن بعد التعيين ⇒ غير صالح عند الترحيل.
        $this->clearing->forceFill(['is_active' => false])->save();
        $response = $this->postFill($fill)->assertStatus(422);
        $this->assertSame('posting_blocked', $response->json('reason'));
        $this->assertContains('clearing_account_invalid', $response->json('details.blockers'));
        $this->assertSame($before, $this->state());
        $this->assertSame(['rejected:posting_blocked'], $this->attemptOutcomes($fill));

        // غير معيَّن أصلاً ⇒ `clearing_account_missing` بلا أي بديل (لا 1140 ولا 5110).
        $this->clearing->forceFill(['is_active' => true])->save();
        $this->configure(['tanker_issue_clearing_account_id' => null]);
        $this->assertContains('clearing_account_missing', $this->postFill($fill)->assertStatus(422)->json('details.blockers'));
        $this->assertSame($before, $this->state());
    }

    /** @test */
    public function post_on_close_stations_cannot_post_to_avoid_a_double_deduction(): void
    {
        $fill = $this->fill();
        $before = $this->state();
        FuelStationSettingOverride::create(['tenant_id' => $this->w['tenant_id'], 'fuel_station_id' => $this->w['station']->id, 'device_key' => '', 'setting_key' => 'shift_settlement_mode', 'value' => 'post_on_close']);
        $this->assertContains('settlement_mode_conflict', $this->postFill($fill)->assertStatus(422)->json('details.blockers'));
        $this->assertSame($before, $this->state());
    }

    /** @test */
    public function a_locked_period_or_closed_fiscal_year_rejects_the_whole_posting(): void
    {
        $fill = $this->fill();
        $before = $this->state();
        $date = app(FuelStationSettingsService::class)->businessDate($this->w['station'], $fill->recorded_at);

        $lock = AccountingPeriodLock::create(['tenant_id' => $this->w['tenant_id'], 'start_date' => $date, 'end_date' => $date, 'status' => 'active', 'reason' => 'اختبار']);
        $this->assertContains('period_locked', $this->postFill($fill)->assertStatus(422)->json('details.blockers'));
        $this->assertSame($before, $this->state());
        $lock->update(['status' => 'released']);

        $year = FiscalYear::create(['tenant_id' => $this->w['tenant_id'], 'name' => 'FY-P3', 'start_date' => now()->subYear()->toDateString(), 'end_date' => now()->addYear()->toDateString(), 'status' => FiscalYear::STATUS_CLOSED]);
        $this->assertContains('period_locked', $this->postFill($fill)->assertStatus(422)->json('details.blockers'));
        $this->assertSame($before, $this->state());
        $year->update(['status' => FiscalYear::STATUS_OPEN]);
        $this->postFill($fill)->assertCreated();
        $this->assertSame(['rejected:posting_blocked', 'rejected:posting_blocked', 'succeeded:'], $this->attemptOutcomes($fill));
    }

    /** @test */
    public function insufficient_balance_is_refused_with_no_negative_stock_or_partial_deduction(): void
    {
        $fill = $this->fill(31_000_000); // أكبر من رصيد 91 (30,000 لتر)
        $before = $this->state();
        $this->postFill($fill)->assertStatus(422)->assertJsonPath('reason', 'insufficient_stock');
        $this->assertSame($before, $this->state());
        $this->assertSame(30_000_000, $this->stock91());
        $this->assertSame(['rejected:insufficient_stock'], $this->attemptOutcomes($fill));

        // سند يكفيه الرصيد وحده يُرحَّل ولو كان تراكمي السندات المعلّقة أكبر من الرصيد (الحسم بكمية هذا السند).
        $ok = $this->fill(29_000_000);
        $this->postFill($ok)->assertCreated();
        $this->assertSame(1_000_000, $this->stock91());
        $again = $this->fill(2_000_000);
        $this->postFill($again)->assertStatus(422)->assertJsonPath('reason', 'insufficient_stock');
        $this->assertGreaterThanOrEqual(0, $this->stock91());
    }

    /** @test */
    public function a_quantity_above_the_stock_movement_column_limit_is_refused(): void
    {
        $fill = $this->fill(2_147_483_648);
        $before = $this->state();
        $this->postFill($fill)->assertStatus(422)->assertJsonPath('reason', 'quantity_exceeds_stock_limit');
        $this->assertSame($before, $this->state());
        $this->assertSame(['rejected:quantity_exceeds_stock_limit'], $this->attemptOutcomes($fill));
        $preview = $this->withToken($this->w['owner_token'])->getJson(self::FILLS . "/{$fill->id}/inventory-posting/preview")->assertOk()->json('data');
        $this->assertContains('quantity_exceeds_stock_limit', $preview['blockers']);
    }

    /** @test */
    public function a_ledger_variance_blocks_under_block_and_is_allowed_under_warn(): void
    {
        $fill = $this->fill();
        // فرق بين المجمّع والأستاذ: قيمة المجمّع تُعدَّل 10 هللات خارج أي حركة.
        DB::table('fuel_inventory_cost_states')->where('warehouse_id', $this->w['warehouse']->id)->where('fuel_product_id', $this->w['fuels']['91']->id)->increment('cost_pool_minor', 10);
        $before = $this->state();
        $response = $this->postFill($fill)->assertStatus(422);
        $this->assertSame('ledger_variance_blocked', $response->json('reason'));
        $this->assertNotEmpty($response->json('details.findings'));
        $this->assertSame($before, $this->state());

        $this->configure(['fuel_pool_ledger_variance_policy' => 'warn']);
        $this->postFill($fill)->assertCreated();
        $this->assertSame('posted', $fill->fresh()->inventory_status);
    }

    /** @test */
    public function a_voided_or_already_posted_or_distinct_approver_violating_fill_is_refused(): void
    {
        $voided = $this->fill();
        $this->withToken($this->w['owner_token'])->postJson(self::FILLS . "/{$voided->id}/void", ['reason' => 'خطأ'])->assertOk();
        $this->postFill($voided)->assertStatus(422)->assertJsonPath('reason', 'fill_voided');

        // فصل المُرحِّل عن المسجِّل حين تلزمه سياسة المحطة.
        $fill = $this->fill();
        $this->configure(['fuel_distinct_approver_required' => true]);
        $this->postFill($fill)->assertStatus(422)->assertJsonPath('reason', 'distinct_approver_required');
        $other = $this->userWith(self::POSTER);
        $this->postFill($fill, $other['token'])->assertCreated();
        $this->assertSame('posted', $fill->fresh()->inventory_status);
    }

    // ───────────────────────── التاريخي ─────────────────────────

    /** @test */
    public function a_historical_fill_needs_the_extra_permission_a_confirmed_review_and_a_reason(): void
    {
        $this->configure(['tanker_inventory_posting_start_at' => null]); // كل السندات تاريخية
        $fill = $this->fill();
        $before = $this->state();

        $poster = $this->userWith(self::POSTER);
        $this->postFill($fill, $poster['token'])->assertForbidden();
        $this->assertSame($before, $this->state());
        $this->assertSame([], $this->attemptOutcomes($fill), '403 لا يسجّل محاولة');

        // المالك: بلا تأكيد أو بلا سبب ⇒ 422؛ بكليهما ⇒ يُرحَّل.
        $this->postFill($fill)->assertStatus(422)->assertJsonPath('reason', 'historical_review_required');
        $this->postFill($fill, null, ['confirm_historical' => true])->assertStatus(422)->assertJsonPath('reason', 'historical_review_required');
        $this->assertSame($before, $this->state());
        $this->postFill($fill, null, ['confirm_historical' => true, 'reason' => 'مراجعة سند مسجَّل قبل بدء الترحيل'])->assertCreated();
        $audit = DB::table('fuel_station_audit_events')->where('action', 'tanker_fill.inventory_posted')->where('subject_id', $fill->id)->sole();
        $this->assertSame('مراجعة سند مسجَّل قبل بدء الترحيل', $audit->reason);

        // مع الصلاحية الإضافية يُقبل أيضاً.
        $fill2 = $this->fill();
        $historian = $this->userWith([...self::POSTER, 'fuel.tanker.fill.inventory.post_historical']);
        $this->postFill($fill2, $historian['token'], ['confirm_historical' => true, 'reason' => 'مراجعة'])->assertCreated();
    }

    /** @test */
    public function running_migrations_or_viewing_the_review_never_posts_any_fill(): void
    {
        $this->fill();
        $this->fill();
        $this->artisan('migrate', ['--force' => true])->assertExitCode(0);
        $viewer = $this->userWith(['fuel_stations.view', 'fuel.tanker.fill.view', 'fuel.tanker.fill.inventory.view']);
        $this->withToken($viewer['token'])->getJson(self::FILLS . '/inventory-review')->assertOk();
        $this->assertSame(0, DB::table('fuel_tanker_fill_inventory_postings')->count());
        $this->assertSame(0, DB::table('fuel_tanker_fills')->where('inventory_status', '<>', 'pending_integration')->count());
    }

    // ───────────────────────── الذرّية ─────────────────────────

    /** @test */
    public function any_failure_after_partial_writes_rolls_back_the_entire_transaction(): void
    {
        $fill = $this->fill();
        $station = $this->w['station'];
        // يفشل الدفتر التشغيلي (آخر الخطوات الكتابية بعد الخصم والقيد والترحيل) بتعارض مفتاح idempotency.
        FuelOperationalLedger::create([
            'branch_id' => $station->branch_id, 'fuel_station_id' => $station->id, 'fuel_tank_id' => $this->w['tanks']['91']->id, 'fuel_product_id' => $this->w['fuels']['91']->id,
            'warehouse_id' => $this->w['warehouse']->id, 'movement_type' => 'opening', 'quantity_milliliters' => 0, 'book_balance_milliliters' => 0,
            'idempotency_key' => 'tanker-fill-post:' . $fill->id . ':ledger', 'occurred_at' => now(),
        ]);
        $before = $this->state();

        $response = $this->postFill($fill);
        $this->assertGreaterThanOrEqual(422, $response->getStatusCode());
        $this->assertSame($before, $this->state(), 'لا خصم ولا قيد منفرد ولا ترحيل ولا دفتر ولا تغيير مجمّع');
        $this->assertSame(30_000_000, $this->stock91());
        $this->assertSame(6_540_000, (int) $this->pool91()['cost_pool_minor']);
        $this->assertSame('pending_integration', $fill->fresh()->inventory_status);
        $this->assertSame(['failed:posting_failed'], $this->attemptOutcomes($fill));

        // بعد زوال السبب يُرحَّل السند بسلامة (لا حالة نصف معلّقة).
        DB::table('fuel_operational_ledgers')->where('idempotency_key', 'tanker-fill-post:' . $fill->id . ':ledger')->delete();
        $this->postFill($fill)->assertCreated();
        $this->assertSame(27_000_000, $this->stock91());
    }

    // ───────────────────────── المعاينة ─────────────────────────

    /** @test */
    public function the_preview_is_read_only_shows_the_proposed_entry_and_hides_amounts_without_cost_permission(): void
    {
        $fill = $this->fill();
        $before = $this->state();
        $data = $this->withToken($this->w['owner_token'])->getJson(self::FILLS . "/{$fill->id}/inventory-posting/preview")->assertOk()->json('data');
        $this->assertSame('postable', $data['status']);
        $this->assertFalse($data['historical']);
        $this->assertSame(654_000, $data['entry']['amount_minor']);
        $this->assertSame($this->clearing->id, $data['entry']['lines'][0]['account_id']);
        $this->assertSame('debit', $data['entry']['lines'][0]['side']);
        $this->assertSame('credit', $data['entry']['lines'][1]['side']);
        $this->assertSame($before, $this->state());

        $viewer = $this->userWith(['fuel_stations.view', 'fuel.tanker.fill.view', 'fuel.tanker.fill.inventory.view']);
        $masked = $this->withToken($viewer['token'])->getJson(self::FILLS . "/{$fill->id}/inventory-posting/preview")->assertOk()->json('data');
        $this->assertNull($masked['entry']['amount_minor']);
        $this->withToken($this->userWith(['fuel_stations.view'])['token'])->getJson(self::FILLS . "/{$fill->id}/inventory-posting/preview")->assertForbidden();
    }

    /** @test */
    public function the_preview_hides_account_ids_without_accounts_view_independently_of_the_cost_permission(): void
    {
        $fill = $this->fill();
        $base = ['fuel_stations.view', 'fuel.tanker.fill.view', 'fuel.tanker.fill.inventory.view'];
        $url = self::FILLS . "/{$fill->id}/inventory-posting/preview";
        $before = $this->state();

        // أقل صلاحية: لا حسابات ولا مبلغ.
        $low = $this->withToken($this->userWith($base)['token'])->getJson($url)->assertOk()->json('data');
        $this->assertNull($low['entry']['amount_minor']);
        foreach ($low['entry']['lines'] as $line) {
            $this->assertNull($line['account_id']);
        }
        $this->assertSame(['debit', 'credit'], array_column($low['entry']['lines'], 'side'));
        $this->assertStringNotContainsString($this->clearing->id, json_encode($low));

        // التكلفة وحدها: المبلغ بلا معرّفات حسابات.
        $costOnly = $this->withToken($this->userWith([...$base, 'products.view_cost'])['token'])->getJson($url)->assertOk()->json('data');
        $this->assertSame(654_000, $costOnly['entry']['amount_minor']);
        $this->assertNull($costOnly['entry']['lines'][0]['account_id']);
        $this->assertNull($costOnly['entry']['lines'][1]['account_id']);

        // الحسابات وحدها: المعرّفات بلا مبلغ.
        $accountsOnly = $this->withToken($this->userWith([...$base, 'accounts.view'])['token'])->getJson($url)->assertOk()->json('data');
        $this->assertNull($accountsOnly['entry']['amount_minor']);
        $this->assertSame($this->clearing->id, $accountsOnly['entry']['lines'][0]['account_id']);
        $this->assertNotNull($accountsOnly['entry']['lines'][1]['account_id']);

        // المصرَّح له بالاثنين يرى التفاصيل كاملة (والمالك كذلك).
        $both = $this->withToken($this->userWith([...$base, 'accounts.view', 'products.view_cost'])['token'])->getJson($url)->assertOk()->json('data');
        $this->assertSame(654_000, $both['entry']['amount_minor']);
        $this->assertSame($this->clearing->id, $both['entry']['lines'][0]['account_id']);
        $this->assertSame($accountsOnly['entry']['lines'][1]['account_id'], $both['entry']['lines'][1]['account_id']);

        $this->assertSame($before, $this->state(), 'المعاينة قراءة فقط');
    }

    // ───────────────────────── حراسة ساكنة ─────────────────────────

    /** @test */
    public function the_posting_services_are_the_only_writers_and_never_touch_revenue_tax_cogs_or_invoicing(): void
    {
        $source = (string) file_get_contents(app_path('Services/FuelTankerFillInventoryPostingService.php'));
        $code = (string) preg_replace('~/\*.*?\*/|//[^\n]*~s', '', $source);
        foreach (['InvoiceService', 'PaymentService', 'recordGain', 'applyReceipt', 'reverse(', "'5110'", "'4110'", "'2120'", "'1130'", 'cogs'] as $needle) {
            $this->assertStringNotContainsString($needle, $code, "خدمة الترحيل لا تستعمل {$needle}");
        }
        // PR-6B-4: مساران للعكس فقط (معاينة وتنفيذ) في خدمته المستقلة؛ خدمة الترحيل لا تعكس.
        $routes = (string) file_get_contents(base_path('routes/api.php'));
        $this->assertSame(2, preg_match_all('/tanker-fills\/\{id\}\/inventory-reversal/', $routes));
        $this->assertSame(1, preg_match_all('/tanker-fills\/\{id\}\/inventory-posting\'/', $routes));

        // لا كاتب آخر لجدولي الترحيل والمحاولات خارج الخدمة ونماذجها.
        $hits = [];
        foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(app_path())) as $path) {
            if (! $path->isFile() || ! str_ends_with((string) $path, '.php')) {
                continue;
            }
            $text = (string) file_get_contents((string) $path);
            if (preg_match('/DB::table\(\s*\'fuel_tanker_fill_inventory_posting(s|_attempts)\'\s*\)\s*->\s*(insert|update|delete|upsert)/', $text) === 1) {
                $hits[] = basename((string) $path);
            }
        }
        sort($hits);
        // PR-6B-4: الكاتبان خدمتا الترحيل والعكس (وسمتهما لتسجيل المحاولات الفاشلة).
        $this->assertSame(['FuelTankerFillInventoryPostingService.php', 'FuelTankerFillInventoryReversalService.php', 'FuelTankerFillInventorySupport.php'], $hits);
    }
}
