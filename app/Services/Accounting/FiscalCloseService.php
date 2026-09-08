<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\FiscalYear;
use App\Models\FiscalYearClose;
use App\Models\FiscalYearEvent;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Tenant;
use App\Models\User;
use App\Support\FiscalCloseJournals;
use App\Tenancy\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  FiscalCloseService — الإقفال السنوي وفتحه (FISCAL-2)
 * ═══════════════════════════════════════════════════════════════
 *
 *  ═══ ما يفعله الإقفال ═══
 *  يصفّر **كل** حساب إيراد/مصروف له رصيد داخل السنة، مقابل دور
 *  `retained_earnings` مباشرةً — بلا حساب «ملخّص دخل» وسيط (قرار FISCAL-1
 *  لـV1). الربح يُقيَّد دائناً على الأرباح المرحّلة، والخسارة مديناً.
 *
 *  ═══ ما لا يفعله ═══
 *  • **لا يُقفل الأصول ولا الخصوم ولا حقوق الملكية**، ولا يولّد قيد ترحيل
 *    أرصدة افتتاحية سنوياً: الحسابات الدائمة تراكمية بطبيعتها، وقيدُ ترحيلها
 *    يضاعفها. و3130 «الأرصدة الافتتاحية» يبقى للافتتاح/التحويل وحده.
 *  • **لا يمسّ ضريبة القيمة المضافة**: 1150/2120 حسابا أصل/خصم لا حسابا نتيجة،
 *    فيخرجان بحكم النوع لا باستثناء خاص. ودورة الإقرار الضريبي وZATCA منفصلتان
 *    تماماً — الإقفال لا يغيّر حالة إقرار ولا يمسّ فاتورة صادرة.
 *  • **لا يحمل بُعد فرع ولا مركز تكلفة ولا طرفاً**: الإقفال مؤسسيّ في V1،
 *    وتوزيع الأرباح المرحّلة على الفروع قرارٌ لم يُتَّخذ.
 *
 *  ═══ التكامل مع أقفال الفترات (ACC-6) ═══
 *  **بلا أي تجاوز.** لا `force` ولا `skipLock` ولا صلاحية استثنائية داخل
 *  المحرك: قيد الإقفال يمرّ بـ`LedgerService::post()` كأي قيد، فيحرسه
 *  `AccountingDateGuard` كأي قيد. ولذلك يكون «قفلُ فترةٍ نشطٌ يشمل تاريخ نهاية
 *  السنة» **مانعاً (BLOCKER)** في فحص الجاهزية برسالة صريحة: يُحرَّر القفل
 *  بصلاحيته المستقلة وسببه المسجَّل، ثم يُقفل السنة، ثم يُعاد القفل. سلطتان
 *  مستقلّتان ومدقَّقتان — لا باب خلفيّ واحد.
 *
 *  ═══ التزامن ═══
 *  الإقفال والفتح يقفلان مِرساة المستأجر (`tenants`) — نفس مِرساة ACC-6
 *  وترقيم القيود — فيتسلسلان مع الترحيل العادي ومع بعضهما. وإعادة التحقّق من
 *  الشروط الحرجة تقع **داخل** المعاملة بعد المِرساة، فلا يُبنى إقفال على لقطة
 *  جاهزية قديمة.
 */
class FiscalCloseService
{
    public const SEVERITY_BLOCKER = 'blocker';
    public const SEVERITY_WARNING = 'warning';
    public const SEVERITY_INFO = 'info';

    /**
     * مستندات لها قيدٌ مرحَّل مُتوقَّع: (جدول، عمود التاريخ). تُفحص المرحَّلة منها
     * بحثاً عن قيدٍ مفقود، وتُعدّ المسوّدة منها تنبيهاً لا مانعاً.
     *
     * @var array<string, array{table: string, date: string, label: string}>
     */
    private const DOCUMENTS = [
        'invoices'         => ['table' => 'invoices', 'date' => 'invoice_date', 'label' => 'فواتير المبيعات'],
        'purchases'        => ['table' => 'purchases', 'date' => 'purchase_date', 'label' => 'فواتير المشتريات'],
        'payments'         => ['table' => 'payments', 'date' => 'payment_date', 'label' => 'سندات القبض والصرف'],
        'return_documents' => ['table' => 'return_documents', 'date' => 'return_date', 'label' => 'المرتجعات'],
        'manual_journals'  => ['table' => 'manual_journals', 'date' => 'entry_date', 'label' => 'القيود اليدوية'],
        'expenses'         => ['table' => 'expenses', 'date' => 'expense_date', 'label' => 'المصروفات'],
        'credit_notes'     => ['table' => 'credit_notes', 'date' => 'note_date', 'label' => 'إشعارات الدائن'],
        'supplier_refunds' => ['table' => 'supplier_refunds', 'date' => 'refund_date', 'label' => 'استردادات الموردين'],
    ];

