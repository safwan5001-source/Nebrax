<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\FuelTankerFill;
use App\Models\JournalEntry;
use App\Services\Reporting\ReportService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * TANKER-PR6B-4/5/6 — سيناريو End-to-End على بيانات اختبارية فقط (SQLite وPostgreSQL): تسجيل سند 12,000 لتر ← معاينة التكلفة والقيد ← ترحيل ← خصم المخزون مرة واحدة ← المجمّع ← قيد متوازن ←
 * دفتر الأستاذ وميزان المراجعة ← تغيّر متوسط التكلفة بتوريد بين الترحيل والعكس ← عكس بالتكلفة التاريخية ← عودة الكمية والقيمة ← قيد عكسي مستقل ← اتساق تقارير المطابقة والرقابة.
 * الأرقام: بنزين 91 = 30,000 لتر بتكلفة 218 هللة/لتر (6,540,000 هللة)؛ سند 12,000 لتر = 2,616,000 هللة.
 */
class FuelTankerFillInventoryEndToEndTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use BuildsFuelOpeningWorld;
    use BuildsTankerPostingWorld;

    private const COST = 2_616_000;
    private const REPORTS = '/api/fuel-stations/tanker-fill-reports/';

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootPostingWorld();
    }

    private function net(string $code): int
    {
        app(TenantContext::class)->set($this->w['tenant_id']);
        $row = collect(app(ReportService::class)->trialBalance()['rows'])->firstWhere('code', $code);

        return $row === null ? 0 : (int) $row['debit'] - (int) $row['credit'];
    }

    /** @return array<string,mixed> */
    private function ledger(string $accountId): array
    {
        app(TenantContext::class)->set($this->w['tenant_id']);

        return app(ReportService::class)->accountLedger($accountId);
    }

    /** @test */
    public function the_full_cycle_with_an_average_cost_change_between_posting_and_reversal(): void
    {
        $inventory = Account::query()->where('code', '1140')->firstOrFail();
        $inventoryBefore = $this->net('1140');
        $this->assertSame(0, $this->net('1145'));

        // ① تسجيل سند 12,000 لتر.
        $fill = $this->fill(12_000_000);
        $this->assertSame('pending_integration', $fill->inventory_status);

        // ② معاينة التكلفة والقيد (قراءة فقط).
        $before = $this->state();
        $preview = $this->withToken($this->w['owner_token'])->getJson(self::FILLS . "/{$fill->id}/inventory-posting/preview")->assertOk()->json('data');
        $this->assertSame('postable', $preview['status']);
        $this->assertSame(self::COST, $preview['entry']['amount_minor']);
        $this->assertSame($before, $this->state());

        // ③ الترحيل ④ خصم المخزون مرة واحدة (والتكرار لا يخصم ثانية) ⑤ مجمّع التكلفة.
        $this->postFill($fill)->assertCreated()->assertJsonPath('meta.posting.posted_cost_minor', self::COST);
        $this->assertSame(18_000_000, $this->stock91());
        $this->postFill($fill)->assertOk()->assertJsonPath('meta.replayed', true);
        $this->assertSame(18_000_000, $this->stock91(), 'خصم مرة واحدة');
        $pool = $this->pool91();
        $this->assertSame(18_000_000, (int) $pool['quantity_milliliters']);
        $this->assertSame(6_540_000 - self::COST, (int) $pool['cost_pool_minor']);

        // ⑥ قيد متوازن (مدين الوسيط / دائن المخزون) ⑦ ظهوره في دفتر الأستاذ ⑧ وفي ميزان المراجعة.
        $entry = JournalEntry::query()->where('source_type', FuelTankerFill::class)->where('source_id', $fill->id)->sole();
        $lines = DB::table('journal_lines')->where('journal_entry_id', $entry->id)->get();
        $this->assertSame(self::COST, (int) $lines->sum('debit'));
        $this->assertSame(self::COST, (int) $lines->sum('credit'));
        $clearingLedger = $this->ledger($this->clearing->id);
        $this->assertSame([['number' => $entry->number, 'debit' => self::COST, 'credit' => 0]], collect($clearingLedger['rows'])->map(fn ($r) => collect($r)->only(['number', 'debit', 'credit'])->all())->all());
        $this->assertSame(self::COST, $clearingLedger['closing_balance']);
        $this->assertSame(self::COST, $this->net('1145'));
        $this->assertSame($inventoryBefore - self::COST, $this->net('1140'));
        $this->assertTrue(app(ReportService::class)->trialBalance()['balanced']);
        // واجهة التقرير العامة تعرض القيد أيضاً (بالريال).
        $api = $this->withToken($this->w['owner_token'])->getJson('/api/reports/trial-balance')->assertOk()->json();
        $this->assertTrue($api['balanced']);
        $this->assertContains('1145', array_column($api['rows'], 'code'));

        // تقارير ما قبل العكس متّسقة.
        $this->assertSame(0, $this->withToken($this->w['owner_token'])->getJson(self::REPORTS . 'accounting-control')->json('data.summary.confirmed_differences'));

        // ⑨ توريد يغيّر متوسط المجمّع (10,000 لتر بـ230) بين الترحيل والعكس، ثم العكس بالتكلفة التاريخية.
        $this->receiveAt(10_000_000, 2_300_000);
        $poolMid = $this->pool91();
        $this->assertSame(28_000_000, (int) $poolMid['quantity_milliliters']);
        $this->assertSame(3_924_000 + 2_300_000, (int) $poolMid['cost_pool_minor']);
        $this->reverseFill($fill, null, ['reason' => 'تعبئة سُجلت على فوهة خاطئة'])->assertCreated()->assertJsonPath('meta.posting.status', 'reversed');

        // ⑩ عودة الكمية والقيمة التاريخية المرتبطة بالعكس: 28,000 + 12,000 لتر؛ القيمة = ما قبل العكس + 2,616,000 (لا متوسط اليوم).
        $this->assertSame(40_000_000, $this->stock91());
        $poolAfter = $this->pool91();
        $this->assertSame(40_000_000, (int) $poolAfter['quantity_milliliters']);
        $this->assertSame(3_924_000 + 2_300_000 + self::COST, (int) $poolAfter['cost_pool_minor']);
        $this->assertSame(6_540_000 + 2_300_000, (int) $poolAfter['cost_pool_minor'], 'قيمة المجمّع = الافتتاحي + التوريد (لا ربح/خسارة مصطنعة)');

        // ⑪ قيد عكسي مستقل: مدين المخزون / دائن الوسيط، مرتبط بالأصل، والأصل `reversed`.
        $reversal = JournalEntry::query()->where('reversal_of', $entry->id)->sole();
        $this->assertNotSame($entry->id, $reversal->id);
        $this->assertSame('reversed', $entry->fresh()->status);
        $revLines = DB::table('journal_lines')->where('journal_entry_id', $reversal->id)->get()->keyBy('account_id');
        $this->assertSame(self::COST, (int) $revLines[$inventory->id]->debit);
        $this->assertSame(self::COST, (int) $revLines[$this->clearing->id]->credit);
        $this->assertSame(0, $this->net('1145'), 'الوسيط يعود إلى الصفر');
        $this->assertSame($inventoryBefore + 2_300_000, $this->net('1140'), 'مخزون الأستاذ = الافتتاحي + التوريد (الصرف والعكس يصافران)');
        $this->assertSame(2, count($this->ledger($this->clearing->id)['rows']));
        $this->assertSame(0, $this->ledger($this->clearing->id)['closing_balance']);
        $this->assertTrue(app(ReportService::class)->trialBalance()['balanced']);

        // ⑫ اتساق تقارير المطابقة والرقابة والحساب الوسيط بعد العكس.
        $recon = $this->withToken($this->w['owner_token'])->getJson(self::REPORTS . 'inventory-reconciliation')->assertOk()->json('data');
        $this->assertSame(['matched' => 1, 'confirmed_differences' => 0, 'warnings' => 0], collect($recon['summary'])->only(['matched', 'confirmed_differences', 'warnings'])->all());
        $this->assertSame(0, $recon['pool']['value']['total']['difference_minor']);
        $this->assertSame([], $this->reconcileErrors());
        $control = $this->withToken($this->w['owner_token'])->getJson(self::REPORTS . 'accounting-control')->assertOk()->json('data');
        $this->assertSame(1, $control['summary']['matched']);
        $this->assertSame(0, $control['summary']['confirmed_differences']);
        $row = $control['rows'][0];
        $this->assertSame(12_000_000, $row['quantities']['stock_reversal_in']);
        $this->assertSame(self::COST, $row['values']['reversal_entry_credit_minor']);
        $clearing = $this->withToken($this->w['owner_token'])->getJson(self::REPORTS . 'clearing-account')->assertOk()->json('data.accounts.0');
        $this->assertSame(0, $clearing['closing_balance_minor']);
        $this->assertSame(0, $clearing['supported_balance_minor']);
        $this->assertSame(0, $clearing['unexplained_difference_minor']);

        // لا فاتورة/إيراد/ضريبة/تحصيل نتجت عن التعبئة طوال الدورة.
        foreach (['invoices', 'payments'] as $table) {
            $this->assertSame(0, (int) DB::table($table)->where('tenant_id', $this->w['tenant_id'])->count());
        }
        $this->assertSame(0, $this->net('4110'));
        $this->assertSame(0, $this->net('2120'));
    }

    /** @test */
    public function the_cycle_without_a_cost_change_returns_the_pool_to_its_exact_starting_state(): void
    {
        $fill = $this->fill(12_000_000);
        $this->postFill($fill)->assertCreated();
        $this->reverseFill($fill)->assertCreated();
        $pool = $this->pool91();
        $this->assertSame(30_000_000, (int) $pool['quantity_milliliters']);
        $this->assertSame(6_540_000, (int) $pool['cost_pool_minor']);
        $this->assertSame(30_000_000, $this->stock91());
        $this->assertSame([], $this->reconcileErrors());
        $this->assertSame(0, $this->net('1145'));
    }
}
