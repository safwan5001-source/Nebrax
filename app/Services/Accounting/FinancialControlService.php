<?php

namespace App\Services\Accounting;

use App\Models\Expense;
use App\Models\FinancialControlAlert;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\ManualJournal;
use App\Models\Payment;
use App\Models\Purchase;
use App\Services\Reporting\ReportService;
use App\Support\Settings;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * فحوصات رقابة مالية قراءة-فقط.
 *
 * لا يعدّل هذا المحرك قيداً أو مستنداً أو رصيداً. النتيجة الوحيدة القابلة للكتابة
 * هي سجل تنبيه يصف فرقاً قابلاً للمراجعة ويرتبط بمصدره عند وجوده.
 */
class FinancialControlService
{
    public function __construct(private readonly ReportService $reports)
    {
    }

    /** @return array{enabled:bool, detected:int, active:int, resolved:int, alerts:array<int,FinancialControlAlert>} */
    public function scan(bool $force = false): array
    {
        $enabled = (bool) Settings::get('finance', 'financial_alerts_enabled');
        if (! $force && ! $enabled) {
            return ['enabled' => false, 'detected' => 0, 'active' => 0, 'resolved' => 0, 'alerts' => []];
        }

        $issues = [
            ...$this->journalBalanceIssues(),
            ...$this->reportConsistencyIssues(),
            ...$this->postedSourceIssues(),
        ];

        return DB::transaction(function () use ($issues, $enabled) {
            $fingerprints = [];
            $alerts = [];
            foreach ($issues as $issue) {
                $fingerprints[] = $issue['fingerprint'];
                $alerts[] = $this->synchronize($issue);
            }

            $stale = FinancialControlAlert::query()
                ->whereIn('status', ['active', 'acknowledged'])
                ->when($fingerprints === [], fn ($query) => $query, fn ($query) => $query->whereNotIn('fingerprint', $fingerprints))
                ->get();

            // إن لم يكتشف الفحص الكامل فرقاً، تُغلق كل التنبيهات المفتوحة للمستأجر.
            if ($fingerprints === []) {
                $stale = FinancialControlAlert::query()->whereIn('status', ['active', 'acknowledged'])->get();
            }

            foreach ($stale as $alert) {
                $alert->update(['status' => 'resolved', 'resolved_at' => now()]);
            }

            return [
                'enabled' => $enabled,
                'detected' => count($issues),
                'active' => FinancialControlAlert::whereIn('status', ['active', 'acknowledged'])->count(),
                'resolved' => $stale->count(),
                'alerts' => $alerts,
            ];
        });
    }

    /** @return array<int,array<string,mixed>> */
    private function journalBalanceIssues(): array
    {
        return JournalLine::query()
            ->selectRaw('journal_lines.journal_entry_id, SUM(journal_lines.debit) as total_debit, SUM(journal_lines.credit) as total_credit')
            ->join('journal_entries as entries', 'entries.id', '=', 'journal_lines.journal_entry_id')
            ->whereIn('entries.status', ['posted', 'reversed'])
            ->groupBy('journal_lines.journal_entry_id')
            ->havingRaw('SUM(journal_lines.debit) <> SUM(journal_lines.credit)')
            ->get()
            ->map(function ($row): array {
                $entry = JournalEntry::findOrFail($row->journal_entry_id);

                return $this->issue(
                    fingerprint: 'journal_unbalanced:' . $entry->id,
                    rule: 'journal_unbalanced',
                    severity: 'critical',
                    title: 'قيد يومية غير متوازن',
                    description: "القيد {$entry->number} لا يتساوى فيه إجمالي المدين مع إجمالي الدائن.",
                    sourceType: JournalEntry::class,
                    sourceId: $entry->id,
                    details: [
                        'journal_entry_id' => $entry->id,
                        'journal_number' => $entry->number,
                        'debit' => (int) $row->total_debit,
                        'credit' => (int) $row->total_credit,
                        'difference' => (int) $row->total_debit - (int) $row->total_credit,
                    ],
                );
            })
            ->all();
    }