    public function __construct(
        private TenantContext $tenantContext,
        private LedgerService $ledger,
        private AccountRoleResolver $accountRoles,
        private AccountingDateGuard $dateGuard,
        private FiscalYearService $years,
    ) {}

    // ───────────────────────────── الجاهزية ─────────────────────────────

    /**
     * لقطة جاهزية **استشارية**: تُعرض للمراجعة قبل التأكيد، ولا يُبنى عليها
     * الإقفال. الشروط الحرجة يُعاد التحقّق منها داخل معاملة الإقفال نفسها.
     *
     * @return array{blockers: list<array<string,mixed>>, warnings: list<array<string,mixed>>, info: list<array<string,mixed>>, can_close: bool}
     */
    public function readiness(FiscalYear $year): array
    {
        $items = [];

        foreach ($this->criticalIssues($year) as $issue) {
            $items[] = $issue;
        }

        $pl = $this->profitAndLoss($year);

        // ── تنبيهات: مسودات داخل السنة. ليست في الدفتر أصلاً فلا تدخل الحساب،
        //    لكن إخفاءها يجعل المستخدم يقفل سنةً ناقصة الترحيل بلا أن يدري.
        foreach (self::DOCUMENTS as $key => $document) {
            $drafts = $this->countDocuments($document, $year, 'draft');
            if ($drafts > 0) {
                $items[] = $this->item(self::SEVERITY_WARNING, "drafts.{$key}", sprintf(
                    'توجد %d مسودة في %s داخل السنة المالية. المسودات ليست في الدفتر ولا تدخل حساب الإقفال.',
                    $drafts,
                    $document['label'],
                ), ['count' => $drafts]);
            }
        }

        // ── معلومات.
        $items[] = $this->item(self::SEVERITY_INFO, 'result', sprintf(
            'إيرادات السنة %s ومصروفاتها %s، والنتيجة %s.',
            $this->money($pl['total_revenue']),
            $this->money($pl['total_expense']),
            $pl['net_income'] >= 0
                ? 'ربح ' . $this->money($pl['net_income'])
                : 'خسارة ' . $this->money(-$pl['net_income']),
        ), [
            'total_revenue' => $pl['total_revenue'],
            'total_expense' => $pl['total_expense'],
            'net_income'    => $pl['net_income'],
            'accounts'      => count($pl['lines']),
        ]);

        $retained = $this->tryResolveRetainedEarnings();
        if ($retained !== null) {
            $items[] = $this->item(self::SEVERITY_INFO, 'retained_earnings', sprintf(
                'وجهة الإقفال: %s — %s.',
                $retained->code,
                $retained->name,
            ), ['account_id' => $retained->id, 'code' => $retained->code, 'name' => $retained->name]);
        }

        $items[] = $this->item(self::SEVERITY_INFO, 'close_date', sprintf(
            'تاريخ قيد الإقفال: %s (نهاية السنة المالية).',
            $year->end_date->toDateString(),
        ), ['close_date' => $year->end_date->toDateString()]);

        $posted = [];
        foreach (self::DOCUMENTS as $key => $document) {
            $count = $this->countDocuments($document, $year, 'posted');
            if ($count > 0) {
                $posted[$key] = $count;
            }
        }
        if ($posted !== []) {
            $items[] = $this->item(self::SEVERITY_INFO, 'posted_documents',
                'المستندات المرحّلة داخل السنة: ' . implode('، ', array_map(
                    fn ($key, $count) => self::DOCUMENTS[$key]['label'] . " ({$count})",
                    array_keys($posted),
                    $posted,
                )) . '.',
                $posted,
            );
        }

        // أرصدة العملاء والموردين **ليست مانعاً ولا تنبيهاً**: أرصدة ميزانية
        // مشروعة تنتقل للسنة التالية بطبيعتها، وتحويلها إلى تنبيه يوحي بعملٍ
        // مطلوب لا وجود له.
        $receivable = $this->roleBalance('accounts_receivable');
        $payable    = $this->roleBalance('accounts_payable');
        if ($receivable !== null || $payable !== null) {
            $items[] = $this->item(self::SEVERITY_INFO, 'open_ar_ap', sprintf(
                'أرصدة قائمة تنتقل للسنة التالية — العملاء: %s، الموردون: %s. أرصدة ميزانية طبيعية لا تمنع الإقفال.',
                $this->money($receivable ?? 0),
                $this->money($payable ?? 0),
            ), ['receivable' => $receivable, 'payable' => $payable]);
        }

        // الضريبة: أرصدة **محاسبية محلية** لا حالة إقرار لدى الهيئة. لا تُقفل
        // (حسابا أصل/خصم)، ولا يدّعي النظام معرفة حالة ZATCA بلا تكامل موثوق.
        $taxOutput = $this->roleBalance('tax_output');
        $taxInput  = $this->roleBalance('tax_input');
        if ($taxOutput !== null || $taxInput !== null) {
            $items[] = $this->item(self::SEVERITY_INFO, 'vat_balances', sprintf(
                'أرصدة ضريبة القيمة المضافة المحاسبية — مخرجات: %s، مدخلات: %s. '
                . 'هذه أرصدة دفترية داخل أَوْج فقط، وليست حالة إقرار أو تقديم لدى هيئة الزكاة والضريبة والجمارك. '
                . 'حسابات الضريبة أصول/خصوم فلا تُقفل ضمن الإقفال السنوي، ودورة الإقرار الضريبي مستقلّة عن السنة المالية.',
                $this->money($taxOutput ?? 0),
                $this->money($taxInput ?? 0),
            ), ['tax_output' => $taxOutput, 'tax_input' => $taxInput]);
        }

        $generations = $year->closes()->with(['closer:id,name', 'reopener:id,name'])->get();
        if ($generations->isNotEmpty()) {
            $items[] = $this->item(self::SEVERITY_INFO, 'generations', sprintf(
                'للسنة %d عملية إقفال سابقة مسجَّلة.',
                $generations->count(),
            ), $generations->map(fn (FiscalYearClose $close) => [
                'generation' => $close->generation,
                'status'     => $close->status,
                'closed_by'  => $close->closer?->name,
                'closed_at'  => $close->closed_at?->toIso8601String(),
                'reopened_by' => $close->reopener?->name,
            ])->all());
        }

        return $this->group($items);
    }

