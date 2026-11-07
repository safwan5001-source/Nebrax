<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\FuelInventoryCostState;
use App\Models\FuelOpeningBalance;
use App\Models\FuelOpeningBalanceLine;
use App\Models\FuelOperationalLedger;
use App\Models\ProductWarehouseStock;
use App\Models\Role;
use App\Models\StockMovement;
use App\Models\User;
use App\Services\FuelCostBasisService;
use App\Services\FuelOpeningBalanceBlockedException;
use App\Services\FuelOpeningBalanceService;
use App\Services\FuelStationSettingsService;
use App\Services\FuelTankBookBalanceReader;
use App\Support\FuelOpeningValuation;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use LogicException;
use PHPUnit\Framework\Attributes\Test;
use RuntimeException;
use Tests\TestCase;

/**
 * FUEL-TANKS-V2 / PR-1 — مستند الرصيد الافتتاحي للوقود: المحاسبة والتقريب والموانع والتزامن المنطقي والعزل.
 *
 * البيانات المرجعية (91: 30,000 لتر · 95: 15,555 · ديزل: 31,000) والتكاليف **وهمية** وللاختبارات وحدها.
 * التزامن الحقيقي على PostgreSQL في `FuelOpeningBalanceConcurrencyPostgresTest`، والـAPI في `FuelOpeningBalanceApiTest`.
 */
class FuelOpeningBalanceTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use BuildsFuelOpeningWorld;

    private function service(): FuelOpeningBalanceService
    {
        return app(FuelOpeningBalanceService::class);
    }

    /** @param array<string,mixed> $w @param array<string,mixed> $overrides */
    private function draft(array $w, array $overrides = []): FuelOpeningBalance
    {
        return $this->service()->createDraft($this->openingPayload($w, $overrides), $w['actor'])['document'];
    }

    /** @param array<string,mixed> $w */
    private function poolQuantity(array $w, string $key): int
    {
        return (int) ProductWarehouseStock::where('warehouse_id', $w['warehouse']->id)->where('product_id', $w['fuels'][$key]->product_id)->sum('quantity');
    }

    /** @return list<array<string,mixed>> */
    private function blockers(FuelOpeningBalanceBlockedException $e): array
    {
        return $e->blockers;
    }

    /** @param array<string,mixed> $w */
    private function assertNoTrace(array $w, array $before, string $message = ''): void
    {
        $this->assertSame($before, $this->openingEffects($w), $message ?: 'لا أثر مخزني ولا محاسبي ولا تكلفة');
    }

    // ───────────────────── 1) المسودة والمعاينة بلا أثر ─────────────────────

    #[Test]
    public function a_draft_and_its_preview_leave_no_stock_ledger_journal_or_cost_trace(): void
    {
        $w = $this->openingWorld();
        $before = $this->openingEffects($w);

        $doc = $this->draft($w);
        $preview = $this->service()->preview($doc);

        $this->assertSame('draft', $doc->status);
        $this->assertStringStartsWith('FOB-', $doc->number);
        $this->assertCount(3, $doc->lines);
        $this->assertTrue($preview['ready'], json_encode($preview['blockers']));
        $this->assertSame(self::TOTAL_VALUE, $preview['total_value_minor']);
        $this->assertSame(76_555_000, $preview['total_milliliters']);
        $this->assertSame(self::VALUE_95, collect($preview['lines'])->firstWhere('fuel_tank_id', $w['tanks']['95']->id)['value_minor']);
        $this->assertSame('inventory_asset', $preview['journal']['debit']['role']);
        $this->assertSame('fuel_opening_balance_account_id', $preview['journal']['credit']['setting']);
        $this->assertSame($w['opening_account']->id, $preview['journal']['credit']['account_id']);
        $this->assertContains('accounting_period_lock', $preview['not_checked']);
        $this->assertNoTrace($w, $before);
    }

    // ───────────────────── 2) الترحيل: المخزون والتكلفة والدفتر والقيد ─────────────────────

    #[Test]
    public function posting_the_reference_balances_creates_stock_cost_basis_ledger_rows_and_one_balanced_entry(): void
    {
        $w = $this->openingWorld();
        $before = $this->openingEffects($w);
        $doc = $this->draft($w);

        $result = $this->service()->post($doc, $w['actor']);
        $posted = $result['document'];

        $this->assertFalse($result['replayed']);
        $this->assertSame('posted', $posted->status);
        $this->assertSame(self::TOTAL_VALUE, (int) $posted->total_value_minor);
        $this->assertNotNull($posted->journal_entry_id);

        // الرصيد الرسمي لكل مجمّع = كمية خزانه.
        $this->assertSame(30_000_000, $this->poolQuantity($w, '91'));
        $this->assertSame(15_555_000, $this->poolQuantity($w, '95'));
        $this->assertSame(31_000_000, $this->poolQuantity($w, 'diesel'));

        // حالة التكلفة مُهيَّأة بصورة صحيحة: مجمّع التكلفة = قيمة السطر، والمعدل بالمللتر يعطي تكلفة إخراج دقيقة.
        foreach (['91' => self::VALUE_91, '95' => self::VALUE_95, 'diesel' => self::VALUE_DIESEL] as $key => $value) {
            $state = FuelInventoryCostState::where('warehouse_id', $w['warehouse']->id)->where('fuel_product_id', $w['fuels'][$key]->id)->sole();
            $this->assertSame($value, (int) $state->cost_pool_minor, $key);
            $this->assertSame($this->poolQuantity($w, $key), (int) $state->quantity_milliliters, $key);
        }
        $quote = app(FuelCostBasisService::class)->quoteIssue($w['fuels']['91'], $w['warehouse'], 1_000);
        $this->assertSame(218, $quote['posted_cost_minor'], 'إخراج لتر واحد بالتكلفة الوهمية 218 هللة');

        // سطر دفتر تشغيلي `opening` لكل خزان بمفتاح حتمي وحركة مخزون مطابقة، وإجمالي الدفتر = الرصيد الرسمي (ثابت P0).
        $rows = FuelOperationalLedger::where('source_type', FuelOpeningBalance::class)->where('source_id', $doc->id)->get();
        $this->assertCount(3, $rows);
        foreach ($w['tanks'] as $key => $tank) {
            $row = $rows->firstWhere('fuel_tank_id', $tank->id);
            $this->assertNotNull($row, $key);
            $this->assertSame(FuelOperationalLedger::TYPE_OPENING, $row->movement_type);
            $this->assertSame("fuel-opening:{$doc->id}:{$tank->id}", $row->idempotency_key);
            $this->assertSame($this->poolQuantity($w, $key), (int) $row->quantity_milliliters);
            $this->assertSame($this->poolQuantity($w, $key), (int) $row->book_balance_milliliters);
            $this->assertNotNull($row->stock_movement_id);
            $this->assertSame($w['branch']->id, $row->branch_id);
        }
        $this->assertSame(76_555_000, (int) $rows->sum('quantity_milliliters'));
        $this->assertSame(76_555_000, (int) DB::table('product_warehouse_stock')->where('warehouse_id', $w['warehouse']->id)->sum('quantity'));
        // كل حركة وقود ⇒ صف دفتر واحد مطابق، والعكس.
        $movements = StockMovement::withoutGlobalScopes()->where('source_type', FuelOpeningBalance::class)->get();
        $this->assertCount(3, $movements);
        foreach ($movements as $movement) {
            $this->assertSame('in', $movement->type);
            $this->assertSame(1, FuelOperationalLedger::where('stock_movement_id', $movement->id)->count());
        }
        // تقييم المخزون = قيمة الحركات = مجمّع التكلفة هللةً بهللة.
        $this->assertSame(self::TOTAL_VALUE, (int) $movements->sum('total_cost'));
        $this->assertSame(self::TOTAL_VALUE, (int) FuelInventoryCostState::where('warehouse_id', $w['warehouse']->id)->sum('cost_pool_minor'));

        // قيد واحد متوازن: مدين دور المخزون / دائن الحساب المعيَّن صراحةً، موسوم بالفرع والمصدر.
        $this->assertSame(1, DB::table('journal_entries')->where('source_type', FuelOpeningBalance::class)->where('source_id', $doc->id)->count());
        $this->assertSame($before['journal_entries'] + 1, $this->openingEffects($w)['journal_entries']);
        $lines = DB::table('journal_lines')->where('journal_entry_id', $posted->journal_entry_id)->get();
        $this->assertCount(2, $lines);
        $this->assertSame(self::TOTAL_VALUE, (int) $lines->sum('debit'));
        $this->assertSame(self::TOTAL_VALUE, (int) $lines->sum('credit'));
        $inventoryAccount = app(\App\Services\Accounting\AccountRoleResolver::class)->resolve('inventory_asset');
        $debit = $lines->firstWhere('debit', '>', 0);
        $credit = $lines->firstWhere('credit', '>', 0);
        $this->assertSame($inventoryAccount->id, $debit->account_id);
        $this->assertSame($w['opening_account']->id, $credit->account_id);
        $this->assertSame($w['branch']->id, $debit->branch_id);
        $this->assertSame($w['branch']->id, $credit->branch_id);

        // لا مورد ولا استلام ولا شراء ولا فاتورة.
        $after = $this->openingEffects($w);
        foreach (['suppliers', 'purchases', 'deliveries', 'invoices'] as $k) {
            $this->assertSame($before[$k], $after[$k], $k);
        }
        foreach ($posted->lines as $line) {
            $this->assertNotNull($line->stock_movement_id);
            $this->assertNotNull($line->fuel_operational_ledger_id);
            $this->assertNotNull($line->value_minor);
        }

        // مؤشر P1 يقرأ الرصيد الدفتري لكل خزان وحيد من الحركات الحقيقية.
        $levels = app(FuelTankBookBalanceReader::class)->forTanks(collect($w['tanks'])->values());
        foreach ($w['tanks'] as $key => $tank) {
            $this->assertSame($this->poolQuantity($w, $key), $levels[$tank->id]['book_level']['milliliters'], $key);
        }
    }

    #[Test]
    public function cost_movements_record_a_receipt_linked_to_the_entry_without_any_delivery(): void
    {
        $w = $this->openingWorld();
        $posted = $this->service()->post($this->draft($w), $w['actor'])['document'];

        $costMovements = DB::table('fuel_inventory_cost_movements')->where('tenant_id', $w['tenant_id'])->get();
        $this->assertCount(3, $costMovements);
        foreach ($costMovements as $m) {
            $this->assertSame('receipt', $m->movement_type);
            $this->assertSame($posted->journal_entry_id, $m->journal_entry_id);
            $this->assertNull($m->fuel_delivery_id, 'لا استلام ولا مورد');
            $this->assertSame(0, (int) $m->quantity_milliliters_before);
        }
    }

    // ───────────────────── 3) التقريب (D2) ─────────────────────

    #[Test]
    public function the_value_is_rounded_half_up_once_per_product_and_split_across_tanks_without_drift(): void
    {
        $w = $this->openingWorld();
        // خزانان لمنتج 91 مع كسور: 0.333 + 0.334 لتر بتكلفة 1 هللة/لتر.
        $second = \App\Models\FuelTank::create([
            'branch_id' => $w['branch']->id, 'fuel_station_id' => $w['station']->id, 'fuel_product_id' => $w['fuels']['91']->id,
            'code' => 'T2-' . $w['slug'], 'name' => 'خزان 91 ثانٍ', 'capacity_milliliters' => 34_000_000, 'safe_capacity_milliliters' => 33_000_000,
        ]);
        $payload = $this->openingPayload($w, [
            'lines' => [
                ['fuel_tank_id' => $w['tanks']['91']->id, 'quantity_liters' => '1234.567'],
                ['fuel_tank_id' => $second->id, 'quantity_liters' => '0.001'],
            ],
            'costs' => [['fuel_product_id' => $w['fuels']['91']->id, 'unit_cost_per_liter_minor' => 231]],
        ]);
        $doc = $this->service()->createDraft($payload, $w['actor'])['document'];

        $posted = $this->service()->post($doc, $w['actor'])['document'];

        // (1,234,567 + 1) mL × 231 ÷ 1000 = 285,185.208 ⇒ 285,185. السطر الأول R(1,234,567×231÷1000 = 285,184.977) = 285,185 والثاني الفرق = 0.
        $this->assertSame(FuelOpeningValuation::value(1_234_568, 231), (int) $posted->total_value_minor);
        $this->assertSame(285_185, (int) $posted->total_value_minor);
        $this->assertSame((int) $posted->total_value_minor, (int) $posted->lines->sum('value_minor'), 'مجموع السطور = قيمة المنتج بلا انحراف');
        $this->assertSame(285_185, (int) $posted->lines->firstWhere('position', 1)->value_minor);
        $this->assertSame(0, (int) $posted->lines->firstWhere('position', 2)->value_minor);
        $entry = DB::table('journal_lines')->where('journal_entry_id', $posted->journal_entry_id)->get();
        $this->assertSame(285_185, (int) $entry->sum('debit'));
        $this->assertSame(285_185, (int) StockMovement::withoutGlobalScopes()->where('source_id', $doc->id)->sum('total_cost'));
    }

    #[Test]
    public function valuation_matches_exact_decimal_half_up_arithmetic_and_splits_sum_exactly(): void
    {
        mt_srand(20261107);
        for ($i = 0; $i < 400; $i++) {
            $cost = mt_rand(0, 100_000);
            $parts = array_map(fn () => mt_rand(1, 50_000_000), range(1, mt_rand(1, 6)));
            $total = array_sum($parts);

            // مرجع مستقل: bcmath بنصف لأعلى (+0.5 ثم قصّ).
            $exact = bcdiv(bcadd(bcmul((string) $total, (string) $cost, 0), '500', 0), '1000', 0);
            $this->assertSame((int) $exact, FuelOpeningValuation::value($total, $cost), "m={$total} c={$cost}");
            $split = FuelOpeningValuation::split($parts, $cost);
            $this->assertSame(FuelOpeningValuation::value($total, $cost), array_sum($split), 'مجموع التوزيع = قيمة المنتج');
            foreach ($split as $v) {
                $this->assertGreaterThanOrEqual(0, $v);
            }
        }
        // حدود النصف بالضبط.
        $this->assertSame(3, FuelOpeningValuation::value(500, 5), '2.5 ⇒ 3 (نصف لأعلى)');
        $this->assertSame(2, FuelOpeningValuation::value(499, 5), '2.495 ⇒ 2');
        $this->assertSame(0, FuelOpeningValuation::value(1, 499), '0.499 ⇒ 0');
        $this->assertSame(1, FuelOpeningValuation::value(1, 500), '0.5 ⇒ 1');
        $this->assertSame(0, FuelOpeningValuation::value(1_000_000, 0));
    }

    #[Test]
    public function valuation_rejects_overflow_instead_of_degrading_to_float(): void
    {
        $this->expectException(RuntimeException::class);
        FuelOpeningValuation::value(PHP_INT_MAX / 4, 1_000_000);
    }

    // ───────────────────── 4) لا يُرحَّل مرتين ─────────────────────

    #[Test]
    public function reposting_a_posted_document_is_a_replay_with_no_second_effect(): void
    {
        $w = $this->openingWorld();
        $doc = $this->draft($w);
        $first = $this->service()->post($doc, $w['actor']);
        $afterFirst = $this->openingEffects($w);

        $stale = FuelOpeningBalance::findOrFail($doc->id);
        $second = $this->service()->post($stale, $w['actor']);

        $this->assertTrue($second['replayed']);
        $this->assertSame($first['document']->journal_entry_id, $second['document']->journal_entry_id);
        $this->assertSame($afterFirst, $this->openingEffects($w), 'لا حركة ولا قيد ولا صف دفتر ثانٍ');
        $this->assertSame(3, FuelOperationalLedger::where('source_id', $doc->id)->count());
    }

    #[Test]
    public function a_second_document_for_a_pool_already_opened_is_blocked_with_no_trace(): void
    {
        $w = $this->openingWorld();
        $this->service()->post($this->draft($w), $w['actor']);
        $after = $this->openingEffects($w);

        $other = $this->draft($w);
        $e = $this->caught(fn () => $this->service()->post($other, $w['actor']));

        $this->assertInstanceOf(FuelOpeningBalanceBlockedException::class, $e);
        $codes = array_column($this->blockers($e), 'code');
        $this->assertContains('FUEL_OPENING_POOL_NOT_EMPTY', $codes);
        $this->assertSame($after, $this->openingEffects($w));
        $this->assertSame('draft', $other->fresh()->status);
    }

    #[Test]
    public function the_ledger_idempotency_key_is_a_hard_second_line_of_defence_against_double_posting(): void
    {
        $w = $this->openingWorld();
        $doc = $this->draft($w);
        $this->service()->post($doc, $w['actor']);
        $row = FuelOperationalLedger::where('source_id', $doc->id)->first();

        $this->expectException(\Illuminate\Database\UniqueConstraintViolationException::class);
        FuelOperationalLedger::create([
            'branch_id' => $row->branch_id, 'fuel_station_id' => $row->fuel_station_id, 'fuel_tank_id' => $row->fuel_tank_id,
            'fuel_product_id' => $row->fuel_product_id, 'warehouse_id' => $row->warehouse_id, 'movement_type' => 'opening',
            'quantity_milliliters' => 1, 'book_balance_milliliters' => 1, 'idempotency_key' => $row->idempotency_key, 'occurred_at' => now(),
        ]);
    }

    // ───────────────────── 5) الموانع (فشل مغلق بلا أثر) ─────────────────────

    #[Test]
    public function a_pool_with_existing_stock_is_blocked(): void
    {
        $w = $this->openingWorld();
        ProductWarehouseStock::create(['product_id' => $w['fuels']['95']->product_id, 'warehouse_id' => $w['warehouse']->id, 'quantity' => 1]);
        $before = $this->openingEffects($w);
        $doc = $this->draft($w);

        $preview = $this->service()->preview($doc);
        $this->assertFalse($preview['ready']);
        $this->assertContains('FUEL_OPENING_POOL_NOT_EMPTY', array_column($preview['blockers'], 'code'));
        $this->assertSame($w['fuels']['95']->id, collect($preview['blockers'])->firstWhere('code', 'FUEL_OPENING_POOL_NOT_EMPTY')['fuel_product_id']);

        $e = $this->caught(fn () => $this->service()->post($doc, $w['actor']));
        $this->assertInstanceOf(FuelOpeningBalanceBlockedException::class, $e);
        $this->assertSame($before, $this->openingEffects($w), 'لا أثر جزئي حتى للمنتجين السليمين');
    }

    #[Test]
    public function a_pool_with_prior_history_even_at_zero_stock_is_blocked(): void
    {
        $w = $this->openingWorld();
        // تاريخ: صف دفتر تشغيلي سابق (رصيد صفري الآن).
        FuelOperationalLedger::create([
            'branch_id' => $w['branch']->id, 'fuel_station_id' => $w['station']->id, 'fuel_tank_id' => $w['tanks']['diesel']->id,
            'fuel_product_id' => $w['fuels']['diesel']->id, 'warehouse_id' => $w['warehouse']->id, 'movement_type' => 'delivery',
            'quantity_milliliters' => 0, 'book_balance_milliliters' => 0, 'idempotency_key' => 'legacy-' . $w['slug'], 'occurred_at' => now()->subDay(),
        ]);
        $before = $this->openingEffects($w);
        $doc = $this->draft($w);

        $e = $this->caught(fn () => $this->service()->post($doc, $w['actor']));

        $this->assertInstanceOf(FuelOpeningBalanceBlockedException::class, $e);
        $this->assertContains('FUEL_OPENING_POOL_HAS_HISTORY', array_column($this->blockers($e), 'code'));
        $this->assertSame($before, $this->openingEffects($w));
    }

    #[Test]
    public function a_prior_stock_movement_blocks_even_without_any_balance(): void
    {
        $w = $this->openingWorld();
        StockMovement::create([
            'product_id' => $w['fuels']['91']->product_id, 'warehouse_id' => $w['warehouse']->id, 'branch_id' => $w['branch']->id,
            'type' => 'in', 'quantity' => 5, 'unit_cost' => 0, 'total_cost' => 0, 'balance_quantity' => 0, 'movement_date' => now()->toDateString(),
        ]);
        $doc = $this->draft($w);

        $e = $this->caught(fn () => $this->service()->post($doc, $w['actor']));

        $this->assertInstanceOf(FuelOpeningBalanceBlockedException::class, $e);
        $this->assertContains('FUEL_OPENING_POOL_HAS_HISTORY', array_column($this->blockers($e), 'code'));
    }

    #[Test]
    public function the_counter_account_has_no_fallback_the_owner_must_designate_it_explicitly(): void
    {
        $w = $this->openingWorld(configureAccount: false);
        $this->assertNotNull($w['opening_account'], 'الحساب 3130 موجود في الدليل لكنه لا يُستعمل افتراضياً');
        $before = $this->openingEffects($w);
        $doc = $this->draft($w);

        $preview = $this->service()->preview($doc);
        $this->assertFalse($preview['ready']);
        $this->assertContains('FUEL_OPENING_ACCOUNT_REQUIRED', array_column($preview['blockers'], 'code'));
        $this->assertNull($preview['journal']);

        $e = $this->caught(fn () => $this->service()->post($doc, $w['actor']));
        $this->assertInstanceOf(FuelOpeningBalanceBlockedException::class, $e);
        $this->assertSame($before, $this->openingEffects($w));
    }

    #[Test]
    public function the_counter_account_setting_accepts_only_an_active_postable_equity_account(): void
    {
        $w = $this->openingWorld(configureAccount: false);
        $settings = app(FuelStationSettingsService::class);
        $expense = Account::where('tenant_id', $w['tenant_id'])->where('type', 'expense')->where('is_group', false)->first();
        $this->assertNotNull($expense);

        $this->assertInstanceOf(RuntimeException::class, $this->caught(fn () => $settings->putTenant(['fuel_opening_balance_account_id' => $expense->id], $w['actor'], 'اختبار')));
        $this->assertInstanceOf(RuntimeException::class, $this->caught(fn () => $settings->putTenant(['fuel_opening_balance_account_id' => '00000000-0000-4000-8000-000000000000'], $w['actor'], 'اختبار')));
        $settings->putTenant(['fuel_opening_balance_account_id' => $w['opening_account']->id], $w['actor'], 'تعيين صريح');
        $this->assertSame($w['opening_account']->id, $settings->openingBalanceAccountFor($w['station'])->id);
    }

    #[Test]
    public function a_station_override_of_the_counter_account_takes_precedence_over_the_tenant_default(): void
    {
        $w = $this->openingWorld();
        $other = Account::create(['tenant_id' => $w['tenant_id'], 'code' => '3199', 'name' => 'رأس مال آخر', 'type' => 'equity', 'normal_balance' => 'credit', 'is_group' => false, 'is_active' => true]);
        app(FuelStationSettingsService::class)->putStationValues($w['station'], ['fuel_opening_balance_account_id' => $other->id], $w['actor'], 'تخصيص المحطة');

        $posted = $this->service()->post($this->draft($w), $w['actor'])['document'];

        $credit = DB::table('journal_lines')->where('journal_entry_id', $posted->journal_entry_id)->where('credit', '>', 0)->sole();
        $this->assertSame($other->id, $credit->account_id);
    }

    #[Test]
    public function cost_must_be_recorded_and_zero_cost_needs_an_explicit_per_document_approval(): void
    {
        $w = $this->openingWorld();
        $before = $this->openingEffects($w);

        // بلا تكاليف: مسودة مقبولة، المعاينة تمنع، الترحيل يرفض.
        $noCost = $this->service()->createDraft($this->openingPayload($w, ['costs' => null]), $w['actor'])['document'];
        $this->assertContains('FUEL_OPENING_COST_MISSING', array_column($this->service()->preview($noCost)['blockers'], 'code'));
        $this->assertInstanceOf(FuelOpeningBalanceBlockedException::class, $this->caught(fn () => $this->service()->post($noCost, $w['actor'])));

        // صفر بلا موافقة.
        $zero = $this->draft($w, ['costs' => [['fuel_product_id' => $w['fuels']['91']->id, 'unit_cost_per_liter_minor' => 0]] + $this->openingPayload($w)['costs']]);
        $e = $this->caught(fn () => $this->service()->post($zero, $w['actor']));
        $this->assertInstanceOf(FuelOpeningBalanceBlockedException::class, $e);
        $this->assertContains('FUEL_OPENING_ZERO_COST_NOT_ALLOWED', array_column($this->blockers($e), 'code'));
        $this->assertSame($before, $this->openingEffects($w));
    }

    #[Test]
    public function an_all_zero_cost_document_with_approval_moves_quantities_but_posts_no_entry(): void
    {
        $w = $this->openingWorld();
        $doc = $this->draft($w, [
            'allow_zero_cost' => true,
            'costs' => array_map(fn ($k) => ['fuel_product_id' => $w['fuels'][$k]->id, 'unit_cost_per_liter_minor' => 0], ['91', '95', 'diesel']),
        ]);
        $before = $this->openingEffects($w);

        $posted = $this->service()->post($doc, $w['actor'])['document'];

        $this->assertNull($posted->journal_entry_id);
        $this->assertSame(0, (int) $posted->total_value_minor);
        $this->assertSame($before['journal_entries'], $this->openingEffects($w)['journal_entries']);
        $this->assertSame(76_555_000, $this->openingEffects($w)['stock']);
        $this->assertSame(3, FuelOperationalLedger::where('source_id', $doc->id)->count());
    }

    #[Test]
    public function tank_conditions_are_rechecked_live_at_posting(): void
    {
        $w = $this->openingWorld();
        $doc = $this->draft($w);
        $w['tanks']['95']->update(['status' => 'inactive']);
        $before = $this->openingEffects($w);

        $e = $this->caught(fn () => $this->service()->post($doc, $w['actor']));
        $this->assertContains('FUEL_OPENING_TANK_INACTIVE', array_column($this->blockers($e), 'code'));
        $this->assertSame($before, $this->openingEffects($w));

        $w['tanks']['95']->update(['status' => 'active']);
        $w['tanks']['91']->update(['capacity_milliliters' => 20_000_000, 'safe_capacity_milliliters' => 19_000_000]);
        $e = $this->caught(fn () => $this->service()->post($doc, $w['actor']));
        $this->assertContains('FUEL_OPENING_EXCEEDS_CAPACITY', array_column($this->blockers($e), 'code'));

        $w['tanks']['91']->update(['capacity_milliliters' => 34_000_000, 'safe_capacity_milliliters' => 29_000_000]);
        $preview = $this->service()->preview($doc);
        $this->assertTrue($preview['ready'], json_encode($preview['blockers']));
        $this->assertContains('FUEL_OPENING_ABOVE_SAFE_CAPACITY', array_column($preview['warnings'], 'code'), 'فوق السعة الآمنة تحذير لا مانع');
    }

    #[Test]
    public function an_inactive_station_or_a_changed_warehouse_blocks_posting(): void
    {
        $w = $this->openingWorld();
        $doc = $this->draft($w);
        $other = \App\Models\Warehouse::create(['name' => 'مخزن بديل', 'code' => 'ALT-' . $w['slug'], 'branch_id' => $w['branch']->id]);
        $w['station']->update(['warehouse_id' => $other->id]);

        $e = $this->caught(fn () => $this->service()->post($doc, $w['actor']));
        $this->assertContains('FUEL_OPENING_STATION_CHANGED', array_column($this->blockers($e), 'code'));

        $w['station']->update(['warehouse_id' => $w['warehouse']->id, 'status' => 'inactive']);
        $this->assertInstanceOf(RuntimeException::class, $this->caught(fn () => $this->draft($w)), 'محطة غير نشطة لا تقبل مسودة');
    }

    // ───────────────────── 6) التحقق من المدخلات ─────────────────────

    #[Test]
    public function draft_input_is_validated_strictly(): void
    {
        $w = $this->openingWorld();
        $bad = [
            'future date' => ['opening_date' => now()->addDays(3)->toDateString()],
            'bad date' => ['opening_date' => '2026-13-45'],
            'no lines' => ['lines' => []],
            'zero qty' => ['lines' => [['fuel_tank_id' => $w['tanks']['91']->id, 'quantity_liters' => '0']]],
            'four decimals' => ['lines' => [['fuel_tank_id' => $w['tanks']['91']->id, 'quantity_liters' => '1.0001']]],
            'float qty' => ['lines' => [['fuel_tank_id' => $w['tanks']['91']->id, 'quantity_liters' => 1.5]]],
            'duplicate tank' => ['lines' => [['fuel_tank_id' => $w['tanks']['91']->id, 'quantity_liters' => '1'], ['fuel_tank_id' => $w['tanks']['91']->id, 'quantity_liters' => '2']]],
            'unknown tank' => ['lines' => [['fuel_tank_id' => '00000000-0000-4000-8000-000000000000', 'quantity_liters' => '1']]],
            'negative cost' => ['costs' => [['fuel_product_id' => $w['fuels']['91']->id, 'unit_cost_per_liter_minor' => -1]]],
            'float cost' => ['costs' => [['fuel_product_id' => $w['fuels']['91']->id, 'unit_cost_per_liter_minor' => 2.18]]],
            'cost for product not in lines' => ['lines' => [['fuel_tank_id' => $w['tanks']['91']->id, 'quantity_liters' => '1']], 'costs' => [['fuel_product_id' => $w['fuels']['95']->id, 'unit_cost_per_liter_minor' => 1]]],
            'duplicate cost' => ['costs' => [['fuel_product_id' => $w['fuels']['91']->id, 'unit_cost_per_liter_minor' => 1], ['fuel_product_id' => $w['fuels']['91']->id, 'unit_cost_per_liter_minor' => 2]]],
        ];
        foreach ($bad as $name => $override) {
            $e = $this->caught(fn () => $this->service()->createDraft($this->openingPayload($w, $override), $w['actor']));
            $this->assertInstanceOf(RuntimeException::class, $e, $name);
        }
        $this->assertSame(0, FuelOpeningBalance::count(), 'لا مسودة ناقصة تُحفظ');
    }

    #[Test]
    public function a_tank_of_another_station_cannot_be_used(): void
    {
        $w = $this->openingWorld();
        $station2 = \App\Models\FuelStation::create(['branch_id' => $w['branch']->id, 'warehouse_id' => $w['warehouse']->id, 'code' => 'S2-' . $w['slug'], 'name' => 'محطة أخرى']);
        $foreign = \App\Models\FuelTank::create([
            'branch_id' => $w['branch']->id, 'fuel_station_id' => $station2->id, 'fuel_product_id' => $w['fuels']['91']->id,
            'code' => 'TF-' . $w['slug'], 'name' => 'خزان محطة أخرى', 'capacity_milliliters' => 1_000_000, 'safe_capacity_milliliters' => 900_000,
        ]);

        $e = $this->caught(fn () => $this->draft($w, ['lines' => [['fuel_tank_id' => $foreign->id, 'quantity_liters' => '10']]]));

        $this->assertInstanceOf(RuntimeException::class, $e);
        $this->assertStringContainsString('FUEL_OPENING_TANK_INVALID', $e->getMessage());
    }

    // ───────────────────── 7) idempotency المسودة ─────────────────────

    #[Test]
    public function the_same_idempotency_key_and_payload_replays_the_first_draft_and_a_different_payload_conflicts(): void
    {
        $w = $this->openingWorld();
        $payload = $this->openingPayload($w);
        $first = $this->service()->createDraft($payload, $w['actor']);
        $again = $this->service()->createDraft($payload, $w['actor']);

        $this->assertFalse($first['replayed']);
        $this->assertTrue($again['replayed']);
        $this->assertSame($first['document']->id, $again['document']->id);
        $this->assertSame(1, FuelOpeningBalance::count());

        $changed = $payload;
        $changed['lines'][0]['quantity_liters'] = '29999';
        $e = $this->caught(fn () => $this->service()->createDraft($changed, $w['actor']));
        $this->assertStringContainsString('FUEL_OPENING_IDEMPOTENCY_CONFLICT', $e->getMessage());

        $missingKey = $payload;
        unset($missingKey['idempotency_key']);
        $this->assertStringContainsString('FUEL_OPENING_IDEMPOTENCY_REQUIRED', $this->caught(fn () => $this->service()->createDraft($missingKey, $w['actor']))->getMessage());
    }

    #[Test]
    public function updating_a_draft_replaces_lines_and_keeps_costs_when_costs_are_omitted(): void
    {
        $w = $this->openingWorld();
        $doc = $this->draft($w);

        $updated = $this->service()->updateDraft($doc, [
            'opening_date' => $doc->opening_date->toDateString(),
            'lines' => [['fuel_tank_id' => $w['tanks']['91']->id, 'quantity_liters' => '1000']],
        ], $w['actor']);

        $this->assertCount(1, $updated->lines);
        $this->assertSame(1_000_000, (int) $updated->lines->first()->quantity_milliliters);
        $this->assertSame(self::FAKE_COST_91, (int) $updated->lines->first()->unit_cost_per_liter_minor, 'التكلفة القائمة حُفظت');
        $this->assertSame(1_000_000, (int) $updated->total_milliliters);
    }

    // ───────────────────── 8) الصلاحيات وفصل المعتمِد ─────────────────────

    #[Test]
    public function posting_needs_governance_and_cost_authority_and_costs_need_cost_authority(): void
    {
        $w = $this->openingWorld();
        $doc = $this->draft($w);
        $mkUser = function (string $slug, array $permissions) use ($w): User {
            Role::create(['tenant_id' => $w['tenant_id'], 'slug' => $slug, 'name' => $slug, 'permissions' => $permissions, 'is_system' => false]);

            return User::create(['tenant_id' => $w['tenant_id'], 'name' => $slug, 'email' => "{$slug}@fob.test", 'password' => 'password123', 'role' => $slug]);
        };
        $noGovernance = $mkUser('fob-manager', ['fuel_stations.view', 'fuel_stations.manage', 'products.view_cost']);
        $noCost = $mkUser('fob-governor', ['fuel_stations.view', 'fuel.governance.manage']);
        $before = $this->openingEffects($w);

        $this->assertInstanceOf(AuthorizationException::class, $this->caught(fn () => $this->service()->post($doc, $noGovernance)));
        $this->assertInstanceOf(AuthorizationException::class, $this->caught(fn () => $this->service()->post($doc, $noCost)));
        $this->assertSame($before, $this->openingEffects($w));

        // موظف المحطة بلا سلطة التكلفة ينشئ مسودة بلا تكاليف فقط.
        $clerk = $mkUser('fob-clerk', ['fuel_stations.view']);
        $this->assertInstanceOf(AuthorizationException::class, $this->caught(fn () => $this->service()->createDraft($this->openingPayload($w), $clerk)));
        $ok = $this->service()->createDraft($this->openingPayload($w, ['costs' => null]), $clerk)['document'];
        $this->assertSame($clerk->id, $ok->created_by);
        $this->assertNull($ok->lines->first()->unit_cost_per_liter_minor);
    }

    #[Test]
    public function the_distinct_approver_policy_blocks_the_creator_from_posting_their_own_document(): void
    {
        $w = $this->openingWorld();
        app(FuelStationSettingsService::class)->putStationValues($w['station'], ['fuel_distinct_approver_required' => true], $w['actor'], 'فصل المعتمِد');
        $doc = $this->draft($w);
        $before = $this->openingEffects($w);

        $e = $this->caught(fn () => $this->service()->post($doc, $w['actor']));
        $this->assertInstanceOf(RuntimeException::class, $e);
        $this->assertStringContainsString('FUEL_DISTINCT_APPROVER_REQUIRED', $e->getMessage());
        $this->assertSame($before, $this->openingEffects($w));

        $admin = User::create(['tenant_id' => $w['tenant_id'], 'name' => 'مدير', 'email' => 'adm-' . $w['slug'] . '@fob.test', 'password' => 'password123', 'role' => 'admin']);
        $this->assertSame('posted', $this->service()->post($doc, $admin)['document']->status);
    }

    // ───────────────────── 9) الثبات والتدقيق ─────────────────────

    #[Test]
    public function a_posted_document_and_its_lines_are_immutable_and_audited(): void
    {
        $w = $this->openingWorld();
        $doc = $this->draft($w);
        $posted = $this->service()->post($doc, $w['actor'])['document'];

        $this->assertInstanceOf(LogicException::class, $this->caught(fn () => $posted->update(['notes' => 'تعديل'])));
        $this->assertInstanceOf(LogicException::class, $this->caught(fn () => $posted->delete()));
        $this->assertInstanceOf(LogicException::class, $this->caught(fn () => FuelOpeningBalanceLine::findOrFail($posted->lines->first()->id)->update(['quantity_milliliters' => 1])));
        $this->assertInstanceOf(LogicException::class, $this->caught(fn () => FuelOpeningBalanceLine::findOrFail($posted->lines->first()->id)->delete()));
        $this->assertInstanceOf(RuntimeException::class, $this->caught(fn () => $this->service()->deleteDraft($posted, $w['actor'])));
        $this->assertInstanceOf(RuntimeException::class, $this->caught(fn () => $this->service()->updateDraft($posted, ['opening_date' => $posted->opening_date->toDateString(), 'lines' => [['fuel_tank_id' => $w['tanks']['91']->id, 'quantity_liters' => '1']]], $w['actor'])));

        $actions = DB::table('fuel_station_audit_events')->where('tenant_id', $w['tenant_id'])->where('subject_id', $doc->id)->orderBy('occurred_at')->pluck('action')->all();
        $this->assertSame(['opening_balance.created', 'opening_balance.posted'], $actions);
        $event = DB::table('fuel_station_audit_events')->where('subject_id', $doc->id)->where('action', 'opening_balance.posted')->first();
        $this->assertSame($w['actor']->id, $event->actor_id);
        $this->assertSame($w['station']->id, $event->fuel_station_id);
    }

    #[Test]
    public function a_draft_can_be_deleted_with_an_audit_event_and_leaves_no_effect(): void
    {
        $w = $this->openingWorld();
        $before = $this->openingEffects($w);
        $doc = $this->draft($w);

        $this->service()->deleteDraft($doc, $w['actor']);

        $this->assertSame(0, FuelOpeningBalance::count());
        $this->assertSame(0, FuelOpeningBalanceLine::count());
        $this->assertSame($before, $this->openingEffects($w));
        $this->assertTrue(DB::table('fuel_station_audit_events')->where('subject_id', $doc->id)->where('action', 'opening_balance.deleted')->exists());
    }

    // ───────────────────── 10) الإغلاق بالبوابة والعزل ─────────────────────

    #[Test]
    public function the_service_refuses_everything_while_the_deployment_gate_is_closed(): void
    {
        $w = $this->openingWorld();
        config(['fuel_stations.opening_balance_enabled' => false]);

        $this->assertStringContainsString('FUEL_OPENING_DISABLED', $this->caught(fn () => $this->service()->createDraft($this->openingPayload($w), $w['actor']))->getMessage());
        $this->assertFalse(FuelOpeningBalanceService::enabled());
        $this->assertFalse((bool) config('fuel_stations.opening_balance_enabled'));
    }

    #[Test]
    public function the_gate_is_closed_by_default_in_configuration(): void
    {
        $config = require base_path('config/fuel_stations.php');
        $this->assertArrayHasKey('opening_balance_enabled', $config);
        $previous = getenv('FUEL_OPENING_BALANCE_ENABLED');
        putenv('FUEL_OPENING_BALANCE_ENABLED');
        unset($_ENV['FUEL_OPENING_BALANCE_ENABLED'], $_SERVER['FUEL_OPENING_BALANCE_ENABLED']);
        $this->assertFalse((require base_path('config/fuel_stations.php'))['opening_balance_enabled']);
        if ($previous !== false) {
            putenv("FUEL_OPENING_BALANCE_ENABLED={$previous}");
        }
    }

    #[Test]
    public function another_tenants_documents_tanks_and_stations_are_invisible_and_unusable(): void
    {
        $a = $this->openingWorld();
        $docA = $this->draft($a);
        $b = $this->openingWorld();

        // سياق المستأجر ب لا يرى مستند أ ولا يستعمل خزانها ولا محطتها.
        app(\App\Tenancy\TenantContext::class)->set($b['tenant_id']);
        app(\App\Tenancy\BranchContext::class)->set($b['branch']->id);
        $this->assertNull(FuelOpeningBalance::find($docA->id));
        $this->assertInstanceOf(RuntimeException::class, $this->caught(fn () => $this->service()->createDraft($this->openingPayload($a), $b['actor'])));
        $this->assertInstanceOf(\Illuminate\Database\Eloquent\ModelNotFoundException::class, $this->caught(fn () => $this->service()->post($docA, $b['actor'])));
        $this->assertSame(0, FuelOpeningBalance::count());
    }

    #[Test]
    public function opening_then_a_normal_issue_keeps_pool_ledger_and_cost_basis_consistent(): void
    {
        $w = $this->openingWorld();
        $this->service()->post($this->draft($w), $w['actor']);
        $pool = $w['fuels']['91'];

        $cost = app(FuelCostBasisService::class);
        $quote = $cost->quoteIssue($pool, $w['warehouse'], 10_000);
        $this->assertSame(2_180, $quote['posted_cost_minor'], '10 لترات × 218 هللة');

        // تهيئة التكلفة تسمح بزيادة جرد لاحقة (لا FUEL_COST_BASELINE_REQUIRED) — أي أن الحالة مدقَّقة لا خام.
        $this->assertSame(30_000_000, (int) FuelInventoryCostState::where('fuel_product_id', $pool->id)->value('quantity_milliliters'));
        $gain = $cost->quoteGain($pool, $w['warehouse'], 1_000);
        $this->assertSame(218, $gain['posted_cost_minor']);
    }
}