    /** @return array<int,array<string,mixed>> */
    private function reportConsistencyIssues(): array
    {
        $issues = [];
        $period = $this->reportPeriod();
        $trialBalance = $this->reports->trialBalance($period);
        if (! $trialBalance['balanced']) {
            $issues[] = $this->issue(
                fingerprint: 'report_trial_balance_unbalanced',
                rule: 'trial_balance_unbalanced',
                severity: 'critical',
                title: 'ميزان المراجعة غير متوازن',
                description: 'إجمالي المدين في ميزان المراجعة لا يساوي إجمالي الدائن.',
                details: [
                    'debit' => $trialBalance['total_debit'],
                    'credit' => $trialBalance['total_credit'],
                    'difference' => $trialBalance['total_debit'] - $trialBalance['total_credit'],
                    'period_from' => $period['from'],
                    'period_to' => $period['to'],
                ],
            );
        }

        // الميزانية رصيد تراكمي، لذلك تقبل تاريخ النهاية فقط ولا يُبتر رصيدها الافتتاحي.
        $balanceSheet = $this->reports->balanceSheet(['to' => $period['to']]);
        if (! $balanceSheet['balanced']) {
            $issues[] = $this->issue(
                fingerprint: 'report_balance_sheet_unbalanced',
                rule: 'balance_sheet_unbalanced',
                severity: 'critical',
                title: 'الميزانية العمومية غير متوازنة',
                description: 'إجمالي الأصول لا يساوي الخصوم وحقوق الملكية وصافي الدخل.',
                details: [
                    'assets' => $balanceSheet['total_assets'],
                    'liabilities' => $balanceSheet['total_liabilities'],
                    'equity_and_income' => $balanceSheet['total_equity_and_income'],
                    'difference' => $balanceSheet['total_assets'] - ($balanceSheet['total_liabilities'] + $balanceSheet['total_equity_and_income']),
                ],
            );
        }

        return $issues;
    }

    /** @return array{from:string,to:string} */
    private function reportPeriod(): array
    {
        $days = max(1, min(90, (int) Settings::get('finance', 'alert_check_window_days')));
        $to = Carbon::today();

        return [
            'from' => $to->copy()->subDays($days - 1)->toDateString(),
            'to' => $to->toDateString(),
        ];
    }

    /** @return array<int,array<string,mixed>> */
    private function postedSourceIssues(): array
    {
        $issues = [];
        foreach ($this->postedSources() as $source) {
            $model = $source['model'];
            $label = $source['label'];
            $documents = $model::query()
                ->where('status', 'posted')
                ->with('journalEntry:id,status')
                ->get(['id', 'number', 'branch_id', 'journal_entry_id']);

            foreach ($documents->filter(fn ($document) => $document->journalEntry === null || ! in_array($document->journalEntry->status, ['posted', 'reversed'], true)) as $document) {
                $issues[] = $this->issue(
                    fingerprint: 'posted_source_without_journal:' . $model . ':' . $document->id,
                    rule: 'posted_source_without_journal',
                    severity: 'critical',
                    title: 'مستند مرحّل بلا قيد آلي',
                    description: "{$label} {$document->number} مرحّل لكنه لا يملك قيد يومية مرتبطاً به.",
                    sourceType: $model,
                    sourceId: $document->id,
                    branchId: $document->branch_id,
                    details: [
                        'source_type' => $model,
                        'source_id' => $document->id,
                        'source_number' => $document->number,
                    ],
                );
            }
        }

        return $issues;
    }

    /** @return array<int,array{model:class-string,label:string}> */
    private function postedSources(): array
    {
        return [
            ['model' => Invoice::class, 'label' => 'فاتورة المبيعات'],
            ['model' => Purchase::class, 'label' => 'فاتورة المشتريات'],
            ['model' => Payment::class, 'label' => 'سند الدفع'],
            ['model' => Expense::class, 'label' => 'المصروف'],
            ['model' => ManualJournal::class, 'label' => 'القيد اليدوي'],
        ];
    }

    /** @param array<string,mixed> $details @return array<string,mixed> */
    private function issue(
        string $fingerprint,
        string $rule,
        string $severity,
        string $title,
        string $description,
        ?string $sourceType = null,
        ?string $sourceId = null,
        ?string $branchId = null,
        array $details = [],
    ): array {
        return compact('fingerprint', 'rule', 'severity', 'title', 'description', 'sourceType', 'sourceId', 'branchId', 'details');
    }

    /** @param array<string,mixed> $issue */
    private function synchronize(array $issue): FinancialControlAlert
    {
        $now = Carbon::now();
        $alert = FinancialControlAlert::firstOrNew(['fingerprint' => $issue['fingerprint']]);
        $new = ! $alert->exists;
        $reopened = ! $new && $alert->status === 'resolved';

        $alert->fill([
            'branch_id' => $issue['branchId'],
            'rule' => $issue['rule'],
            'severity' => $issue['severity'],
            'title' => $issue['title'],
            'description' => $issue['description'],
            'source_type' => $issue['sourceType'],
            'source_id' => $issue['sourceId'],
            'details' => $issue['details'],
            'last_detected_at' => $now,
        ]);

        if ($new || $reopened) {
            $alert->status = 'active';
            $alert->first_detected_at = $now;
            $alert->resolved_at = null;
            $alert->acknowledged_by = null;
            $alert->acknowledged_at = null;
            $alert->acknowledgement_note = null;
        }

        $alert->save();

        return $alert;
    }
}