    // ───────────────────────────── الإقفال ─────────────────────────────

    /** @return array<string, mixed> */
    public function close(string $fiscalYearId, ?User $actor): array
    {
        return DB::transaction(function () use ($fiscalYearId, $actor) {
            $this->lockAnchor();

            $year = FiscalYear::query()->lockForUpdate()->whereKey($fiscalYearId)->first();
            if ($year === null) {
                throw new RuntimeException('السنة المالية غير موجودة.');
            }

            // إعادة تحقّق **داخل** المعاملة: اللقطة الاستشارية قد تكون بايتة،
            // وقيدٌ رُحّل بعدها يغيّر الأرقام والشروط معاً.
            $critical = $this->criticalIssues($year);
            if ($critical !== []) {
                throw new RuntimeException($critical[0]['message']);
            }

            $retained = $this->accountRoles->resolve('retained_earnings');
            $pl = $this->profitAndLoss($year);

            $year->update(['status' => FiscalYear::STATUS_CLOSING]);

            $generation = ((int) $year->closes()->max('generation')) + 1;

            $close = FiscalYearClose::create([
                'fiscal_year_id' => $year->id,
                'generation'     => $generation,
                'status'         => FiscalYearClose::STATUS_ACTIVE,
                'total_revenue'  => $pl['total_revenue'],
                'total_expense'  => $pl['total_expense'],
                'net_income'     => $pl['net_income'],
                'retained_earnings_account_id' => $retained->id,
                'closed_by'      => $actor?->id,
                'closed_at'      => Carbon::now(),
            ]);

            $entry = null;
            if ($pl['lines'] !== []) {
                $entry = $this->ledger->post(
                    $this->closeLines($pl, $retained->id),
                    [
                        'entry_date'  => $year->end_date->toDateString(),
                        'description' => "إقفال السنة المالية {$year->name}",
                        // الهوية البنيوية: القيد يعرف جيله، والجيل يعرف سنته.
                        'source_type' => FiscalYearClose::class,
                        'source_id'   => $close->id,
                        'created_by'  => $actor?->id,
                        // `null` صريحاً: الإقفال مؤسسيّ، فلا يُوسَم بفرع المستخدم
                        // النشط. غياب المفتاح كان سيعني «الفرع النشط» في المحرك.
                        'branch_id'   => null,
                    ],
                );

                $close->update(['journal_entry_id' => $entry->id]);
            }

            $year->update(['status' => FiscalYear::STATUS_CLOSED]);

            $this->recordEvent($year, FiscalYearEvent::YEAR_CLOSED, $actor, null, $close, $entry?->id, [
                'total_revenue' => $pl['total_revenue'],
                'total_expense' => $pl['total_expense'],
                'net_income'    => $pl['net_income'],
                'accounts'      => count($pl['lines']),
                'retained_earnings_account' => $retained->code,
                'zero_activity' => $entry === null,
            ]);

            return $this->years->describe($year->fresh(['creator', 'closes']));
        });
    }

