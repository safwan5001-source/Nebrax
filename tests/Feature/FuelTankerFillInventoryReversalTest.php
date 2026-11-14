<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\AccountingPeriodLock;
use App\Models\FiscalYear;
use App\Models\FuelOperationalLedger;
use App\Models\FuelStationSettingOverride;
use App\Models\FuelTankerFill;
use App\Models\JournalEntry;
use App\Models\User;
use App\Services\FuelCostBasisService;
use App\Services\FuelTankerFillInventoryReversalService as ReversalService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * TANKER-PR6B-4 — العكس المخزني والمحاسبي بالتكلفة التاريخية (SQLite وPostgreSQL).
 *
 * عالم الاختبار: انظر `BuildsTankerPostingWorld`. سند 3,000 لتر يُرحَّل بقيد مدين الوسيط 654,000 / دائن المخزون 654,000؛ والعكس يجب أن يقيّد **مدين المخزون 654,000 / دائن الوسيط 654,000** مهما تغيّر المتوسط أو الإعدادات.
 */
class FuelTankerFillInventoryReversalTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use BuildsFuelOpeningWorld;
    use BuildsTankerPostingWorld;

    private const REVERSER = ['fuel_stations.view', 'fuel.tanker.fill.view', 'fuel.tanker.fill.inventory.view', 'fuel.tanker.fill.inventory.reverse'];

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootPostingWorld();
    }

    private function postedFill(int $ml = 3_000_000): FuelTankerFill
    {
        $fill = $this->fill($ml);
        $this->postFill($fill)->assertCreated();

        return $fill->fresh();
    }

    // ───────────────────────── المسار السعيد والتكلفة التاريخية ─────────────────────────

    /** @test */
    public function reversal_restores_stock_and_pool_and_posts_an_independent_reversal_entry_at_historical_cost(): void
    {
        $fill = $this->postedFill();
        $this->assertSame(27_000_000, $this->stock91());
        $this->assertSame(5_886_000, (int) $this->pool91()['cost_pool_minor']);
        $originalEntry = JournalEntry::query()->where('source_type', FuelTankerFill::class)->where('source_id', $fill->id)->where('status', 'posted')->sole();

        $this->reverseFill($fill, null, ['reason' => 'سند أُدخل بالخطأ'])->assertCreated()
            ->assertJsonPath('meta.replayed', false)->assertJsonPath('meta.posting.status', 'reversed')
            ->assertJsonPath('meta.posting.posted_cost_minor', 654_000)->assertJsonPath('meta.posting.reversal_reason', 'سند أُدخل بالخطأ');

        // المخزون والمجمّع عادا بالضبط إلى ما قبل الترحيل (الكمية والقيمة).
        $this->assertSame(30_000_000, $this->stock91());
        $pool = $this->pool91();
        $this->assertSame(30_000_000, (int) $pool['quantity_milliliters']);
        $this->assertSame(6_540_000, (int) $pool['cost_pool_minor']);
        $this->assertSame('reversed', $fill->fresh()->inventory_status);

        // القيد العكسي مستقل: مدين المخزون / دائن الوسيط بالتكلفة التاريخية نفسها، متوازن، مربوط بالأصل وبالسند.
        $this->assertSame('reversed', $originalEntry->fresh()->status, 'الأصل يبقى سجلاً: حالته فقط عبر المحرك');
        $reversal = JournalEntry::query()->where('reversal_of', $originalEntry->id)->sole();
        $this->assertNotSame($originalEntry->id, $reversal->id);
        $this->assertSame('posted', $reversal->status);
        $this->assertSame(FuelTankerFill::class, $reversal->source_type);
        $this->assertSame($fill->id, $reversal->source_id);
        $lines = DB::table('journal_lines')->where('journal_entry_id', $reversal->id)->orderBy('debit', 'desc')->get();
        $inventory = Account::query()->where('code', '1140')->firstOrFail();
        $this->assertSame($inventory->id, $lines[0]->account_id);
        $this->assertSame(654_000, (int) $lines[0]->debit);
        $this->assertSame($this->clearing->id, $lines[1]->account_id);
        $this->assertSame(654_000, (int) $lines[1]->credit);
        $this->assertSame(array_sum(array_column($lines->all(), 'debit')), array_sum(array_column($lines->all(), 'credit')));
        $this->assertSame([$this->w['station']->branch_id], array_values(array_unique(array_column($lines->all(), 'branch_id'))));
        // أثر الأستاذ الصافي على الوسيط والمخزون صفر (الأصل + العكس).
        $net = fn (string $id) => (int) DB::table('journal_lines')->where('account_id', $id)->whereIn('journal_entry_id', [$originalEntry->id, $reversal->id])->selectRaw('SUM(debit) - SUM(credit) as n')->value('n');
        $this->assertSame(0, $net($this->clearing->id));
        $this->assertSame(0, $net($inventory->id));

        // الروابط: صف الترحيل (محفوظ بلا حذف) + حركتا العكس + الدفتر التشغيلي + المحاولة.
        $posting = (array) DB::table('fuel_tanker_fill_inventory_postings')->where('fuel_tanker_fill_id', $fill->id)->sole();
        $this->assertSame('reversed', $posting['status']);
        $this->assertSame(654_000, (int) $posting['posted_cost_minor'], 'سجل العملية الأصلية لا يُعدَّل');
        $stock = (array) DB::table('stock_movements')->where('id', $posting['reversal_stock_movement_id'])->sole();
        $this->assertSame('in', $stock['type']);
        $this->assertSame(3_000_000, (int) $stock['quantity']);
        $this->assertSame(654_000, (int) $stock['total_cost']);
        $this->assertNotSame($posting['stock_movement_id'], $stock['id']);
        $cost = (array) DB::table('fuel_inventory_cost_movements')->where('id', $posting['reversal_cost_movement_id'])->sole();
        $this->assertSame('issue_reversal', $cost['movement_type']);
        $this->assertSame($reversal->id, $cost['journal_entry_id']);
        $this->assertSame($stock['id'], $cost['stock_movement_id']);
        $this->assertSame(654_000, (int) $cost['posted_cost_minor']);
        $this->assertSame(3_000_000, (int) $cost['quantity_milliliters']);
        $this->assertSame('tanker-fill-reverse:' . $fill->id, DB::table('fuel_tanker_fill_inventory_posting_attempts')->where('operation_type', 'reverse')->where('fuel_tanker_fill_id', $fill->id)->value('idempotency_key'));
        $ledger = FuelOperationalLedger::query()->where('source_id', $fill->id)->where('movement_type', 'tanker_fill_reversal')->sole();
        $this->assertSame(3_000_000, (int) $ledger->quantity_milliliters);
        $this->assertSame(654_000, (int) $ledger->value_minor);
        $this->assertSame(30_000_000, (int) $ledger->book_balance_milliliters);
        $this->assertSame($stock['id'], $ledger->stock_movement_id);
        $this->assertSame(['post/succeeded:', 'reverse/succeeded:'], $this->attemptOutcomes($fill));
        $this->assertSame(1, DB::table('fuel_station_audit_events')->where('action', 'tanker_fill.inventory_reversed')->where('subject_id', $fill->id)->count());
        $this->assertSame([], $this->reconcileErrors(), 'المجمّع والأستاذ متطابقان بعد العكس');
        $this->assertSame(0, $this->reconcile()['value']['total']['difference_minor']);

        // لا إيراد/ضريبة/فاتورة/دفعة/COGS ولا قيود إضافية: قيدان فقط للسند (الأصل والعكس).
        $this->assertSame(2, JournalEntry::query()->where('source_type', FuelTankerFill::class)->where('source_id', $fill->id)->count());
        $this->assertSame(0, DB::table('invoices')->where('tenant_id', $this->w['tenant_id'])->count());
        $this->assertSame(0, DB::table('payments')->where('tenant_id', $this->w['tenant_id'])->count());
    }

    /** @test */
    public function the_reversal_uses_the_historical_cost_when_the_average_changes_between_posting_and_reversal(): void
    {
        $fill = $this->postedFill();
        $poolAfterPost = (int) $this->pool91()['cost_pool_minor'];
        $this->assertSame(5_886_000, $poolAfterPost);

        // توريد 10,000 لتر بـ230 هللة/لتر (2,300,000) يرفع المتوسط من 218 إلى ≈ 221.8.
        $this->receiveAt(10_000_000, 2_300_000);
        $this->assertSame(37_000_000, $this->stock91());
        $this->assertSame(8_186_000, (int) $this->pool91()['cost_pool_minor']);

        $this->reverseFill($fill)->assertCreated();

        // لو سُعِّر العكس بمتوسط اليوم لصار ≈ 665,400؛ المعتمد: 654,000 تماماً، فتعود قيمة المجمّع الكلية = 8,186,000 + 654,000.
        $pool = $this->pool91();
        $this->assertSame(40_000_000, (int) $pool['quantity_milliliters']);
        $this->assertSame(8_840_000, (int) $pool['cost_pool_minor']);
        $this->assertSame(40_000_000, $this->stock91());
        $reversal = JournalEntry::query()->where('source_id', $fill->id)->whereNotNull('reversal_of')->sole();
        $this->assertSame(654_000, (int) DB::table('journal_lines')->where('journal_entry_id', $reversal->id)->sum('debit'));
        // قيمة المجمّع الكلية = قيمة ما قبل الصرف + التوريد (لا ربح/خسارة مصطنعة) ويطابق الأستاذ.
        $this->assertSame(6_540_000 + 2_300_000, (int) $pool['cost_pool_minor']);
        $this->assertSame([], $this->reconcileErrors());
        $this->assertSame(0, $this->reconcile()['value']['total']['difference_minor']);
    }

    /** @test */
    public function the_carried_fractional_remainder_is_untouched_and_the_pool_value_is_exact_across_sequences(): void
    {
        // سندان بكسور غير صحيحة (1,234.567 ل ثم 100.001 ل) ثم عكس الأول: المجمّع = ما قبل الأول + بقاء الباقي المحمول للثاني.
        $first = $this->postedFill(1_234_567);
        $carryAfterFirst = (array) $this->pool91();
        $second = $this->postedFill(100_001);
        $before = (int) $this->pool91()['cost_pool_minor'];
        $firstCost = (int) DB::table('fuel_tanker_fill_inventory_postings')->where('fuel_tanker_fill_id', $first->id)->value('posted_cost_minor');

        $this->reverseFill($first)->assertCreated();
        $pool = $this->pool91();
        $this->assertSame($before + $firstCost, (int) $pool['cost_pool_minor']);
        $this->assertSame(30_000_000 - 100_001, (int) $pool['quantity_milliliters']);
        // الباقي الكسري المحمول لا يُمسّ بالعكس: كما تركه الصرف الثاني.
        $secondCarry = DB::table('fuel_inventory_cost_movements')->where('id', DB::table('fuel_tanker_fill_inventory_postings')->where('fuel_tanker_fill_id', $second->id)->value('cost_movement_id'))->first();
        $this->assertSame((string) $secondCarry->carry_remainder_numerator_after, (string) $pool['carry_remainder_numerator']);
        $this->assertSame((string) $secondCarry->carry_remainder_denominator_after, (string) $pool['carry_remainder_denominator']);
        $this->assertNotNull($carryAfterFirst);

        $this->reverseFill($second)->assertCreated();
        $pool = $this->pool91();
        $this->assertSame(30_000_000, (int) $pool['quantity_milliliters']);
        $this->assertSame(6_540_000, (int) $pool['cost_pool_minor'], 'بعد عكس الاثنين تعود القيمة الكلية بالضبط');
        $this->assertSame([], $this->reconcileErrors());
    }

    /** @test */
    public function a_seeded_random_sequence_of_receipts_postings_and_reversals_keeps_pool_stock_and_ledger_in_step(): void
    {
        // اختبار خاصية مُبذَّر: أي تسلسل من توريد/ترحيل/عكس يُبقي (كمية المجمّع = الرصيد الرسمي) و(قيمة المجمّع = حصة الأستاذ) و(لا أخطاء مطابقة) بعد كل خطوة،
        // وكل سند مرحَّل يُعكس يعيد إلى المجمّع **تكلفته التاريخية المثبَّتة** لا متوسط اليوم.
        mt_srand(20261114);
        $posted = [];
        for ($step = 1; $step <= 30; $step++) {
            $op = mt_rand(1, 10);
            if ($op <= 2) {
                $ml = mt_rand(1, 40) * 100_000 + mt_rand(0, 999);
                $this->receiveAt($ml, intdiv($ml * mt_rand(2000, 2600), 10_000) + mt_rand(0, 9));
            } elseif ($op <= 6 || $posted === []) {
                $ml = mt_rand(1, 30) * 100_000 + mt_rand(0, 999);
                if ($this->stock91() >= $ml) {
                    $fill = $this->fill($ml);
                    $this->postFill($fill)->assertCreated();
                    $posted[] = [$fill, (int) DB::table('fuel_tanker_fill_inventory_postings')->where('fuel_tanker_fill_id', $fill->id)->value('posted_cost_minor')];
                }
            } else {
                [$fill, $cost] = array_splice($posted, mt_rand(0, count($posted) - 1), 1)[0];
                $before = (int) $this->pool91()['cost_pool_minor'];
                $this->reverseFill($fill)->assertCreated();
                $this->assertSame($before + $cost, (int) $this->pool91()['cost_pool_minor'], "الخطوة {$step}: العكس بالتكلفة التاريخية");
            }
            $this->assertSame($this->stock91(), (int) $this->pool91()['quantity_milliliters'], "الخطوة {$step}: كمية المجمّع = الرصيد");
            $this->assertSame([], $this->reconcileErrors(), "الخطوة {$step}: المطابقة");
            $this->assertSame(0, $this->reconcile()['value']['total']['difference_minor'], "الخطوة {$step}: قيمة المجمّع = الأستاذ");
        }
        $this->assertNotEmpty(DB::table('fuel_tanker_fill_inventory_postings')->where('status', 'reversed')->get());
    }

    // ───────────────────────── المنع والتكرار ─────────────────────────

    /** @test */
    public function reversal_is_idempotent_and_never_duplicates_any_effect(): void
    {
        $fill = $this->postedFill();
        $this->reverseFill($fill)->assertCreated();
        $after = $this->state();

        $again = $this->reverseFill($fill, null, ['reason' => 'سبب آخر مختلف'])->assertOk();
        $again->assertJsonPath('meta.replayed', true)->assertJsonPath('meta.posting.status', 'reversed')->assertJsonPath('meta.posting.reversal_reason', 'سند أُدخل بالخطأ');
        $this->assertSame($after, $this->state(), 'لا أثر ثانٍ');
        $this->assertSame(30_000_000, $this->stock91());
        $this->assertSame(['post/succeeded:', 'reverse/succeeded:'], $this->attemptOutcomes($fill));
    }

    /** @test */
    public function reversal_requires_a_valid_original_posting_a_reason_and_no_client_values(): void
    {
        $pending = $this->fill();
        $before = $this->state();
        // سند لم يُرحَّل: لا عكس.
        $this->reverseFill($pending)->assertStatus(409)->assertJsonPath('reason', 'fill_not_posted');
        $this->assertSame($before, $this->state());
        $this->assertSame(['reverse/rejected:fill_not_posted'], $this->attemptOutcomes($pending));

        $fill = $this->postedFill();
        $before = $this->state();
        $this->reverseFill($fill, null, [])->assertStatus(422);
        $this->reverseFill($fill, null, ['reason' => '  '])->assertStatus(422);
        $this->reverseFill($fill, null, ['reason' => 'ab'])->assertStatus(422);
        // لا كمية ولا تكلفة ولا حساب ولا تاريخ من العميل.
        foreach (['quantity_milliliters' => 5, 'posted_cost_minor' => 1, 'account_id' => $this->clearing->id, 'entry_date' => '2020-01-01', 'unit_cost' => 9] as $key => $value) {
            $this->reverseFill($fill, null, ['reason' => 'سبب كافٍ', $key => $value])->assertStatus(422);
        }
        $this->assertSame($before, $this->state());
        $this->assertSame('posted', $fill->fresh()->inventory_status);
    }

    /** @test */
    public function every_closed_gate_blocks_the_endpoint_and_the_service_with_no_effect(): void
    {
        $fill = $this->postedFill();
        $before = $this->state();
        foreach (['tanker_management_enabled', 'tanker_fills_enabled', 'tanker_inventory_posting_enabled'] as $gate) {
            config(["fuel_stations.{$gate}" => false]);
            $this->reverseFill($fill)->assertNotFound();
            $this->withToken($this->w['owner_token'])->getJson(self::FILLS . "/{$fill->id}/inventory-reversal/preview")->assertNotFound();
            $this->assertFalse(ReversalService::enabled());
            $exception = $this->caught(fn () => app(ReversalService::class)->reverse($fill, $this->w['actor'], ['reason' => 'سبب كافٍ']));
            $this->assertSame(404, $exception->status);
            config(["fuel_stations.{$gate}" => true]);
        }
        $this->assertSame($before, $this->state());
        $this->assertSame([], array_filter($this->attemptOutcomes($fill), fn ($o) => str_starts_with($o, 'reverse/')), 'البوابة المغلقة ليست محاولة عكس');
    }

    // ───────────────────────── الصلاحيات والنطاق ─────────────────────────

    /** @test */
    public function permissions_are_exact_and_pin_sessions_and_other_scopes_cannot_reverse(): void
    {
        $fill = $this->postedFill();
        $before = $this->state();

        // ترحيل فقط/عرض فقط/تاريخي فقط لا تكفي؛ ولا `fuel_stations.manage` ولا الصلاحية الحوكمية.
        foreach ([['fuel.tanker.fill.inventory.post'], ['fuel.tanker.fill.inventory.view'], ['fuel.tanker.fill.inventory.post_historical'], ['fuel_stations.manage', 'fuel.governance.manage', 'fuel.tanker.fill.view']] as $permissions) {
            $this->reverseFill($fill, $this->userWith([...$permissions, 'fuel_stations.view'])['token'])->assertForbidden();
        }
        // جلسة PIN (قدرة station-ops) لا تصل المسار مهما كانت الصلاحيات.
        $pin = User::query()->whereKey($this->w['actor']->id)->firstOrFail()->createToken('station', ['station-ops'])->plainTextToken;
        $this->reverseFill($fill, $pin)->assertForbidden();
        $this->withToken($pin)->getJson(self::FILLS . "/{$fill->id}/inventory-reversal/preview")->assertForbidden();
        $this->assertSame($before, $this->state());

        // نطاق محطة آخر ⇒ 404 موحَّد (لا كشف)؛ ومستأجر آخر كذلك.
        $otherStation = \App\Models\FuelStation::create(['branch_id' => $this->w['station']->branch_id, 'warehouse_id' => $this->w['warehouse']->id, 'code' => 'RV-OTHER', 'name' => 'محطة أخرى']);
        $this->reverseFill($fill, $this->userWith(self::REVERSER, [$otherStation->id])['token'])->assertNotFound();
        $foreign = $this->openingWorld();
        $this->reverseFill($fill, $foreign['owner_token'])->assertNotFound();
        $this->assertSame($before, $this->state());

        // المخوَّل بالعكس فقط (بلا تكلفة/حسابات) ينجح، والاستجابة بلا أرقام مالية.
        $reverser = $this->userWith(self::REVERSER);
        $response = $this->reverseFill($fill, $reverser['token'])->assertCreated();
        $posting = $response->json('meta.posting');
        $this->assertSame('reversed', $posting['status']);
        foreach (['posted_cost_minor', 'journal_entry_id', 'cost_movement_id', 'reversal_journal_entry_id', 'reversal_cost_movement_id'] as $hidden) {
            $this->assertArrayNotHasKey($hidden, $posting);
        }
    }

    /** @test */
    public function the_reversal_preview_is_read_only_and_hides_account_ids_and_amounts_independently(): void
    {
        $fill = $this->postedFill();
        $before = $this->state();
        $url = self::FILLS . "/{$fill->id}/inventory-reversal/preview";

        $full = $this->withToken($this->w['owner_token'])->getJson($url)->assertOk()->json('data');
        $this->assertSame('reversible', $full['status']);
        $this->assertSame('historical_cost', $full['valuation']);
        $this->assertSame(654_000, $full['entry']['amount_minor']);
        // الجانب المدين بعد العكس = حساب المخزون (كان دائناً) والدائن = الوسيط التاريخي (بصرف النظر عن ترتيب السطور).
        $bySide = collect($full['entry']['lines'])->pluck('account_id', 'side');
        $this->assertSame(Account::query()->where('code', '1140')->value('id'), $bySide['debit']);
        $this->assertSame($this->clearing->id, $bySide['credit']);

        $base = ['fuel_stations.view', 'fuel.tanker.fill.view', 'fuel.tanker.fill.inventory.view'];
        $low = $this->withToken($this->userWith($base)['token'])->getJson($url)->assertOk()->json('data');
        $this->assertNull($low['entry']['amount_minor']);
        $this->assertSame([null, null], array_column($low['entry']['lines'], 'account_id'));
        $this->assertStringNotContainsString($this->clearing->id, json_encode($low));
        $cost = $this->withToken($this->userWith([...$base, 'products.view_cost'])['token'])->getJson($url)->assertOk()->json('data');
        $this->assertSame(654_000, $cost['entry']['amount_minor']);
        $this->assertSame([null, null], array_column($cost['entry']['lines'], 'account_id'));
        $accounts = $this->withToken($this->userWith([...$base, 'accounts.view'])['token'])->getJson($url)->assertOk()->json('data');
        $this->assertNull($accounts['entry']['amount_minor']);
        $this->assertContains($this->clearing->id, array_column($accounts['entry']['lines'], 'account_id'));
        $this->withToken($this->userWith(['fuel_stations.view'])['token'])->getJson($url)->assertForbidden();
        $this->assertSame($before, $this->state(), 'المعاينة قراءة فقط');

        // بعد العكس: الحالة «غير قابل» والمانع «سبق عكسه».
        $this->reverseFill($fill)->assertCreated();
        $after = $this->withToken($this->w['owner_token'])->getJson($url)->assertOk()->json('data');
        $this->assertSame('not_applicable', $after['status']);
        $this->assertContains('already_reversed', $after['blockers']);
        $pending = $this->fill();
        $this->assertContains('not_posted', $this->withToken($this->w['owner_token'])->getJson(self::FILLS . "/{$pending->id}/inventory-reversal/preview")->json('data.blockers'));
    }

    // ───────────────────────── الفترات والإعدادات المتغيّرة ─────────────────────────

    /** @test */
    public function a_locked_period_or_closed_fiscal_year_at_the_reversal_date_rejects_the_whole_reversal(): void
    {
        $fill = $this->postedFill();
        $before = $this->state();

        $lock = AccountingPeriodLock::create(['start_date' => now()->subDays(2)->toDateString(), 'end_date' => now()->addDays(2)->toDateString(), 'status' => 'active', 'locked_by' => $this->w['actor']->id, 'reason' => 'إقفال اختبار']);
        $this->assertContains('period_locked', $this->withToken($this->w['owner_token'])->getJson(self::FILLS . "/{$fill->id}/inventory-reversal/preview")->json('data.blockers'));
        $this->reverseFill($fill)->assertStatus(422)->assertJsonPath('reason', 'period_locked');
        $this->assertSame($before, $this->state());
        $this->assertSame(['post/succeeded:', 'reverse/rejected:period_locked'], $this->attemptOutcomes($fill));
        $lock->forceFill(['status' => 'released'])->save();

        $year = FiscalYear::create(['name' => 'سنة اختبار', 'start_date' => now()->startOfYear()->toDateString(), 'end_date' => now()->endOfYear()->toDateString(), 'status' => FiscalYear::STATUS_CLOSED]);
        $this->reverseFill($fill)->assertStatus(422);
        $this->assertSame($before, $this->state());
        $year->forceFill(['status' => FiscalYear::STATUS_OPEN])->save();

        // بعد فتح الفترة ينجح العكس.
        $this->reverseFill($fill)->assertCreated();
        $this->assertSame(30_000_000, $this->stock91());
    }

    /** @test */
    public function the_original_period_may_be_locked_the_reversal_posts_in_the_open_period(): void
    {
        $fill = $this->postedFill();
        // قيد الترحيل الأصلي بتاريخ اليوم؛ تُقفل فترة ماضية فقط (لا تغطي اليوم) فلا تمنع العكس ولا تُعاد كتابة الأصل.
        AccountingPeriodLock::create(['start_date' => now()->subYear()->toDateString(), 'end_date' => now()->subMonth()->toDateString(), 'status' => 'active', 'locked_by' => $this->w['actor']->id, 'reason' => 'ماضٍ']);
        $this->reverseFill($fill)->assertCreated();
        $this->assertSame(30_000_000, $this->stock91());
    }

    /** @test */
    public function changing_the_clearing_or_inventory_account_after_posting_does_not_change_the_reversal_accounts(): void
    {
        $fill = $this->postedFill();
        $originalInventory = Account::query()->where('code', '1140')->firstOrFail();
        // تغيير الحساب الوسيط المعتمد + تعطيل القديم + تجاوز حساب مخزون المحطة إلى حساب آخر.
        $newClearing = Account::create(['code' => '1146', 'name' => 'وسيط جديد', 'type' => 'asset', 'normal_balance' => 'debit', 'is_group' => false, 'is_active' => true]);
        $otherInventory = Account::create(['code' => '1141', 'name' => 'مخزون وقود آخر', 'type' => 'asset', 'normal_balance' => 'debit', 'is_group' => false, 'is_active' => true]);
        $this->configure(['tanker_issue_clearing_account_id' => $newClearing->id]);
        $this->w['station']->forceFill(['default_inventory_account_id' => $otherInventory->id])->save();
        $this->clearing->forceFill(['is_active' => false])->save();

        $this->reverseFill($fill)->assertCreated();

        $original = JournalEntry::query()->where('source_id', $fill->id)->whereNull('reversal_of')->sole();
        $reversal = JournalEntry::query()->where('reversal_of', $original->id)->sole();
        $lines = DB::table('journal_lines')->where('journal_entry_id', $reversal->id)->orderBy('debit', 'desc')->get();
        $this->assertSame($originalInventory->id, $lines[0]->account_id, 'حساب المخزون التاريخي لا الحالي');
        $this->assertSame($this->clearing->id, $lines[1]->account_id, 'الحساب الوسيط التاريخي لا المعيَّن حالياً');
        $this->assertSame(0, (int) DB::table('journal_lines')->whereIn('account_id', [$newClearing->id, $otherInventory->id])->count());
        $this->assertSame(30_000_000, $this->stock91());
    }

    /** @test */
    public function post_on_close_stations_cannot_reverse_to_avoid_a_double_adjustment(): void
    {
        $fill = $this->postedFill();
        FuelStationSettingOverride::updateOrCreate(['fuel_station_id' => $this->w['station']->id, 'setting_key' => 'shift_settlement_mode'], ['value' => 'post_on_close']);
        $before = $this->state();
        $this->assertContains('settlement_mode_conflict', $this->withToken($this->w['owner_token'])->getJson(self::FILLS . "/{$fill->id}/inventory-reversal/preview")->json('data.blockers'));
        $this->reverseFill($fill)->assertStatus(422)->assertJsonPath('reason', 'reversal_blocked');
        $this->assertSame($before, $this->state());
    }

    /** @test */
    public function a_downstream_link_on_the_posting_prevents_reversal_when_such_columns_exist(): void
    {
        $fill = $this->postedFill();
        // أعمدة الفوترة تُبنى في PR-9؛ الحارس يفحصها إن وُجدت (هنا عمود اختباري يحاكيها داخل المعاملة المتراجعة).
        Schema::table('fuel_tanker_fill_inventory_postings', fn ($t) => $t->string('invoiced_invoice_id', 36)->nullable());
        DB::table('fuel_tanker_fill_inventory_postings')->where('fuel_tanker_fill_id', $fill->id)->update(['invoiced_invoice_id' => (string) \Illuminate\Support\Str::uuid()]);
        $before = $this->state();
        $this->assertContains('downstream_link:invoiced_invoice_id', $this->withToken($this->w['owner_token'])->getJson(self::FILLS . "/{$fill->id}/inventory-reversal/preview")->json('data.blockers'));
        $this->reverseFill($fill)->assertStatus(422)->assertJsonPath('reason', 'reversal_blocked');
        $this->assertSame($before, $this->state());
        $this->assertSame('posted', $fill->fresh()->inventory_status);
    }

    // ───────────────────────── الذرّية ─────────────────────────

    /** @test */
    public function any_failure_after_partial_writes_rolls_back_the_entire_reversal(): void
    {
        $fill = $this->postedFill();
        $station = $this->w['station'];
        // يفشل الدفتر التشغيلي (آخر الخطوات الكتابية بعد المخزون والقيد والتكلفة والترحيل) بتعارض مفتاح idempotency.
        FuelOperationalLedger::create([
            'branch_id' => $station->branch_id, 'fuel_station_id' => $station->id, 'fuel_tank_id' => $this->w['tanks']['91']->id, 'fuel_product_id' => $this->w['fuels']['91']->id,
            'warehouse_id' => $this->w['warehouse']->id, 'movement_type' => 'opening', 'quantity_milliliters' => 0, 'book_balance_milliliters' => 0,
            'idempotency_key' => 'tanker-fill-reverse:' . $fill->id . ':ledger', 'occurred_at' => now(),
        ]);
        $before = $this->state();

        $this->assertGreaterThanOrEqual(422, $this->reverseFill($fill)->getStatusCode());
        $this->assertSame($before, $this->state(), 'لا إعادة مخزون ولا قيد عكسي ولا حركة ولا تحويل حالة');
        $this->assertSame(27_000_000, $this->stock91());
        $this->assertSame(5_886_000, (int) $this->pool91()['cost_pool_minor']);
        $this->assertSame('posted', $fill->fresh()->inventory_status);
        $this->assertSame('posted', JournalEntry::query()->where('source_id', $fill->id)->whereNull('reversal_of')->sole()->status);
        $this->assertSame(['post/succeeded:', 'reverse/failed:posting_failed'], $this->attemptOutcomes($fill));

        DB::table('fuel_operational_ledgers')->where('idempotency_key', 'tanker-fill-reverse:' . $fill->id . ':ledger')->delete();
        $this->reverseFill($fill)->assertCreated();
        $this->assertSame(30_000_000, $this->stock91());
    }

    /** @test */
    public function a_reversed_fill_can_be_voided_but_never_reposted(): void
    {
        $fill = $this->postedFill();
        $this->reverseFill($fill)->assertCreated();
        // لا إعادة ترحيل (التصحيح بسند جديد): الترحيل يعيد الأول بحالته المعكوسة بلا أثر.
        $before = $this->state();
        $this->postFill($fill)->assertOk()->assertJsonPath('meta.replayed', true);
        $this->assertSame($before, $this->state());
        // بعد العكس يُسمح بالإلغاء (المخزون عاد).
        $this->withToken($this->w['owner_token'])->postJson(self::FILLS . "/{$fill->id}/void", ['reason' => 'إلغاء بعد العكس'])->assertOk();
        $this->assertSame('voided', $fill->fresh()->status);
        // والعكس بعد الإلغاء متكرر (idempotent) لا يضيف أثراً.
        $this->reverseFill($fill)->assertOk()->assertJsonPath('meta.replayed', true);
    }

    // ───────────────────────── حراسة ساكنة ─────────────────────────

    /** @test */
    public function only_the_reversal_service_writes_the_reversal_state_and_the_cost_primitive_has_one_caller(): void
    {
        $callers = [];
        $writers = [];
        foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(app_path(), \FilesystemIterator::SKIP_DOTS)) as $file) {
            if ($file->getExtension() !== 'php') {
                continue;
            }
            $code = (string) file_get_contents($file->getPathname());
            $name = $file->getFilename();
            if (str_contains($code, 'recordIssueReversal(') && $name !== 'FuelCostBasisService.php') {
                $callers[] = $name;
            }
            if (str_contains($code, "'reversal_stock_movement_id' =>") || str_contains($code, "'status' => 'reversed'")) {
                $writers[] = $name;
            }
        }
        $this->assertSame(['FuelTankerFillInventoryReversalService.php'], $callers);
        $this->assertSame(['FuelTankerFillInventoryReversalService.php'], array_values(array_intersect($writers, ['FuelTankerFillInventoryReversalService.php', 'FuelTankerFillInventoryPostingService.php', 'FuelTankerFillService.php'])));

        $source = (string) file_get_contents(app_path('Services/FuelTankerFillInventoryReversalService.php'));
        $code = (string) preg_replace('~/\*.*?\*/|//[^\n]*~s', '', $source);
        foreach (['InvoiceService', 'PaymentService', 'recordGain', 'recordIssue(', 'applyIssue', "'5110'", "'4110'", "'2120'", "'1130'", 'cogs', 'quoteIssue', 'avg_cost'] as $needle) {
            $this->assertStringNotContainsString($needle, $code, "خدمة العكس لا تستعمل {$needle}");
        }
        $this->assertTrue(method_exists(FuelCostBasisService::class, 'recordIssueReversal'));
        $this->assertNotNull(app(TenantContext::class));
    }
}
