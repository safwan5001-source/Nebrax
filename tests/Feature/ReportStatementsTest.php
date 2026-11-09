<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Partner;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\LedgerService;
use App\Services\Accounting\PaymentService;
use App\Services\Reporting\ReportService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * اختبارات كشوف الحساب وأعمار الديون.
 * تشغيل:  php artisan test --filter=ReportStatementsTest
 */
class ReportStatementsTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected Partner $customer;
    protected ReportService $reports;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'نبراس الطموح', 'slug' => 'nibras',
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);

        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $this->reports  = app(ReportService::class);
    }

    private function acc(string $code): string
    {
        return Account::where('code', $code)->first()->id;
    }

    /** @test */
    public function account_ledger_lists_movements_with_a_running_balance(): void
    {
        // بيع نقدي 1150 (الصندوق +115000) ثم مصروف نقدي 200 (الصندوق −20000)
        $inv = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        );
        app(InvoiceService::class)->post($inv);

        app(LedgerService::class)->post([
            ['account_id' => $this->acc('5130'), 'debit'  => 20000],
            ['account_id' => $this->acc('1110'), 'credit' => 20000],
        ], ['description' => 'إيجار']);

        $ledger = $this->reports->accountLedger($this->acc('1110'));

        $this->assertCount(2, $ledger['rows']);
        $this->assertSame(0, $ledger['opening_balance']);
        $this->assertSame(115000, $ledger['rows'][0]['balance']); // بعد البيع
        $this->assertSame(95000,  $ledger['rows'][1]['balance']); // بعد المصروف
        $this->assertSame(95000,  $ledger['closing_balance']);
    }

    /**
     * يحاكي ما يفعله PostgreSQL فعلياً في قاعدة طويلة العمر (تحديثات HOT، إعادة استخدام المساحة بعد VACUUM، تراجع
     * معاملات الاختبارات): الصفوف الحيّة تنتقل فيزيائياً فلا يعود ترتيب المسح = ترتيب الإدراج. إعادة كتابة كل صفٍّ
     * بقيمته نفسها بترتيب **معكوس** تضع نسخه الجديدة في الكومة معكوسةً. لا يتغيّر أي مبلغ أو حالة أو تاريخ.
     * على SQLite (rowid) لا أثر فيبقى الاختبار صالحاً على المحرّكين.
     */
    private function scramblePhysicalRowOrder(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            // المسح التسلسلي يتبع الترتيب الفيزيائي للكومة (مسار الفهرس يبقى على مدخل الجذر فلا يتأثر بتحديثات HOT).
            // SET LOCAL ينتهي مع معاملة الاختبار؛ لا يتسرّب إلى غيره.
            DB::statement('SET LOCAL enable_indexscan = off');
            DB::statement('SET LOCAL enable_bitmapscan = off');
            DB::statement('SET LOCAL enable_indexonlyscan = off');
        }
        foreach (['journal_lines', 'journal_entries'] as $table) {
            // المعرّفات تتناقص مع الترحيل في هذا الاختبار، فالترتيب التصاعدي بالمعرّف = عكس ترتيب الإنشاء.
            foreach (DB::table($table)->orderBy('id')->pluck('id') as $id) {
                DB::table($table)->where('id', $id)->update(['updated_at' => DB::raw('updated_at')]);
            }
        }
    }

    /**
     * ترتيب كشف الأستاذ حتميّ حين تتساوى `entry_date` و`created_at` (دقة الثانية): كان الترتيب بينها غير معرَّف
     * فيتبادل قيدان رُحِّلا في الثانية نفسها أحياناً على PostgreSQL (الرصيد الجاري يظهر -20000 قبل 115000).
     *
     * يُجمَّد الوقت (فتتطابق `created_at` و`posted_at` تماماً) وتُجبَر معرّفات UUID على الترتيب **المعاكس** للترحيل،
     * فلا يستطيع الترتيب أن ينجح بالمصادفة (لا بترتيب المسح ولا بترتيب المعرّف)؛ المرجع الوحيد الصحيح هو تسلسل رقم القيد
     * الذي يُولَّد تحت قفل المِرساة بترتيب الترحيل الفعلي.
     *
     * @test
     */
    public function account_ledger_order_is_deterministic_for_entries_sharing_a_date_and_timestamp(): void
    {
        $next = 0xFFFFFFFFFFF0;
        Str::createUuidsUsing(function () use (&$next) {
            return sprintf('ffffffff-ffff-4fff-8fff-%012x', $next--);
        });
        Carbon::setTestNow(Carbon::parse('2026-03-10 10:00:00'));

        try {
            $expected = [];
            $balance = 0;
            // 14 قيداً بالتاريخ والثانية نفسهما: قبض/صرف بمبالغ مميَّزة فيختلف الرصيد الجاري عند أي تبادل.
            foreach (range(1, 14) as $i) {
                $amount = $i * 1000 + 7;
                $isReceipt = $i % 3 !== 0;
                app(LedgerService::class)->post(
                    $isReceipt
                        ? [['account_id' => $this->acc('1110'), 'debit' => $amount], ['account_id' => $this->acc('4110'), 'credit' => $amount]]
                        : [['account_id' => $this->acc('5130'), 'debit' => $amount], ['account_id' => $this->acc('1110'), 'credit' => $amount]],
                    ['description' => "حركة {$i}", 'entry_date' => '2026-03-10']
                );
                $balance += $isReceipt ? $amount : -$amount;
                $expected[] = ['description' => "حركة {$i}", 'balance' => $balance];
            }

            $this->scramblePhysicalRowOrder();

            $ledger = $this->reports->accountLedger($this->acc('1110'));

            $this->assertSame($expected, array_map(
                fn ($row) => ['description' => $row['description'], 'balance' => $row['balance']],
                $ledger['rows']
            ));
            $this->assertSame($balance, $ledger['closing_balance']);
            // أرقام القيود تصاعدية = ترتيب الترحيل الفعلي.
            $numbers = array_column($ledger['rows'], 'number');
            $sorted = $numbers;
            sort($sorted);
            $this->assertSame($sorted, $numbers);
            // ثباتٌ: تكرار الاستعلام يعيد الترتيب نفسه.
            $this->assertSame($ledger['rows'], $this->reports->accountLedger($this->acc('1110'))['rows']);
        } finally {
            Carbon::setTestNow();
            Str::createUuidsNormally();
        }
    }

    /**
     * الترتيب الإضافي لا يمسّ التسلسل الزمني: التاريخ المحاسبي أولاً، ثم لحظة الإنشاء، وقيدٌ مؤرَّخ بأثر رجعي
     * يُرحَّل أخيراً يظهر في موضعه التاريخي لا في آخر الكشف.
     *
     * @test
     */
    public function account_ledger_keeps_chronology_when_ties_are_broken(): void
    {
        $post = function (string $date, string $description, int $debit, int $credit, string $at): void {
            Carbon::setTestNow(Carbon::parse($at));
            app(LedgerService::class)->post(
                [
                    ['account_id' => $this->acc('1110'), 'debit' => $debit, 'credit' => $credit],
                    ['account_id' => $this->acc($debit > 0 ? '4110' : '5130'), 'debit' => $credit, 'credit' => $debit],
                ],
                ['description' => $description, 'entry_date' => $date]
            );
        };

        try {
            $post('2026-03-10', 'ب', 5000, 0, '2026-03-10 09:00:00');
            $post('2026-03-10', 'ج', 0, 2000, '2026-03-10 09:00:00'); // الثانية نفسها: يُحسم بتسلسل الرقم
            $post('2026-03-10', 'د', 700, 0, '2026-03-10 09:00:01'); // ثانية لاحقة: يلي ما قبله
            $post('2026-03-09', 'أ', 100, 0, '2026-03-10 09:05:00'); // رُحِّل أخيراً بتاريخ أقدم: يتقدّم
            $post('2026-03-11', 'هـ', 0, 300, '2026-03-10 09:00:02'); // تاريخ أحدث: يتأخر وإن رُحِّل قبل «أ»

            $rows = $this->reports->accountLedger($this->acc('1110'))['rows'];

            $this->assertSame(['أ', 'ب', 'ج', 'د', 'هـ'], array_column($rows, 'description'));
            $this->assertSame([100, 5100, 3100, 3800, 3500], array_column($rows, 'balance'));
        } finally {
            Carbon::setTestNow();
        }
    }

    /** @test */
    public function account_ledger_respects_opening_balance_and_date_range(): void
    {
        app(InvoiceService::class)->post(app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash', 'invoice_date' => '2025-01-10'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        ));
        app(LedgerService::class)->post([
            ['account_id' => $this->acc('5130'), 'debit'  => 20000],
            ['account_id' => $this->acc('1110'), 'credit' => 20000],
        ], ['entry_date' => '2025-02-10', 'description' => 'إيجار فبراير']);

        $ledger = $this->reports->accountLedger($this->acc('1110'), ['from' => '2025-02-01']);

        $this->assertSame(115000, $ledger['opening_balance']);   // حركة يناير ترحّل كرصيد افتتاحي
        $this->assertCount(1, $ledger['rows']);                  // فبراير فقط
        $this->assertSame(95000, $ledger['closing_balance']);
    }

    /** @test */
    public function partner_statement_tracks_invoice_then_payment(): void
    {
        $inv = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['quantity' => 2, 'unit_price' => 100000, 'tax_rate' => 15]] // 2300
        );
        app(InvoiceService::class)->post($inv);

        app(PaymentService::class)->post(app(PaymentService::class)->create([
            'partner_id' => $this->customer->id, 'invoice_id' => $inv->id, 'amount' => 100000,
        ]));

        $st = $this->reports->partnerStatement($this->customer->id);

        $this->assertCount(2, $st['rows']);
        $this->assertSame(230000, $st['rows'][0]['debit']);   // الفاتورة
        $this->assertSame(230000, $st['rows'][0]['balance']);
        $this->assertSame(100000, $st['rows'][1]['credit']);  // التحصيل
        $this->assertSame(130000, $st['rows'][1]['balance']); // المتبقي
        $this->assertSame('invoice', $st['rows'][0]['source']['kind']);
        $this->assertSame('payment', $st['rows'][1]['source']['kind']);
        $this->assertSame($inv->number, $st['rows'][1]['source']['allocations'][0]['number']);
        $this->assertSame(100000, $st['rows'][1]['source']['allocations'][0]['amount']);
        $this->assertSame(130000, $st['closing_balance']);
    }

    /** @test */
    public function aging_buckets_receivables_and_excludes_paid(): void
    {
        $asOf = '2026-06-01';
        $mk = function (string $date) {
            $inv = app(InvoiceService::class)->create(
                ['partner_id' => $this->customer->id, 'payment_type' => 'credit', 'invoice_date' => $date],
                [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]] // 115000
            );
            return app(InvoiceService::class)->post($inv);
        };

        $mk('2026-05-25'); // ~7 يوم  → b0_30
        $mk('2026-04-10'); // ~52 يوم → b31_60
        $mk('2026-01-01'); // ~151 يوم → b90_plus
        $paid = $mk('2026-05-20');
        app(PaymentService::class)->post(app(PaymentService::class)->create([
            'partner_id' => $this->customer->id, 'invoice_id' => $paid->id, 'amount' => 115000, // سداد كامل → يُستبعد
        ]));

        $aging = $this->reports->aging('receivable', ['as_of' => $asOf]);

        $this->assertCount(1, $aging['rows']);
        $row = $aging['rows'][0];
        $this->assertSame(115000, $row['b0_30']);
        $this->assertSame(115000, $row['b31_60']);
        $this->assertSame(0,      $row['b61_90']);
        $this->assertSame(115000, $row['b90_plus']);
        $this->assertSame(345000, $row['total']);          // المسدّدة مستبعدة
        $this->assertSame(345000, $aging['totals']['total']);
    }

    /** @test */
    public function aging_payable_reads_from_purchases(): void
    {
        $supplier = Partner::create(['name' => 'مورد', 'type' => 'supplier']);
        $purchase = app(\App\Services\Accounting\PurchaseService::class)->create(
            ['partner_id' => $supplier->id, 'payment_type' => 'credit', 'purchase_date' => '2026-05-25'],
            [['quantity' => 10, 'unit_price' => 4000, 'tax_rate' => 15]] // 46000
        );
        app(\App\Services\Accounting\PurchaseService::class)->post($purchase);

        $aging = $this->reports->aging('payable', ['as_of' => '2026-06-01']);

        $this->assertSame('payable', $aging['type']);
        $this->assertSame(46000, $aging['totals']['total']);
        $this->assertSame(46000, $aging['rows'][0]['b0_30']);
    }
}