    // ───────────────────────────── الفتح ─────────────────────────────

    /** @return array<string, mixed> */
    public function reopen(string $fiscalYearId, string $reason, ?User $actor): array
    {
        $reason = trim($reason);
        if ($reason === '') {
            throw new RuntimeException('سبب فتح السنة المالية مطلوب.');
        }

        return DB::transaction(function () use ($fiscalYearId, $reason, $actor) {
            $this->lockAnchor();

            $year = FiscalYear::query()->lockForUpdate()->whereKey($fiscalYearId)->first();
            if ($year === null) {
                throw new RuntimeException('السنة المالية غير موجودة.');
            }
            if (! $year->isClosed()) {
                throw new RuntimeException('لا يمكن فتح سنة مالية غير مقفلة.');
            }

            $close = $year->closes()->where('status', FiscalYearClose::STATUS_ACTIVE)->first();
            if ($close === null) {
                throw new RuntimeException('لا يوجد جيل إقفال نشط لهذه السنة.');
            }

            $year->update(['status' => FiscalYear::STATUS_REOPENING]);

            $reversal = null;
            if ($close->journal_entry_id !== null) {
                $entry = JournalEntry::query()->whereKey($close->journal_entry_id)->first();
                if ($entry === null) {
                    throw new RuntimeException('قيد الإقفال الأصلي غير موجود — لا يمكن الفتح بأمان.');
                }

                // **تاريخ العكس = تاريخ الأصل** لا تاريخ اليوم: فتحُ سنةٍ يعيد
                // دفاترها إلى ما قبل الإقفال، فعكسٌ مؤرَّخ في سنةٍ تالية كان
                // سيُبقي السنة مقفلةً في ميزان مراجعتها ويصحّح الأرباح المرحّلة
                // في سنةٍ لا علاقة لها بالربح.
                //
                // والعكس يمرّ بـ`LedgerService::reverse()` بحسابات الأصل الفعلية
                // بلا إعادة حلّ أي دور: التعيين قد يكون تغيّر بعد الإقفال،
                // والحقيقة التاريخية هي ما في القيد لا ما في الإعدادات اليوم.
                $reversal = $this->ledger->reverse(
                    $entry,
                    $entry->entry_date->toDateString(),
                    "فتح السنة المالية {$year->name} — عكس إقفال الجيل {$close->generation}",
                );
            }

            $close->update([
                'status'            => FiscalYearClose::STATUS_REVERSED,
                'reversal_entry_id' => $reversal?->id,
                'reopened_by'       => $actor?->id,
                'reopened_at'       => Carbon::now(),
                'reopen_reason'     => $reason,
            ]);

            $year->update(['status' => FiscalYear::STATUS_OPEN]);

            $this->recordEvent($year, FiscalYearEvent::YEAR_REOPENED, $actor, $reason, $close, $reversal?->id, [
                'generation'        => $close->generation,
                'close_entry_id'    => $close->journal_entry_id,
                'reversal_entry_id' => $reversal?->id,
            ]);

            return $this->years->describe($year->fresh(['creator', 'closes']));
        });
    }

    // ───────────────────────────── الحساب ─────────────────────────────

