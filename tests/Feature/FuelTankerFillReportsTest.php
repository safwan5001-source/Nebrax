<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\FuelStation;
use App\Models\FuelTankerFill;
use App\Models\FuelTankerOwner;
use App\Models\User;
use App\Services\Accounting\LedgerService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * TANKER-PR6B-6 — تقارير الرقابة والمطابقة المحاسبية لسندات التعبئة (قراءة فقط): سلامة التقارير على بيانات سليمة، اكتشاف كل نوع خلل بتعديل مباشر للبيانات الاختبارية،
 * المرشّحات، الحجب المستقل للمبالغ والحسابات، تقرير الحساب الوسيط (افتتاحي/مدين/دائن/ختامي/المدعوم/القيود الأخرى)، والعزل والبوابات وPIN.
 */
class FuelTankerFillReportsTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use BuildsFuelOpeningWorld;
    use BuildsTankerPostingWorld;

    private const BASE = '/api/fuel-stations/tanker-fill-reports/';
    private const VIEW = ['fuel_stations.view', 'fuel.tanker.fill.view', 'fuel.tanker.fill.inventory.view'];

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootPostingWorld();
    }

    private function report(string $key, array $query = [], ?string $token = null): \Illuminate\Testing\TestResponse
    {
        return $this->withToken($token ?? $this->w['owner_token'])->getJson(self::BASE . $key . ($query === [] ? '' : '?' . http_build_query($query)));
    }

    /** @return array{posted: FuelTankerFill, reversed: FuelTankerFill, pending: FuelTankerFill} */
    private function seedFills(): array
    {
        $posted = $this->fill(3_000_000);
        $this->postFill($posted)->assertCreated();
        $reversed = $this->fill(2_000_000);
        $this->postFill($reversed)->assertCreated();
        $this->reverseFill($reversed)->assertCreated();
        $pending = $this->fill(500_000);

        return compact('posted', 'reversed', 'pending');
    }

    private function rowOf(array $rows, FuelTankerFill $fill): array
    {
        return collect($rows)->first(fn ($r) => ($r['fill_id'] ?? $r['id']) === $fill->id);
    }

    /** @return list<string> */
    private function codes(array $row): array
    {
        return array_column($row['findings'], 'code');
    }

    // ───────────────────────── ① سندات التعبئة ─────────────────────────

    /** @test */
    public function the_fills_report_lists_fills_with_chain_links_totals_and_filters(): void
    {
        $f = $this->seedFills();
        $data = $this->report('fills')->assertOk()->assertJsonPath('meta.read_only', true)->json('data');
        $this->assertSame(3, $data['summary']['total_count']);
        $this->assertSame(5_500_000, $data['summary']['total_quantity_milliliters']);
        $posted = $this->rowOf($data['rows'], $f['posted']);
        $this->assertSame('posted', $posted['posting_status']);
        $this->assertSame(654_000, $posted['posted_cost_minor']);
        $this->assertNotNull($posted['journal_entry']['number']);
        $this->assertNull($posted['reversal_journal_entry']);
        $reversed = $this->rowOf($data['rows'], $f['reversed']);
        $this->assertSame('reversed', $reversed['posting_status']);
        $this->assertNotNull($reversed['reversal_journal_entry']['number']);
        $this->assertNotNull($reversed['reversal_stock_movement_id']);
        $pending = $this->rowOf($data['rows'], $f['pending']);
        $this->assertNull($pending['posting_status']);
        $this->assertArrayNotHasKey('posted_cost_minor', $pending);

        // المرشّحات.
        $this->assertSame(1, $this->report('fills', ['inventory_status' => 'reversed'])->json('data.summary.total_count'));
        $this->assertSame(2, $this->report('fills', ['inventory_status' => 'posted'])->json('data.summary.total_count') + 1);
        $this->assertSame(0, $this->report('fills', ['owner_id' => FuelTankerOwner::create(['name' => 'آخر', 'code' => 'OTH', 'status' => 'active'])->id])->json('data.summary.total_count'));
        $this->assertSame(3, $this->report('fills', ['station_id' => $this->w['station']->id, 'fuel_product_id' => $this->w['fuels']['91']->id, 'branch_id' => $this->w['station']->branch_id, 'status' => 'recorded'])->json('data.summary.total_count'));
        $this->assertSame(0, $this->report('fills', ['from' => now()->addDays(2)->toDateString()])->json('data.summary.total_count'));
        $this->assertSame(3, $this->report('fills', ['from' => now()->subDay()->toDateString(), 'to' => now()->addDay()->toDateString()])->json('data.summary.total_count'));
        $this->assertSame(2, $this->report('fills', ['per_page' => 2])->json('data.pagination.last_page'));
        $this->assertSame(2, count($this->report('fills', ['per_page' => 2])->json('data.rows')));
    }

    // ───────────────────────── ② + ④ سلامة البيانات الصحيحة ─────────────────────────

    /** @test */
    public function clean_data_reconciles_end_to_end_and_unposted_fills_are_incomplete_not_errors(): void
    {
        $f = $this->seedFills();
        foreach (['inventory-reconciliation', 'accounting-control'] as $key) {
            $data = $this->report($key)->assertOk()->json('data');
            $this->assertSame(['total' => 3, 'matched' => 2, 'confirmed_differences' => 0, 'warnings' => 0, 'incomplete' => 1], collect($data['summary'])->only(['total', 'matched', 'confirmed_differences', 'warnings', 'incomplete'])->all(), $key);
            $this->assertSame('matched', $this->rowOf($data['rows'], $f['posted'])['result']);
            $this->assertSame('matched', $this->rowOf($data['rows'], $f['reversed'])['result']);
            $pending = $this->rowOf($data['rows'], $f['pending']);
            $this->assertSame('incomplete', $pending['result']);
            $this->assertSame(['not_posted_yet'], $this->codes($pending));
            $this->assertFalse($data['truncated']);
        }
        $recon = $this->report('inventory-reconciliation')->json('data');
        $this->assertSame(3_000_000, $recon['summary']['quantity_totals']['fills_posted_milliliters']);
        $this->assertSame(3_000_000, $recon['summary']['quantity_totals']['stock_out_milliliters']);
        $this->assertSame(3_000_000, $recon['summary']['quantity_totals']['cost_issue_milliliters']);
        $this->assertSame(3_000_000, $recon['summary']['quantity_totals']['ledger_milliliters']);
        $this->assertSame(2_000_000, $recon['summary']['quantity_totals']['reversed_milliliters']);
        // مطابقة المجمّع بالمحرك القائم: لا أخطاء ولا فرق قيمة.
        $this->assertSame([], array_values(array_filter($recon['pool']['findings'], fn ($x) => $x['severity'] === 'error')));
        $this->assertSame(0, $recon['pool']['value']['total']['difference_minor']);

        $control = $this->report('accounting-control')->json('data');
        $row = $this->rowOf($control['rows'], $f['reversed']);
        $this->assertSame(2_000_000, $row['quantities']['stock_out']);
        $this->assertSame(2_000_000, $row['quantities']['stock_reversal_in']);
        $this->assertSame(436_000, $row['values']['entry_debit_minor']);
        $this->assertSame(436_000, $row['values']['reversal_entry_credit_minor']);
        $this->assertNotNull($row['chain']['reversal_journal_entry']['number']);
        $this->assertSame('reversed', $row['chain']['journal_entry']['status']);
        $this->assertSame([], $control['summary']['findings_by_code'] === [] ? [] : array_values(array_filter($control['summary']['findings_by_code'], fn ($c) => $c['severity'] === 'error')));
        // الحساب الوسيط: مدعوم بالحركات ولا فرق.
        $this->assertSame(0, $control['clearing']['accounts'][0]['unexplained_difference_minor']);
        $this->assertSame(654_000, $control['clearing']['accounts'][0]['closing_balance_minor']);
    }

    // ───────────────────────── اكتشاف الأخطاء المؤكدة ─────────────────────────

    /** @test */
    public function every_data_defect_is_detected_as_a_confirmed_difference(): void
    {
        $f = $this->seedFills();
        $control = fn () => $this->report('accounting-control')->assertOk()->json('data');

        // قيد بلا ترحيل (سند بانتظار الترحيل له قيد مصدره السند).
        $inventory = Account::query()->where('code', '1140')->firstOrFail();
        app(TenantContext::class)->set($this->w['tenant_id']);
        app(LedgerService::class)->post([
            ['account_id' => $this->clearing->id, 'debit' => 777, 'branch_id' => $this->w['station']->branch_id],
            ['account_id' => $inventory->id, 'credit' => 777, 'branch_id' => $this->w['station']->branch_id],
        ], ['entry_date' => now()->toDateString(), 'description' => 'قيد شاذ', 'source_type' => FuelTankerFill::class, 'source_id' => $f['pending']->id]);
        $row = $this->rowOf($control()['rows'], $f['pending']);
        $this->assertContains('entry_without_posting', $this->codes($row));
        $this->assertSame('mismatch', $row['result']);

        // اختلاف مبلغ القيد (سطرا القيد الأصلي).
        $postedEntry = DB::table('fuel_inventory_cost_movements')->where('id', DB::table('fuel_tanker_fill_inventory_postings')->where('fuel_tanker_fill_id', $f['posted']->id)->value('cost_movement_id'))->value('journal_entry_id');
        DB::table('journal_lines')->where('journal_entry_id', $postedEntry)->update(['debit' => DB::raw('CASE WHEN debit > 0 THEN debit + 100 ELSE debit END'), 'credit' => DB::raw('CASE WHEN credit > 0 THEN credit + 100 ELSE credit END')]);
        $row = $this->rowOf($control()['rows'], $f['posted']);
        $this->assertContains('entry_amount_mismatch', $this->codes($row));
        $this->assertSame('mismatch', $row['result']);

        // اختلاف كمية حركة المخزون وقيمتها ونقص الدفتر التشغيلي.
        $stockId = DB::table('fuel_tanker_fill_inventory_postings')->where('fuel_tanker_fill_id', $f['posted']->id)->value('stock_movement_id');
        DB::table('stock_movements')->where('id', $stockId)->update(['quantity' => 2_999_999, 'total_cost' => 1]);
        DB::table('fuel_operational_ledgers')->where('source_id', $f['posted']->id)->where('movement_type', 'tanker_fill')->update(['quantity_milliliters' => -1, 'value_minor' => -2]);
        $codes = $this->codes($this->rowOf($control()['rows'], $f['posted']));
        foreach (['stock_quantity_mismatch', 'stock_value_mismatch', 'ledger_quantity_mismatch', 'ledger_value_mismatch'] as $code) {
            $this->assertContains($code, $codes);
        }
        $recon = $this->report('inventory-reconciliation')->json('data');
        $this->assertContains('stock_quantity_mismatch', $this->codes($this->rowOf($recon['rows'], $f['posted'])));
        $this->assertGreaterThan(0, $recon['summary']['confirmed_differences']);

        // عكس ناقص (حذف صف الدفتر العكسي) وعكس مكرر (قيد عكسي ثانٍ للأصل نفسه).
        DB::table('fuel_operational_ledgers')->where('source_id', $f['reversed']->id)->where('movement_type', 'tanker_fill_reversal')->delete();
        $this->assertContains('reversal_incomplete', $this->codes($this->rowOf($control()['rows'], $f['reversed'])));
        $original = DB::table('fuel_inventory_cost_movements')->where('id', DB::table('fuel_tanker_fill_inventory_postings')->where('fuel_tanker_fill_id', $f['reversed']->id)->value('cost_movement_id'))->value('journal_entry_id');
        $dupId = (string) \Illuminate\Support\Str::uuid();
        DB::table('journal_entries')->insert(['id' => $dupId, 'tenant_id' => $this->w['tenant_id'], 'number' => 'JE-DUP-1', 'entry_date' => now()->toDateString(), 'description' => 'عكس مكرر', 'status' => 'posted', 'reversal_of' => $original, 'source_type' => FuelTankerFill::class, 'source_id' => $f['reversed']->id, 'created_at' => now(), 'updated_at' => now()]);
        $this->assertContains('reversal_duplicate', $this->codes($this->rowOf($control()['rows'], $f['reversed'])));

        $summary = $control()['summary'];
        $this->assertGreaterThanOrEqual(2, $summary['confirmed_differences']);
        $this->assertContains('reversal_duplicate', array_column($summary['findings_by_code'], 'code'));
    }

    /** @test */
    public function a_posted_fill_without_a_journal_entry_and_an_invalid_clearing_account_are_flagged(): void
    {
        $f = $this->seedFills();
        $cost = DB::table('fuel_tanker_fill_inventory_postings')->where('fuel_tanker_fill_id', $f['posted']->id)->value('cost_movement_id');
        $entry = DB::table('fuel_inventory_cost_movements')->where('id', $cost)->value('journal_entry_id');
        // الحساب الوسيط يتحول إلى حساب مخزون (مخالف لشروط الحارس): يُكتشف كخطأ.
        $inventory = Account::query()->where('code', '1140')->firstOrFail();
        DB::table('journal_lines')->where('journal_entry_id', $entry)->where('debit', '>', 0)->update(['account_id' => $inventory->id]);
        $row = $this->rowOf($this->report('accounting-control')->json('data.rows'), $f['posted']);
        $this->assertContains('clearing_account_invalid', $this->codes($row));

        // قيد الترحيل يختفي (حذف القيد وسطوره): سند مرحّل بلا قيد.
        DB::table('fuel_inventory_cost_movements')->where('id', $cost)->update(['journal_entry_id' => null]);
        $row = $this->rowOf($this->report('accounting-control')->json('data.rows'), $f['posted']);
        $this->assertContains('posted_without_entry', $this->codes($row));
        $this->assertSame('mismatch', $row['result']);
    }

    // ───────────────────────── ③ الحساب الوسيط ─────────────────────────

    /** @test */
    public function the_clearing_account_report_shows_balances_supported_by_postings_and_other_entries(): void
    {
        $f = $this->seedFills();
        $today = now()->toDateString();
        $data = $this->report('clearing-account', ['from' => $today, 'to' => $today])->assertOk()->json('data');
        $account = $data['accounts'][0];
        $this->assertSame('1145', $account['account']['code']);
        $this->assertTrue($account['account']['is_current']);
        $this->assertSame(0, $account['opening_balance_minor']);
        // سند 3,000 ل مرحَّل (654,000 مدين) + سند 2,000 ل مرحَّل ثم معكوس (436,000 مدين و436,000 دائن).
        $this->assertSame(654_000 + 436_000, $account['period_debits_minor']);
        $this->assertSame(436_000, $account['period_credits_minor']);
        $this->assertSame(654_000, $account['closing_balance_minor']);
        $this->assertSame(654_000, $account['supported_balance_minor']);
        $this->assertSame(0, $account['unexplained_difference_minor']);
        $this->assertSame([], $account['findings']);
        $this->assertSame(['debits_minor' => 1_090_000, 'credits_minor' => 436_000, 'net_all_time_minor' => 654_000], $account['tanker']);
        $this->assertSame(0, $account['other']['debits_minor']);

        // قيد آخر على الحساب الوسيط ليس من السندات: لا يخلق «فرقاً غير مفسَّر» لكنه يُعلن تحذيراً ويدخل الرصيد الختامي دون المدعوم.
        app(TenantContext::class)->set($this->w['tenant_id']);
        $other = Account::create(['code' => '9998', 'name' => 'حساب مقابل اختباري', 'type' => 'liability', 'normal_balance' => 'credit', 'is_group' => false, 'is_active' => true]);
        app(LedgerService::class)->post([
            ['account_id' => $this->clearing->id, 'debit' => 5_000, 'branch_id' => $this->w['station']->branch_id],
            ['account_id' => $other->id, 'credit' => 5_000, 'branch_id' => $this->w['station']->branch_id],
        ], ['entry_date' => $today, 'description' => 'قيد يدوي على الوسيط']);
        $account = $this->report('clearing-account', ['from' => $today, 'to' => $today])->json('data.accounts.0');
        $this->assertSame(659_000, $account['closing_balance_minor']);
        $this->assertSame(654_000, $account['supported_balance_minor']);
        $this->assertSame(0, $account['unexplained_difference_minor']);
        $this->assertSame(['other_entries_on_clearing_account'], array_column($account['findings'], 'code'));
        $this->assertSame(5_000, $account['other']['debits_minor']);
        $this->assertSame('قيد يدوي على الوسيط', $account['other_entries'][0]['description']);

        // الافتتاحي لفترة لاحقة = ختامي ما قبلها.
        $tomorrow = now()->addDay()->toDateString();
        $next = $this->report('clearing-account', ['from' => $tomorrow, 'to' => $tomorrow])->json('data.accounts.0');
        $this->assertSame(659_000, $next['opening_balance_minor']);
        $this->assertSame(0, $next['period_debits_minor']);
        $this->assertSame(659_000, $next['closing_balance_minor']);

        // اختلاف رصيد قيود السندات عن المدعوم بصفوف الترحيل ⇒ خطأ مؤكَّد.
        $entry = DB::table('fuel_inventory_cost_movements')->where('id', DB::table('fuel_tanker_fill_inventory_postings')->where('fuel_tanker_fill_id', $f['posted']->id)->value('cost_movement_id'))->value('journal_entry_id');
        DB::table('journal_lines')->where('journal_entry_id', $entry)->where('debit', '>', 0)->update(['debit' => 654_050]);
        $account = $this->report('clearing-account', ['from' => $today, 'to' => $today])->json('data.accounts.0');
        $this->assertSame(50, $account['unexplained_difference_minor']);
        $this->assertContains('clearing_balance_differs_from_postings', array_column($account['findings'], 'code'));
    }

    /** @test */
    public function a_changed_clearing_account_keeps_the_historical_account_in_the_report(): void
    {
        $this->seedFills();
        app(TenantContext::class)->set($this->w['tenant_id']);
        $new = Account::create(['code' => '1146', 'name' => 'وسيط جديد', 'type' => 'asset', 'normal_balance' => 'debit', 'is_group' => false, 'is_active' => true]);
        $this->configure(['tanker_issue_clearing_account_id' => $new->id]);
        $accounts = $this->report('clearing-account')->json('data.accounts');
        $this->assertSame(['1145', '1146'], array_column(array_column($accounts, 'account'), 'code'));
        $old = collect($accounts)->firstWhere('account.code', '1145');
        $this->assertFalse($old['account']['is_current']);
        $this->assertContains('clearing_account_differs_from_current', array_column($old['findings'], 'code'));
        $this->assertSame(654_000, $old['supported_balance_minor']);
    }

    // ───────────────────────── الصلاحيات والعزل ─────────────────────────

    /** @test */
    public function permissions_masking_gates_pin_scope_and_validation_are_enforced_and_nothing_is_written(): void
    {
        $f = $this->seedFills();
        $before = $this->state();

        foreach (['tanker_management_enabled', 'tanker_fills_enabled', 'tanker_inventory_posting_enabled'] as $gate) {
            config(["fuel_stations.{$gate}" => false]);
            $this->report('fills')->assertNotFound();
            config(["fuel_stations.{$gate}" => true]);
        }
        $this->report('bogus')->assertNotFound();
        $this->report('fills', ['from' => 'x'])->assertStatus(422);
        $this->report('fills', ['inventory_status' => 'weird'])->assertStatus(422);
        $this->report('fills', ['from' => '2026-02-02', 'to' => '2026-01-01'])->assertStatus(422);
        $this->report('fills', ['station_id' => (string) \Illuminate\Support\Str::uuid()])->assertNotFound();
        $this->report('fills', [], $this->userWith(['fuel_stations.view', 'fuel.tanker.fill.view'])['token'])->assertForbidden();
        $pin = User::query()->whereKey($this->w['actor']->id)->firstOrFail()->createToken('station', ['station-ops'])->plainTextToken;
        foreach (['fills', 'inventory-reconciliation', 'clearing-account', 'accounting-control'] as $key) {
            $this->report($key, [], $pin)->assertForbidden();
        }

        // نطاق محطة آخر ومستأجر آخر.
        $other = FuelStation::create(['branch_id' => $this->w['station']->branch_id, 'warehouse_id' => $this->w['warehouse']->id, 'code' => 'RP-OTHER', 'name' => 'محطة أخرى']);
        $scoped = $this->userWith(self::VIEW, [$other->id]);
        $this->assertSame(0, $this->report('fills', [], $scoped['token'])->json('data.summary.total_count'));
        $this->assertSame([], $this->report('accounting-control', [], $scoped['token'])->json('data.rows'));
        $this->report('fills', ['station_id' => $this->w['station']->id], $scoped['token'])->assertNotFound();
        $foreign = $this->openingWorld();
        $this->assertSame(0, $this->report('fills', [], $foreign['owner_token'])->json('data.summary.total_count'));

        // الحجب المستقل: بلا تكلفة/حسابات.
        app(TenantContext::class)->set($this->w['tenant_id']);
        $low = $this->userWith(self::VIEW);
        $control = $this->report('accounting-control', [], $low['token'])->assertOk()->json('data');
        $row = $this->rowOf($control['rows'], $f['posted']);
        $this->assertNull($row['values']);
        $this->assertNull($row['chain']);
        $this->assertNull($row['accounts']);
        $this->assertSame(['available' => false, 'reason' => 'financial_permissions_required', 'accounts' => []], $control['clearing']);
        $this->assertTrue($control['masking']['costs']);
        $fills = $this->report('fills', [], $low['token'])->json('data');
        $this->assertArrayNotHasKey('posted_cost_minor', $this->rowOf($fills['rows'], $f['posted']));
        $this->assertArrayNotHasKey('journal_entry', $this->rowOf($fills['rows'], $f['posted']));
        $this->assertStringNotContainsString($this->clearing->id, json_encode($control));

        // الحساب الوسيط ماليٌّ بالكامل: الاثنان معاً وإلا 403.
        $this->report('clearing-account', [], $low['token'])->assertForbidden();
        $this->report('clearing-account', [], $this->userWith([...self::VIEW, 'products.view_cost'])['token'])->assertForbidden();
        $this->report('clearing-account', [], $this->userWith([...self::VIEW, 'accounts.view'])['token'])->assertForbidden();
        $this->report('clearing-account', [], $this->userWith([...self::VIEW, 'accounts.view', 'products.view_cost'])['token'])->assertOk();
        $accountsOnly = $this->report('accounting-control', [], $this->userWith([...self::VIEW, 'accounts.view'])['token'])->json('data');
        $this->assertSame($this->clearing->id, $this->rowOf($accountsOnly['rows'], $f['posted'])['accounts']['clearing_account_id']);
        $this->assertNull($this->rowOf($accountsOnly['rows'], $f['posted'])['values']);

        $this->assertSame($before, $this->state(), 'تقارير قراءة فقط');
    }

    // ───────────────────────── نطاق المحطات لأرصدة الأستاذ ─────────────────────────

    /** @test */
    public function a_station_restricted_user_with_cost_and_accounts_permissions_never_sees_ledger_balances_or_other_stations_data(): void
    {
        $f = $this->seedFills();
        $today = now()->toDateString();
        // قيد يدوي على الحساب الوسيط بفرع المحطة نفسه (يمثّل نشاط محطة أخرى في الفرع: سطر القيد يحمل الفرع لا المحطة).
        app(TenantContext::class)->set($this->w['tenant_id']);
        $counter = Account::create(['code' => '9997', 'name' => 'مقابل اختباري', 'type' => 'liability', 'normal_balance' => 'credit', 'is_group' => false, 'is_active' => true]);
        $manual = app(LedgerService::class)->post([
            ['account_id' => $this->clearing->id, 'debit' => 7_700, 'branch_id' => $this->w['station']->branch_id],
            ['account_id' => $counter->id, 'credit' => 7_700, 'branch_id' => $this->w['station']->branch_id],
        ], ['entry_date' => $today, 'description' => 'قيد محطة أخرى في الفرع', 'source_type' => null]);
        $before = $this->state();

        $financial = [...self::VIEW, 'accounts.view', 'products.view_cost'];
        $otherStation = FuelStation::create(['branch_id' => $this->w['station']->branch_id, 'warehouse_id' => $this->w['warehouse']->id, 'code' => 'RP-SCOPE', 'name' => 'محطة مقيَّدة']);
        $elsewhere = $this->userWith($financial, [$otherStation->id]);   // مقيَّد بمحطة لا سندات لها
        $sameStation = $this->userWith($financial, [$this->w['station']->id]); // مقيَّد بمحطة السندات نفسها، وفي الفرع نشاط خارجها

        foreach ([$elsewhere, $sameStation] as $i => $restricted) {
            // الحساب الوسيط: 403 برمز السبب، بلا أي رصيد أو قيد.
            $response = $this->report('clearing-account', ['from' => $today, 'to' => $today], $restricted['token'])->assertForbidden();
            $this->assertSame('station_scope_restricted', $response->json('details.reason'), "مستخدم {$i}");
            $this->assertStringNotContainsString('7700', (string) $response->getContent());
            $this->assertStringNotContainsString($manual->number, (string) $response->getContent());

            // الرقابة المحاسبية: القسم المالي غير متاح بسبب معلن، ولا يظهر رصيد ولا قيد خارج محطات المستخدم.
            $control = $this->report('accounting-control', ['from' => $today, 'to' => $today], $restricted['token'])->assertOk()->json('data');
            $this->assertSame(['available' => false, 'reason' => 'station_scope_restricted', 'accounts' => []], $control['clearing']);
            $json = json_encode($control);
            $this->assertStringNotContainsString($manual->number, $json);
            $this->assertStringNotContainsString('closing_balance_minor', $json);
            $this->assertStringNotContainsString('"code":"1145"', $json);
        }

        // المحطة الأخرى بلا سندات: لا صفوف ولا أعداد؛ المقيَّد بمحطة السندات يرى سنداتها فقط (لا غيرها).
        $this->assertSame([], $this->report('accounting-control', [], $elsewhere['token'])->json('data.rows'));
        $this->assertSame(0, $this->report('fills', [], $elsewhere['token'])->json('data.summary.total_count'));
        $mine = $this->report('accounting-control', [], $sameStation['token'])->json('data');
        $this->assertSame(3, $mine['summary']['total']);
        $this->assertTrue($mine['rows'][0]['station_id'] === $this->w['station']->id);
        $this->assertSame(654_000, $this->rowOf($mine['rows'], $f['posted'])['values']['posting_cost_minor']);

        // مطابقة المخزون: قيمة المجمّع/الأستاذ تُحجب عن المقيَّد بمحطة (نطاق مالي ناقص) والكمية تبقى.
        $recon = $this->report('inventory-reconciliation', [], $sameStation['token'])->assertOk()->json('data');
        $this->assertSame('restricted_warehouse_scope', $recon['pool']['value_scope']);
        $this->assertNull($recon['pool']['value']);

        // مستخدم بنطاق المؤسسة الكامل: يرى الرصيد الحقيقي (يشمل القيد الآخر) مع نطاق معلن، وفلاتر المحطة تُعلَن «غير مطبَّقة على الأرصدة».
        $org = $this->userWith($financial);
        $full = $this->report('clearing-account', ['from' => $today, 'to' => $today, 'station_id' => $this->w['station']->id, 'owner_id' => $this->owner->id], $org['token'])->assertOk();
        $account = $full->json('data.accounts.0');
        $this->assertSame(654_000 + 7_700, $account['closing_balance_minor']);
        $this->assertSame('organization', $full->json('data.scope.level'));
        $this->assertSame(['period'], $full->json('data.scope.filters_applied'));
        $this->assertContains('station_id', $full->json('meta.balance_filters_not_applicable'));
        $this->assertContains('owner_id', $full->json('meta.balance_filters_not_applicable'));
        $this->assertFalse($full->json('meta.row_scope.station_restricted'));
        $ctl = $this->report('accounting-control', ['station_id' => $this->w['station']->id], $org['token'])->assertOk();
        $this->assertTrue($ctl->json('data.clearing.available'));
        $this->assertSame(['station_id'], $ctl->json('meta.balance_filters_not_applicable'));

        // مرشّح الفرع يؤثر فعلاً في الأرصدة ويُعلَن: فرع آخر ⇒ لا قيود له.
        $otherBranch = \App\Models\Branch::create(['name' => 'فرع آخر', 'code' => 'BR-RP-2']);
        $filtered = $this->report('clearing-account', ['from' => $today, 'to' => $today, 'branch_id' => $otherBranch->id], $org['token']);
        $this->assertSame(0, $filtered->assertOk()->json('data.accounts.0.closing_balance_minor'));
        $this->assertSame(['period', 'branch'], $filtered->json('data.scope.filters_applied'));
        $this->assertSame([$otherBranch->id], $filtered->json('data.scope.branch_ids'));

        $this->assertSame($before['journal_lines'], $this->state()['journal_lines'], 'قراءة فقط');
    }
}
