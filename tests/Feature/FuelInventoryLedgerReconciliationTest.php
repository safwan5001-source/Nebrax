<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Branch;
use App\Models\FuelOpeningBalance;
use App\Models\FuelStation;
use App\Models\JournalEntry;
use App\Models\Role;
use App\Models\User;
use App\Services\Accounting\LedgerService;
use App\Services\FuelStationAuditTrail;
use App\Services\FuelInventoryLedgerReconciliation as Recon;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * TANKER-PR6B-0 — مطابقة مجمّع تكلفة الوقود مع رصيد المخزن والأستاذ العام: **قراءة فقط**.
 *
 * الأساس الحقيقي: مستند رصيد افتتاحي مرحَّل (قيد واحد مرتبط بحركات تكلفة لثلاثة منتجات) ⇒ حالة متّسقة بالتعريف؛ ثم تُفسَد الحالات واحدةً واحدة بتعديل مباشر للصفوف
 * (يحاكي مساراً لا يمرّ بالمحرك) فيثبت أن كل فرق يُكشف ويُنسب إلى سببه المُثبَت (المتطابقة D = E + Rv − Δunl − B بمتبقٍّ صفر). التكاليف والكميات وهمية.
 */
class FuelInventoryLedgerReconciliationTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use BuildsFuelOpeningWorld;

    private const OPENING = '/api/fuel-stations/opening-balances';
    private const RECON = '/api/fuel-stations/tanker-fills/inventory-review/reconciliation';
    private int $seq = 0;

    protected function setUp(): void
    {
        parent::setUp();
        config(['fuel_stations.tanker_management_enabled' => true, 'fuel_stations.tanker_fills_enabled' => true]);
    }

    /** @return array{0: array<string,mixed>, 1: string, 2: string} [العالم، معرّف المستند، معرّف القيد] */
    private function postedWorld(): array
    {
        $w = $this->openingWorld();
        $id = $this->withToken($w['owner_token'])->postJson(self::OPENING, $this->openingPayload($w))->assertCreated()->json('data.id');
        $this->withToken($w['owner_token'])->postJson(self::OPENING . "/{$id}/post")->assertOk();
        $entry = (string) DB::table('journal_entries')->where('tenant_id', $w['tenant_id'])->where('source_type', FuelOpeningBalance::class)->value('id');
        $this->assertNotSame('', $entry);

        return [$w, $id, $entry];
    }

    /** @param array<string,mixed> $w @return array<string,mixed> */
    private function recon(array $w, bool $values = true, ?array $warehouses = null, ?array $branches = null, bool $fullScope = true): array
    {
        app(TenantContext::class)->set($w['tenant_id']);

        return app(Recon::class)->reconcile($warehouses, $branches, $values, $fullScope);
    }

    /** @param array<string,mixed> $result @return list<string> */
    private function codes(array $result): array
    {
        return array_values(array_unique(array_column($result['findings'], 'code')));
    }

    /** @param array<string,mixed> $result @return array<string,mixed> */
    private function branchRow(array $result): array
    {
        $this->assertCount(1, $result['value']['branches']);

        return $result['value']['branches'][0];
    }

    /** @param array<string,mixed> $row المتطابقة D = E + Rv − Δunl − B: المتبقي غير المفسَّر صفر دائماً. */
    private function assertIdentity(array $row): void
    {
        $c = $row['causes'];
        $this->assertSame($row['difference_minor'], $c['entry_amount_differs_minor'] + $c['reversed_entries_minor'] + $c['movements_without_journal_minor'] + $c['state_vs_movements_minor']);
        $this->assertSame(0, $row['unexplained_minor']);
        $this->assertSame($row['ledger_share_minor'] - $row['pool_value_minor'], $row['difference_minor']);
    }

    // ───────────────────────── الحالة المتّسقة والاحتساب ─────────────────────────

    /** @test */
    public function a_posted_opening_balance_reconciles_quantity_and_value_with_the_ledger(): void
    {
        [$w] = $this->postedWorld();
        $result = $this->recon($w);

        $this->assertTrue($result['read_only']);
        $this->assertSame(Recon::STATUS_CONSISTENT, $result['status']);
        $this->assertSame([], $result['findings']);
        $this->assertSame(['pools' => 3, 'in_sync' => 3, 'mismatched' => 0, 'missing_pool' => 0, 'missing_stock_record' => 0, 'state_not_from_movements' => 0, 'open_cost_history' => 0], $result['quantity']['summary']);
        $row = $this->branchRow($result);
        $this->assertSame(self::TOTAL_VALUE, $row['pool_value_minor']);
        $this->assertSame(self::TOTAL_VALUE, $row['ledger_share_minor']);
        $this->assertSame(0, $row['difference_minor']);
        $this->assertTrue($row['in_sync']);
        $this->assertSame(0, $result['value']['entries_with_amount_difference']['total']);
        $this->assertSame('tenant_by_branch', $result['value_scope']);
        $this->assertContains('price_and_average_correctness', $result['data_quality']['not_checked']);
    }

    /** @test */
    public function an_entry_linked_to_several_movements_is_counted_once(): void
    {
        [$w, , $entry] = $this->postedWorld();
        $linked = DB::table('fuel_inventory_cost_movements')->where('tenant_id', $w['tenant_id'])->whereNotNull('journal_entry_id')->count();
        $distinct = DB::table('fuel_inventory_cost_movements')->where('tenant_id', $w['tenant_id'])->whereNotNull('journal_entry_id')->distinct()->count('journal_entry_id');
        $this->assertSame(1, $distinct, 'قيد الرصيد الافتتاحي واحد للمستند كله');
        $this->assertGreaterThan($distinct, $linked, 'عدة حركات ترتبط بالقيد نفسه — الاختبار ذو معنى');

        $row = $this->branchRow($this->recon($w));
        $this->assertSame(self::TOTAL_VALUE, $row['ledger_share_minor'], 'ليس ×عدد الحركات');
        $this->assertSame(1, DB::table('journal_entries')->where('id', $entry)->count());
    }

    /** @test */
    public function non_fuel_and_unlinked_inventory_entries_never_enter_the_fuel_share(): void
    {
        [$w] = $this->postedWorld();
        app(TenantContext::class)->set($w['tenant_id']);
        $inventory = Account::query()->where('code', '1140')->firstOrFail();
        $equity = Account::query()->where('code', '3130')->firstOrFail();
        app(LedgerService::class)->post([
            ['account_id' => $inventory->id, 'debit' => 500_000],
            ['account_id' => $equity->id, 'credit' => 500_000],
        ], ['description' => 'مخزون غير وقودي (قيد يدوي)']);

        $row = $this->branchRow($this->recon($w));
        $this->assertSame(self::TOTAL_VALUE, $row['ledger_share_minor'], 'قيد 1140 غير المرتبط بحركة وقود لا يدخل');
        $this->assertSame(0, $row['difference_minor']);
    }

    // ───────────────────────── كشف الفروقات وأسبابها ─────────────────────────

    /** @test */
    public function a_pool_value_that_drifted_from_its_movements_is_found_with_its_cause(): void
    {
        [$w] = $this->postedWorld();
        DB::table('fuel_inventory_cost_states')->where('tenant_id', $w['tenant_id'])->where('fuel_product_id', $w['fuels']['91']->id)->increment('cost_pool_minor', 777);

        $result = $this->recon($w);
        $row = $this->branchRow($result);
        $this->assertSame(-777, $row['difference_minor']);
        $this->assertSame(-777, $row['causes']['state_vs_movements_minor']);
        $this->assertIdentity($row);
        $this->assertContains(Recon::F_VALUE_DIFFERENCE, $this->codes($result));
        $this->assertContains(Recon::F_STATE_NOT_FROM_MOVEMENTS, $this->codes($result));
        $this->assertSame(Recon::STATUS_DIFFERENCES, $result['status']);
        $pool = collect($result['quantity']['pools'])->firstWhere('fuel_product_id', $w['fuels']['91']->id);
        $this->assertSame(777, $pool['state_vs_movements_value_minor']);
    }

    /** @test */
    public function a_reversed_ledger_entry_without_a_pool_reversal_is_found_as_a_reversal_cause(): void
    {
        [$w, , $entryId] = $this->postedWorld();
        app(TenantContext::class)->set($w['tenant_id']);
        app(LedgerService::class)->reverse(JournalEntry::query()->findOrFail($entryId), null, 'اختبار عكس بلا مجمّع');

        $row = $this->branchRow($this->recon($w));
        $this->assertSame(0, $row['ledger_share_minor'], 'القيد الأصلي والعكسي يلغيان بعضهما في الأستاذ');
        $this->assertSame(-self::TOTAL_VALUE, $row['difference_minor']);
        $this->assertSame(-self::TOTAL_VALUE, $row['causes']['reversed_entries_minor']);
        $this->assertSame(0, $row['causes']['entry_amount_differs_minor']);
        $this->assertIdentity($row);
    }

    /** @test */
    public function movements_without_a_journal_and_entries_that_differ_from_their_movements_are_found(): void
    {
        [$w, , $entryId] = $this->postedWorld();
        $movement = DB::table('fuel_inventory_cost_movements')->where('tenant_id', $w['tenant_id'])->where('fuel_product_id', $w['fuels']['91']->id)->first();
        DB::table('fuel_inventory_cost_movements')->where('id', $movement->id)->update(['journal_entry_id' => null]);

        $result = $this->recon($w);
        $row = $this->branchRow($result);
        $this->assertSame(1, $row['movements_without_journal_count']);
        $this->assertSame(-self::VALUE_91, $row['causes']['movements_without_journal_minor']);
        $this->assertSame(self::VALUE_91, $row['causes']['entry_amount_differs_minor'], 'القيد يحمل قيمة الحركة المفكوكة؛ يفرق عن مجموع حركاته المتبقية');
        $this->assertSame(0, $row['difference_minor'], 'الأثران يتعادلان هنا لكنهما يظهران منفصلين');
        $this->assertIdentity($row);
        $this->assertContains(Recon::F_MOVEMENTS_WITHOUT_JOURNAL, $this->codes($result));
        $this->assertContains(Recon::F_ENTRY_AMOUNT_DIFFERS, $this->codes($result));
        $sample = $result['value']['entries_with_amount_difference']['sample'][0];
        $this->assertSame($entryId, $sample['journal_entry_id']);
        $this->assertSame(self::VALUE_95 + self::VALUE_DIESEL, $sample['movement_delta_minor']);
        $this->assertSame(self::TOTAL_VALUE, $sample['ledger_net_minor']);
    }

    /** @test */
    public function an_entry_amount_that_differs_from_its_movements_changes_the_ledger_share(): void
    {
        [$w, , $entryId] = $this->postedWorld();
        $inventory = Account::query()->where('code', '1140')->firstOrFail();
        DB::table('journal_lines')->where('journal_entry_id', $entryId)->where('account_id', $inventory->id)->where('debit', '>', 0)->limit(1)
            ->update(['debit' => DB::raw('debit + 1000')]);

        $row = $this->branchRow($this->recon($w));
        $this->assertSame(1000, $row['difference_minor']);
        $this->assertSame(1000, $row['causes']['entry_amount_differs_minor']);
        $this->assertIdentity($row);
    }

    /** @test */
    public function quantity_differences_missing_pools_and_missing_stock_records_are_found(): void
    {
        [$w] = $this->postedWorld();
        $product91 = $w['fuels']['91'];
        DB::table('product_warehouse_stock')->where('warehouse_id', $w['warehouse']->id)->where('product_id', $product91->product_id)->decrement('quantity', 1000);
        $mismatch = collect($this->recon($w)['quantity']['pools'])->firstWhere('fuel_product_id', $product91->id);
        $this->assertSame([Recon::F_QUANTITY_MISMATCH], $mismatch['findings']);
        $this->assertSame(1000, $mismatch['quantity_difference_milliliters']);

        DB::table('fuel_inventory_cost_states')->where('tenant_id', $w['tenant_id'])->where('fuel_product_id', $w['fuels']['95']->id)->delete();
        $missingPool = collect($this->recon($w)['quantity']['pools'])->firstWhere('fuel_product_id', $w['fuels']['95']->id);
        $this->assertContains(Recon::F_STOCK_WITHOUT_POOL, $missingPool['findings']);

        DB::table('product_warehouse_stock')->where('warehouse_id', $w['warehouse']->id)->where('product_id', $w['fuels']['diesel']->product_id)->delete();
        $missingStock = collect($this->recon($w)['quantity']['pools'])->firstWhere('fuel_product_id', $w['fuels']['diesel']->id);
        $this->assertContains(Recon::F_POOL_WITHOUT_STOCK, $missingStock['findings']);
        $this->assertSame(Recon::STATUS_DIFFERENCES, $this->recon($w)['status']);
    }

    // ───────────────────────── C-2: حساب المخزون ─────────────────────────

    /** @test */
    public function a_station_inventory_account_that_differs_from_the_role_is_reported_and_enters_the_account_set(): void
    {
        [$w] = $this->postedWorld();
        app(TenantContext::class)->set($w['tenant_id']);
        $parent = Account::query()->where('code', '1140')->firstOrFail();
        $override = Account::create(['code' => '1141', 'name' => 'مخزون محطة (تجاوز)', 'type' => 'asset', 'normal_balance' => 'debit', 'is_group' => false, 'is_active' => true, 'parent_id' => $parent->parent_id]);
        FuelStation::query()->whereKey($w['station']->id)->update(['default_inventory_account_id' => $override->id]);

        $result = $this->recon($w);
        $this->assertContains(Recon::F_ACCOUNT_SPLIT_CONFIGURED, $this->codes($result));
        $accounts = collect($result['inventory_accounts']['accounts'])->keyBy('account_id');
        $this->assertContains('station_override', $accounts[$override->id]['sources']);
        $this->assertContains('system_default', $accounts[$parent->id]['sources']);
        $this->assertSame($override->id, $result['inventory_accounts']['station_overrides'][0]['account_id']);
    }

    /** @test */
    public function receipts_and_issues_that_hit_different_inventory_accounts_are_shown_from_the_ledger_itself(): void
    {
        [$w] = $this->postedWorld();
        app(TenantContext::class)->set($w['tenant_id']);
        $parent = Account::query()->where('code', '1140')->firstOrFail();
        $override = Account::create(['code' => '1141', 'name' => 'مخزون محطة (تجاوز)', 'type' => 'asset', 'normal_balance' => 'debit', 'is_group' => false, 'is_active' => true, 'parent_id' => $parent->parent_id]);
        FuelStation::query()->whereKey($w['station']->id)->update(['default_inventory_account_id' => $override->id]);
        $this->assertFalse($this->recon($w)['inventory_accounts']['split_in_ledger'], 'بلا صرف بعد');

        // صرف بقيد على حساب المحطة (يحاكي البيع/التسوية) مرتبط بحركة تكلفة من نوع issue.
        $cogs = Account::query()->where('code', '5110')->firstOrFail();
        $entry = app(LedgerService::class)->post([
            ['account_id' => $cogs->id, 'debit' => 100], ['account_id' => $override->id, 'credit' => 100],
        ], ['description' => 'صرف محاكى على حساب المحطة']);
        $template = DB::table('fuel_inventory_cost_movements')->where('tenant_id', $w['tenant_id'])->first();
        $stock = (array) DB::table('stock_movements')->where('id', $template->stock_movement_id)->first();
        $stock['id'] = (string) Str::uuid();
        DB::table('stock_movements')->insert($stock);
        $movement = (array) $template;
        $movement['id'] = (string) Str::uuid();
        $movement['stock_movement_id'] = $stock['id'];
        $movement['journal_entry_id'] = $entry->id;
        $movement['movement_type'] = 'issue';
        DB::table('fuel_inventory_cost_movements')->insert($movement);

        $result = $this->recon($w);
        $this->assertTrue($result['inventory_accounts']['split_in_ledger']);
        $this->assertContains(Recon::F_ACCOUNT_SPLIT_IN_LEDGER, $this->codes($result));
        $this->assertArrayHasKey('receipt', $result['inventory_accounts']['entries_by_movement_type']);
        $this->assertArrayHasKey('issue', $result['inventory_accounts']['entries_by_movement_type']);
    }

    // ───────────────────────── مراجعة Codex: نطاق الفروع وتاريخ تجاوزات المحطات ─────────────────────────

    /** صرف محاكى على حساب مخزون معيَّن: قيد Dr 5110 / Cr الحساب مرتبط بحركة تكلفة issue تغيّر قيمتها −المبلغ (يطابق القيد). */
    private function forgeIssue(array $w, Account $inventoryAccount, int $amount): string
    {
        app(TenantContext::class)->set($w['tenant_id']);
        $cogs = Account::query()->where('code', '5110')->firstOrFail();
        $entry = app(LedgerService::class)->post([
            ['account_id' => $cogs->id, 'debit' => $amount], ['account_id' => $inventoryAccount->id, 'credit' => $amount],
        ], ['description' => 'صرف محاكى']);
        $template = DB::table('fuel_inventory_cost_movements')->where('tenant_id', $w['tenant_id'])->first();
        $stock = (array) DB::table('stock_movements')->where('id', $template->stock_movement_id)->first();
        $stock['id'] = (string) Str::uuid();
        DB::table('stock_movements')->insert($stock);
        $movement = (array) $template;
        $movement['id'] = (string) Str::uuid();
        $movement['stock_movement_id'] = $stock['id'];
        $movement['journal_entry_id'] = $entry->id;
        $movement['movement_type'] = 'issue';
        $movement['cost_pool_minor_before'] = $amount;
        $movement['cost_pool_minor_after'] = 0;
        DB::table('fuel_inventory_cost_movements')->insert($movement);

        return (string) $entry->id;
    }

    /** @test */
    public function a_branch_restricted_reviewer_never_sees_entry_discrepancies_that_touch_other_branches(): void
    {
        [$w, , $entryId] = $this->postedWorld();
        $inventory = Account::query()->where('code', '1140')->firstOrFail();
        DB::table('journal_lines')->where('journal_entry_id', $entryId)->where('account_id', $inventory->id)->where('debit', '>', 0)->limit(1)->update(['debit' => DB::raw('debit + 1000')]);
        $main = $w['branch']->id;
        $other = Branch::create(['code' => 'BR-OTHER', 'name' => 'فرع آخر'])->id;

        $unrestricted = $this->recon($w);
        $this->assertSame(1, $unrestricted['value']['entries_with_amount_difference']['total']);

        // فرع آخر وحده: لا رقم قيد ولا مبلغ ولا عدّ ولا نتيجة تخصّ القيد.
        $elsewhere = $this->recon($w, true, null, [$other]);
        $this->assertSame(0, $elsewhere['value']['entries_with_amount_difference']['total']);
        $this->assertSame([], $elsewhere['value']['entries_with_amount_difference']['sample']);
        $this->assertTrue($elsewhere['value']['entries_with_amount_difference']['hidden_by_branch_scope']);
        $this->assertNotContains(Recon::F_ENTRY_AMOUNT_DIFFERS, $this->codes($elsewhere));
        $this->assertTrue($elsewhere['inventory_accounts']['ledger_evidence_hidden_by_branch_scope']);
        $this->assertSame([], $elsewhere['inventory_accounts']['entries_by_movement_type']);
        $this->assertStringNotContainsString($entryId, (string) json_encode($elsewhere));

        // فرع القيد: يراه.
        $own = $this->recon($w, true, null, [$main]);
        $this->assertSame(1, $own['value']['entries_with_amount_difference']['total']);
        $this->assertSame($entryId, $own['value']['entries_with_amount_difference']['sample'][0]['journal_entry_id']);

        // قيد يمسّ فرعاً لا يصله (سطر واحد بوسم فرع آخر): يُستبعد كلياً من المقيَّد بفرعه، ويراه من يصل الفرعين.
        DB::table('journal_lines')->where('journal_entry_id', $entryId)->where('account_id', '!=', $inventory->id)->limit(1)->update(['branch_id' => $other]);
        $this->assertSame(0, $this->recon($w, true, null, [$main])['value']['entries_with_amount_difference']['total']);
        $this->assertSame(1, $this->recon($w, true, null, [$main, $other])['value']['entries_with_amount_difference']['total']);
        $this->assertSame(1, $this->recon($w)['value']['entries_with_amount_difference']['total']);
        $this->assertSame(0, $this->recon($w, true, null, [])['value']['entries_with_amount_difference']['total'], 'لا فروع مرئية ⇒ لا شيء');
    }

    /** @test */
    public function a_cleared_station_override_stays_in_the_account_set_through_the_audit_history(): void
    {
        [$w] = $this->postedWorld();
        app(TenantContext::class)->set($w['tenant_id']);
        $parent = Account::query()->where('code', '1140')->firstOrFail();
        $override = Account::create(['code' => '1141', 'name' => 'مخزون محطة (تجاوز سابق)', 'type' => 'asset', 'normal_balance' => 'debit', 'is_group' => false, 'is_active' => true, 'parent_id' => $parent->parent_id]);
        FuelStation::query()->whereKey($w['station']->id)->update(['default_inventory_account_id' => $override->id]);
        $this->forgeIssue($w, $override, 100);
        $this->assertSame(0, $this->recon($w)['value']['entries_with_amount_difference']['total'], 'المجموعة تشمل التجاوز الحالي');

        // مُسح التجاوز مباشرةً (بلا سجل تدقيق): يخرج الحساب من المجموعة فيظهر فرق زائف — ويُفصَح عنه صراحةً بدل أن يمرّ صامتاً.
        FuelStation::query()->whereKey($w['station']->id)->update(['default_inventory_account_id' => null]);
        $blind = $this->recon($w);
        $this->assertSame(1, $blind['value']['entries_with_amount_difference']['total']);
        $this->assertContains(Recon::F_UNLISTED_ASSET_ACCOUNTS, $this->codes($blind));
        $this->assertSame([$override->id], array_column($blind['inventory_accounts']['unlisted_asset_accounts'], 'account_id'));

        // المسح عبر المسار الرسمي يسجّل حدث تدقيق (قبل/بعد) فيبقى الحساب ضمن المجموعة بمصدره التاريخي ويزول الفرق الزائف.
        app(FuelStationAuditTrail::class)->record('station.updated', FuelStation::query()->findOrFail($w['station']->id), ['default_inventory_account_id' => $override->id], ['default_inventory_account_id' => null], $w['actor']);
        $healed = $this->recon($w);
        $accounts = collect($healed['inventory_accounts']['accounts'])->keyBy('account_id');
        $this->assertContains('station_override_history', $accounts[$override->id]['sources']);
        $this->assertSame(0, $healed['value']['entries_with_amount_difference']['total']);
        $this->assertSame([], $healed['inventory_accounts']['unlisted_asset_accounts']);
        $this->assertNotContains(Recon::F_UNLISTED_ASSET_ACCOUNTS, $this->codes($healed));
        $this->assertNotContains(Recon::F_ENTRY_AMOUNT_DIFFERS, $this->codes($healed));
    }

    // ───────────────────────── العزل والصلاحيات ─────────────────────────

    /** @test */
    public function another_tenants_pools_and_ledger_never_enter_the_result(): void
    {
        [$a] = $this->postedWorld();
        [$b] = $this->postedWorld();
        $this->assertNotSame($a['tenant_id'], $b['tenant_id']);

        $resultA = $this->recon($a);
        $this->assertSame(3, $resultA['quantity']['summary']['pools']);
        $this->assertSame(self::TOTAL_VALUE, $this->branchRow($resultA)['pool_value_minor'], 'ليس ضعف القيمة');
        $this->assertSame(self::TOTAL_VALUE, $this->branchRow($resultA)['ledger_share_minor']);
        $this->assertNotContains($b['warehouse']->id, array_column($resultA['quantity']['pools'], 'warehouse_id'));
    }

    /** @test */
    public function branch_and_warehouse_scopes_narrow_the_result_and_a_restricted_scope_never_sees_values(): void
    {
        [$w] = $this->postedWorld();
        $other = (string) Str::uuid();

        $this->assertSame([], $this->recon($w, true, null, [$other])['value']['branches'], 'فرع آخر لا يظهر');
        $this->assertCount(1, $this->recon($w, true, null, [$w['branch']->id])['value']['branches']);
        $this->assertSame(0, $this->recon($w, true, [$other])['quantity']['summary']['pools'], 'مخزن آخر لا تُعرض مجمّعاته');
        $this->assertSame(3, $this->recon($w, true, [$w['warehouse']->id])['quantity']['summary']['pools']);

        $restricted = $this->recon($w, true, [$w['warehouse']->id], null, false);
        $this->assertNull($restricted['value']);
        $this->assertNull($restricted['inventory_accounts']);
        $this->assertSame('restricted_warehouse_scope', $restricted['value_scope']);
        $this->assertStringNotContainsString((string) self::TOTAL_VALUE, (string) json_encode($restricted));
    }

    /** @test */
    public function without_the_cost_permission_no_monetary_value_appears_anywhere_in_the_payload(): void
    {
        [$w] = $this->postedWorld();
        DB::table('fuel_inventory_cost_states')->where('tenant_id', $w['tenant_id'])->where('fuel_product_id', $w['fuels']['91']->id)->increment('cost_pool_minor', 777);

        $result = $this->recon($w, false);
        $this->assertNull($result['value']);
        $this->assertSame('hidden_no_cost_permission', $result['value_scope']);
        $json = (string) json_encode($result);
        foreach ([(string) self::TOTAL_VALUE, (string) self::VALUE_91, '777', 'cost_pool_value_minor', 'state_vs_movements_value_minor', 'ledger_share_minor'] as $needle) {
            $this->assertStringNotContainsString($needle, $json, $needle);
        }
        // الكمية تبقى (الأداة مفيدة لمن لا يرى التكلفة).
        $this->assertSame(3, $result['quantity']['summary']['pools']);
    }

    // ───────────────────────── المسار ─────────────────────────

    /** @param list<string> $permissions @return array{user: User, token: string} */
    private function userWith(array $w, array $permissions, ?array $stations = null): array
    {
        app(TenantContext::class)->set($w['tenant_id']);
        $slug = 'recon-role-' . (++$this->seq);
        Role::create(['tenant_id' => $w['tenant_id'], 'slug' => $slug, 'name' => $slug, 'permissions' => $permissions, 'is_system' => false]);
        $user = User::create(['tenant_id' => $w['tenant_id'], 'name' => $slug, 'email' => "{$slug}@recon.test", 'password' => 'password123', 'role' => $slug]);
        if ($stations !== null) {
            $user->forceFill(['fuel_station_scope' => User::FUEL_SCOPE_ASSIGNED])->save();
            $user->fuelStations()->sync($stations);
        }

        return ['user' => $user, 'token' => $user->createToken('api')->plainTextToken];
    }

    private const VIEW = ['fuel_stations.view', 'fuel.tanker.fill.view', 'fuel.tanker.fill.inventory.view'];

    /** @test */
    public function the_endpoint_is_gated_permissioned_cost_gated_and_scope_gated(): void
    {
        [$w] = $this->postedWorld();
        $viewer = $this->userWith($w, self::VIEW);
        $finance = $this->userWith($w, [...self::VIEW, 'products.view_cost']);
        $nobody = $this->userWith($w, ['fuel_stations.view']);

        $this->withToken($nobody['token'])->getJson(self::RECON)->assertForbidden();

        $payload = $this->withToken($viewer['token'])->getJson(self::RECON)->assertOk()->json();
        $this->assertTrue($payload['meta']['read_only']);
        $this->assertFalse($payload['meta']['posting_enabled']);
        $this->assertNull($payload['data']['value']);
        $this->assertSame(3, $payload['data']['quantity']['summary']['pools']);
        $this->assertStringNotContainsString((string) self::TOTAL_VALUE, (string) json_encode($payload));

        $full = $this->withToken($finance['token'])->getJson(self::RECON)->assertOk()->json('data');
        $this->assertSame(self::TOTAL_VALUE, $full['value']['total']['pool_value_minor']);
        $this->assertSame(self::TOTAL_VALUE, $full['value']['total']['ledger_share_minor']);

        // مقيَّد بمحطة (إسناد): الكمية لمحطته فقط ولا قيمة حتى مع صلاحية التكلفة.
        $assigned = $this->userWith($w, [...self::VIEW, 'products.view_cost'], [$w['station']->id]);
        $scoped = $this->withToken($assigned['token'])->getJson(self::RECON)->assertOk()->json('data');
        $this->assertNull($scoped['value']);
        $this->assertSame('restricted_warehouse_scope', $scoped['value_scope']);
        $this->assertSame(3, $scoped['quantity']['summary']['pools']);
        $none = $this->userWith($w, [...self::VIEW, 'products.view_cost'], []);
        $this->assertSame(0, $this->withToken($none['token'])->getJson(self::RECON)->assertOk()->json('data.quantity.summary.pools'));

        // بوابتا النشر: أيٌّ منهما مغلقة ⇒ 404 موحَّد حتى للمالك.
        foreach (['fuel_stations.tanker_fills_enabled', 'fuel_stations.tanker_management_enabled'] as $gate) {
            config([$gate => false]);
            $this->withToken($w['owner_token'])->getJson(self::RECON)->assertNotFound();
            $this->withToken($finance['token'])->getJson(self::RECON)->assertNotFound();
            config([$gate => true]);
        }
    }

    /** @test */
    public function another_tenant_user_sees_only_their_own_pools_through_the_endpoint(): void
    {
        [$a] = $this->postedWorld();
        [$b] = $this->postedWorld();
        $userB = $this->userWith($b, [...self::VIEW, 'products.view_cost']);

        $data = $this->withToken($userB['token'])->getJson(self::RECON)->assertOk()->json('data');
        $this->assertNotContains($a['warehouse']->id, array_column($data['quantity']['pools'], 'warehouse_id'));
        $this->assertSame(self::TOTAL_VALUE, $data['value']['total']['pool_value_minor']);
    }

    // ───────────────────────── لا أثر وحدود ─────────────────────────

    /** @return array<string,mixed> */
    private function fingerprint(array $w): array
    {
        $t = $w['tenant_id'];

        return $this->openingEffects($w) + [
            'journal_lines' => (int) DB::table('journal_lines')->where('tenant_id', $t)->count(),
            'lines_sum' => (int) DB::table('journal_lines')->where('tenant_id', $t)->sum('debit'),
            'states' => DB::table('fuel_inventory_cost_states')->where('tenant_id', $t)->orderBy('id')->get(['id', 'quantity_milliliters', 'cost_pool_minor', 'cost_numerator_minor'])->toArray(),
            'movements_rows' => DB::table('fuel_inventory_cost_movements')->where('tenant_id', $t)->orderBy('id')->get(['id', 'journal_entry_id', 'cost_pool_minor_after'])->toArray(),
            'accounts' => (int) DB::table('accounts')->where('tenant_id', $t)->count(),
            'fills' => (int) DB::table('fuel_tanker_fills')->where('tenant_id', $t)->count(),
            'postings' => (int) DB::table('fuel_tanker_fill_inventory_postings')->where('tenant_id', $t)->count(),
        ];
    }

    /** @test */
    public function reconciling_never_writes_anything_not_even_when_differences_exist(): void
    {
        [$w] = $this->postedWorld();
        DB::table('fuel_inventory_cost_states')->where('tenant_id', $w['tenant_id'])->where('fuel_product_id', $w['fuels']['91']->id)->increment('cost_pool_minor', 777);
        $finance = $this->userWith($w, [...self::VIEW, 'products.view_cost']);
        $before = $this->fingerprint($w);

        for ($i = 0; $i < 3; $i++) {
            $this->recon($w);
            $this->withToken($finance['token'])->getJson(self::RECON)->assertOk();
        }

        $this->assertEquals($before, $this->fingerprint($w), 'لا حركة مخزون ولا قيد ولا تعديل مجمّع/سند ولا حساب جديد');
        $this->assertFalse(Account::query()->where('code', '1145')->exists());
    }

    /** @test */
    public function the_service_and_endpoint_are_read_only_in_source(): void
    {
        $forbidden = ['InventoryService', 'LedgerService', 'FuelCostBasisService', 'InvoiceService', 'PaymentService', 'AccountingDateGuard', 'FuelTankerFillInventoryPosting', 'applyIssue', 'applyReceipt', 'recordIssue', 'recordReceipt', 'lockLedgerAnchor'];
        foreach (['app/Services/FuelInventoryLedgerReconciliation.php', 'app/Http/Controllers/Api/FuelTankerFillInventoryReviewController.php'] as $file) {
            $code = (string) preg_replace('~/\*.*?\*/|//[^\n]*~s', '', (string) file_get_contents(base_path($file)));
            foreach ($forbidden as $needle) {
                $this->assertStringNotContainsString($needle, $code, "{$file} لا يجوز أن يستعمل {$needle}");
            }
            $this->assertDoesNotMatchRegularExpression('/->(create|insert|insertGetId|update|upsert|delete|save|forceFill|increment|decrement|lockForUpdate|sharedLock)\(/', $code, "{$file} قراءة فقط");
            $this->assertDoesNotMatchRegularExpression('/DB::(statement|unprepared|insert|update|delete)\(/', $code, "{$file} لا SQL كتابي");
        }
        $routes = (string) file_get_contents(base_path('routes/api.php'));
        $this->assertSame(1, preg_match_all("~Route::(\w+)\('fuel-stations/tanker-fills/inventory-review/reconciliation'~", $routes, $m));
        $this->assertSame(['get'], $m[1], 'GET وحده');
    }
}