    /**
     * أرصدة الإيراد/المصروف داخل السنة من **حقيقة الدفتر** لا من إجماليات
     * المستندات. وتُستثنى قيود الإقفال وعواكسها: المطلوب ما أنتجته العمليات،
     * فإعادة إقفالٍ بعد فتح تُحسب من جديد بلا أثرٍ من الجيل السابق.
     *
     * @return array{lines: list<array{account: Account, net: int}>, total_revenue: int, total_expense: int, net_income: int}
     */
    public function profitAndLoss(FiscalYear $year): array
    {
        $sums = JournalLine::query()
            ->selectRaw('account_id, SUM(debit) as total_debit, SUM(credit) as total_credit')
            ->whereHas('entry', function ($q) use ($year) {
                $q->whereIn('status', ['posted', 'reversed'])
                    ->whereDate('entry_date', '>=', $year->start_date->toDateString())
                    ->whereDate('entry_date', '<=', $year->end_date->toDateString());
                FiscalCloseJournals::exclude($q);
            })
            ->groupBy('account_id')
            ->get();

        $accounts = Account::query()->whereIn('id', $sums->pluck('account_id')->unique())->get()->keyBy('id');

        $lines = [];
        $totalRevenue = $totalExpense = 0;

        foreach ($sums as $sum) {
            $account = $accounts->get($sum->account_id);
            if ($account === null || ! in_array($account->type, ['revenue', 'expense'], true)) {
                continue;
            }

            $net = (int) $sum->total_debit - (int) $sum->total_credit;
            if ($net === 0) {
                continue; // حسابٌ رصيده صفر لا يحتاج سطر إقفال
            }

            $lines[] = ['account' => $account, 'net' => $net];

            if ($account->type === 'revenue') {
                $totalRevenue += -$net;
            } else {
                $totalExpense += $net;
            }
        }

        usort($lines, fn ($a, $b) => strcmp((string) $a['account']->code, (string) $b['account']->code));

        return [
            'lines'         => $lines,
            'total_revenue' => $totalRevenue,
            'total_expense' => $totalExpense,
            'net_income'    => $totalRevenue - $totalExpense,
        ];
    }

    /**
     * سطور قيد الإقفال: كل حساب نتيجة يُصفَّر بعكس رصيده، والصافي إلى الأرباح
     * المرحّلة. حين يكون الصافي صفراً (إيرادٌ يساوي المصروف) لا يُضاف سطر
     * الأرباح المرحّلة أصلاً — سطرٌ بصفرٍ ليس قيداً بل ضجيج.
     *
     * @return list<array<string, int|string>>
     */
    private function closeLines(array $pl, string $retainedEarningsAccountId): array
    {
        $lines = [];

        foreach ($pl['lines'] as $line) {
            $net = $line['net'];
            $lines[] = $net > 0
                ? ['account_id' => $line['account']->id, 'credit' => $net]
                : ['account_id' => $line['account']->id, 'debit' => -$net];
        }

        $netIncome = $pl['net_income'];
        if ($netIncome !== 0) {
            $lines[] = $netIncome > 0
                ? ['account_id' => $retainedEarningsAccountId, 'credit' => $netIncome]
                : ['account_id' => $retainedEarningsAccountId, 'debit' => -$netIncome];
        }

        return $lines;
    }

    // ───────────────────────────── الفحوص الحرجة ─────────────────────────────

    /**
     * الموانع وحدها — تُستعمل في اللقطة الاستشارية **وداخل معاملة الإقفال**
     * بنفس الكود، فلا يفترق ما يُعرض عمّا يُفرض.
     *
     * @return list<array<string, mixed>>
     */
    private function criticalIssues(FiscalYear $year): array
    {
        $issues = [];

        if ($year->isClosed()) {
            $issues[] = $this->item(self::SEVERITY_BLOCKER, 'year_status', 'السنة المالية مقفلة بالفعل.');
        } elseif ($year->isTransitioning()) {
            $issues[] = $this->item(self::SEVERITY_BLOCKER, 'year_status', 'توجد عملية إقفال أو فتح جارية على هذه السنة.');
        }

        if ($year->start_date->gt($year->end_date)) {
            $issues[] = $this->item(self::SEVERITY_BLOCKER, 'year_range', 'حدود السنة المالية غير صالحة.');
        }

        $overlap = FiscalYear::query()
            ->whereKeyNot($year->id)
            ->whereDate('start_date', '<=', $year->end_date->toDateString())
            ->whereDate('end_date', '>=', $year->start_date->toDateString())
            ->first();
        if ($overlap !== null) {
            $issues[] = $this->item(self::SEVERITY_BLOCKER, 'year_overlap', sprintf(
                'السنة المالية تتداخل مع «%s».',
                $overlap->name,
            ));
        }

        if ($year->closes()->where('status', FiscalYearClose::STATUS_ACTIVE)->exists()) {
            $issues[] = $this->item(self::SEVERITY_BLOCKER, 'active_generation', 'يوجد جيل إقفال نشط لهذه السنة؛ افتحها أولاً قبل إعادة الإقفال.');
        }

        if ($this->tryResolveRetainedEarnings() === null) {
            $issues[] = $this->item(self::SEVERITY_BLOCKER, 'retained_earnings', $this->retainedEarningsError ?? 'تعيين دور الأرباح المرحّلة غير صالح.');
        }

        // سلامة الدفتر داخل السنة: Σ مدين = Σ دائن.
        $totals = JournalLine::query()
            ->selectRaw('SUM(debit) as total_debit, SUM(credit) as total_credit')
            ->whereHas('entry', function ($q) use ($year) {
                $q->whereIn('status', ['posted', 'reversed'])
                    ->whereDate('entry_date', '>=', $year->start_date->toDateString())
                    ->whereDate('entry_date', '<=', $year->end_date->toDateString());
            })
            ->first();

        $debit  = (int) ($totals->total_debit ?? 0);
        $credit = (int) ($totals->total_credit ?? 0);
        if ($debit !== $credit) {
            $issues[] = $this->item(self::SEVERITY_BLOCKER, 'ledger_integrity', sprintf(
                'دفتر السنة غير متوازن: مدين %s ≠ دائن %s.',
                $this->money($debit),
                $this->money($credit),
            ), ['debit' => $debit, 'credit' => $credit]);
        }

        // حسابٌ نتيجة له رصيد لكنه معطَّل أو تجميعي: المحرك سيرفض سطره، فيُقال
        // ذلك هنا برسالة مفهومة بدل فشلٍ غامض وقت الترحيل.
        foreach ($this->profitAndLoss($year)['lines'] as $line) {
            $account = $line['account'];
            if (! $account->is_active || $account->is_group) {
                $issues[] = $this->item(self::SEVERITY_BLOCKER, 'unpostable_account', sprintf(
                    'الحساب %s — %s له رصيد داخل السنة لكنه %s، فلا يقبل سطر إقفال.',
                    $account->code,
                    $account->name,
                    $account->is_group ? 'حساب تجميعي' : 'معطَّل',
                ), ['account_id' => $account->id, 'code' => $account->code]);
            }
        }

        // قفل فترة نشط يشمل تاريخ الإقفال: لا تجاوز في أَوْج — يُحرَّر القفل
        // بصلاحيته المستقلة أولاً (ACC-6)، ثم يُقفل السنة، ثم يُعاد القفل.
        $lock = $this->dateGuard->activeLockFor($year->end_date->toDateString());
        if ($lock !== null) {
            $issues[] = $this->item(self::SEVERITY_BLOCKER, 'period_lock', sprintf(
                'قفل فترة محاسبية نشط (%s إلى %s) يشمل تاريخ الإقفال %s. حرِّر القفل أولاً ثم أقفل السنة.',
                $lock->start_date->toDateString(),
                $lock->end_date->toDateString(),
                $year->end_date->toDateString(),
            ));
        }

        // مستندٌ مرحَّل بلا قيد: حالة عدم اتّساق حقيقية، وإقفالُ سنةٍ فيها
        // يبني رقماً على دفترٍ ناقص.
        foreach (self::DOCUMENTS as $key => $document) {
            $orphans = $this->countOrphanedPostedDocuments($document, $year);
            if ($orphans > 0) {
                $issues[] = $this->item(self::SEVERITY_BLOCKER, "orphan.{$key}", sprintf(
                    'يوجد %d مستند مرحَّل في %s داخل السنة بلا قيد يومية مرتبط.',
                    $orphans,
                    $document['label'],
                ), ['count' => $orphans]);
            }
        }

        return $issues;
    }

    private ?string $retainedEarningsError = null;

    private function tryResolveRetainedEarnings(): ?Account
    {
        try {
            $account = $this->accountRoles->resolve('retained_earnings');
            $this->retainedEarningsError = null;

            return $account;
        } catch (RuntimeException $e) {
            $this->retainedEarningsError = $e->getMessage();

            return null;
        }
    }

    // ───────────────────────────── مساعدات ─────────────────────────────

    private function countDocuments(array $document, FiscalYear $year, string $status): int
    {
        return (int) DB::table($document['table'])
            ->where('tenant_id', $this->tenantId())
            ->where('status', $status)
            ->whereDate($document['date'], '>=', $year->start_date->toDateString())
            ->whereDate($document['date'], '<=', $year->end_date->toDateString())
            ->when(
                in_array('deleted_at', $this->columns($document['table']), true),
                fn ($q) => $q->whereNull('deleted_at'),
            )
            ->count();
    }

    private function countOrphanedPostedDocuments(array $document, FiscalYear $year): int
    {
        return (int) DB::table($document['table'])
            ->where('tenant_id', $this->tenantId())
            ->where('status', 'posted')
            ->whereDate($document['date'], '>=', $year->start_date->toDateString())
            ->whereDate($document['date'], '<=', $year->end_date->toDateString())
            ->when(
                in_array('deleted_at', $this->columns($document['table']), true),
                fn ($q) => $q->whereNull('deleted_at'),
            )
            ->where(function ($q) use ($document) {
                $q->whereNull('journal_entry_id')
                    ->orWhereNotExists(function ($sub) use ($document) {
                        $sub->select(DB::raw(1))
                            ->from('journal_entries')
                            ->whereColumn('journal_entries.id', $document['table'] . '.journal_entry_id');
                    });
            })
            ->count();
    }

    /** @var array<string, list<string>> */
    private array $columnCache = [];

    /** @return list<string> */
    private function columns(string $table): array
    {
        return $this->columnCache[$table] ??= DB::getSchemaBuilder()->getColumnListing($table);
    }

    /** صافي رصيد الحساب المعيَّن لدور، بطبيعته. `null` إن كان الدور غير قابل للحل. */
    private function roleBalance(string $roleKey): ?int
    {
        try {
            $account = $this->accountRoles->resolve($roleKey);
        } catch (RuntimeException) {
            return null;
        }

        $totals = JournalLine::query()
            ->selectRaw('SUM(debit) as total_debit, SUM(credit) as total_credit')
            ->where('account_id', $account->id)
            ->whereHas('entry', fn ($q) => $q->whereIn('status', ['posted', 'reversed']))
            ->first();

        $net = (int) ($totals->total_debit ?? 0) - (int) ($totals->total_credit ?? 0);

        return $account->normal_balance === 'debit' ? $net : -$net;
    }

    private function money(int $halalas): string
    {
        return number_format($halalas / 100, 2) . ' ر.س';
    }

    /** @return array<string, mixed> */
    private function item(string $severity, string $code, string $message, array $details = []): array
    {
        return ['severity' => $severity, 'code' => $code, 'message' => $message, 'details' => $details];
    }

    /** @return array{blockers: list<array<string,mixed>>, warnings: list<array<string,mixed>>, info: list<array<string,mixed>>, can_close: bool} */
    private function group(array $items): array
    {
        $bucket = fn (string $severity) => array_values(array_filter($items, fn ($i) => $i['severity'] === $severity));

        $blockers = $bucket(self::SEVERITY_BLOCKER);

        return [
            'blockers'  => $blockers,
            'warnings'  => $bucket(self::SEVERITY_WARNING),
            'info'      => $bucket(self::SEVERITY_INFO),
            'can_close' => $blockers === [],
        ];
    }

    private function recordEvent(
        FiscalYear $year,
        string $action,
        ?User $actor,
        ?string $reason,
        ?FiscalYearClose $close,
        ?string $journalEntryId,
        array $details,
    ): void {
        FiscalYearEvent::create([
            'fiscal_year_id'       => $year->id,
            'fiscal_year_close_id' => $close?->id,
            'action'               => $action,
            'actor_user_id'        => $actor?->id,
            'generation'           => $close?->generation,
            'journal_entry_id'     => $journalEntryId,
            'reason'               => $reason,
            'details'              => $details,
        ]);
    }

    private function tenantId(): string
    {
        $tenantId = $this->tenantContext->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا يوجد مستأجر نشط للإقفال السنوي.');
        }

        return $tenantId;
    }

    private function lockAnchor(): void
    {
        Tenant::whereKey($this->tenantId())->lockForUpdate()->firstOrFail();
    }
}
