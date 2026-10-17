<?php

namespace App\Services;

use App\Models\User;
use App\Services\Reporting\ReportService;
use App\Tenancy\TenantContext;
use InvalidArgumentException;

/**
 * `finance.income_statement` — قائمة الدخل عن فترة، من `ReportService::incomeStatement` كما هي.
 *
 * الأساس المحاسبي كما ينفّذه ReportService: قيود `posted` و`reversed` (الأصل + العاكس = صفر)،
 * بتاريخ القيد `entry_date` شاملاً الطرفين، **باستثناء قيود الإقفال السنوي**. عند التصفية بفرع يُعاد
 * `unallocated` (ما لا فرع له) صراحةً كي لا تبدو أرقام الفرع ناقصة بلا تفسير.
 */
class AiIncomeStatementTool extends AiFinanceReportTool
{
    public function __construct(TenantContext $tenantContext, private readonly ReportService $reports)
    {
        parent::__construct($tenantContext);
    }

    public function name(): string
    {
        return 'finance.income_statement';
    }

    public function description(): string
    {
        return 'Income statement (revenue, expenses, net income) in SAR for an inclusive date range, from the accounting ledger. '
            . 'Use for profit/loss, revenue, expense questions. Dates are YYYY-MM-DD in the company timezone; period max 366 days.';
    }

    public function inputSchema(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'from' => ['type' => 'string', 'description' => 'Start date YYYY-MM-DD (inclusive).'],
                'to' => ['type' => 'string', 'description' => 'End date YYYY-MM-DD (inclusive), not in the future.'],
            ],
            'required' => ['from', 'to'],
            'additionalProperties' => false,
        ];
    }

    public function validate(array $arguments): array
    {
        $this->assertClosedSchema($arguments, ['from', 'to']);
        $timezone = $this->timezone();

        $from = $this->parseDate($arguments['from'] ?? null, $timezone);
        $to = $this->parseDate($arguments['to'] ?? null, $timezone);
        if ($from->greaterThan($to)) {
            throw new InvalidArgumentException('period_inverted');
        }
        if ($from->diffInDays($to) + 1 > self::MAX_PERIOD_DAYS) {
            throw new InvalidArgumentException('period_too_long');
        }

        return ['from' => $from->format('Y-m-d'), 'to' => $to->format('Y-m-d')];
    }

    protected function build(User $actor, array $arguments, array $branchScope, ?array $branchFilter, string $timezone): array
    {
        $filters = ['from' => $arguments['from'], 'to' => $arguments['to']];
        if ($branchFilter !== null) {
            $filters['branch_id'] = $branchFilter;
        }

        $is = $this->reports->incomeStatement($filters);
        $line = fn (array $r): array => ['code' => $r['code'], 'name' => $r['name'], 'amount' => $this->money((int) $r['amount'])];

        $result = $this->envelope('income_statement', $timezone, $branchScope) + [
            'period' => ['from' => $arguments['from'], 'to' => $arguments['to'], 'inclusive' => true],
            'basis' => [
                'method' => 'accrual_ledger',
                'entries' => 'posted_and_reversed',
                'date_field' => 'entry_date',
                'excludes' => 'fiscal_year_closing_entries',
            ],
            'totals' => [
                'total_revenue' => $this->money((int) $is['total_revenue']),
                'total_expense' => $this->money((int) $is['total_expense']),
                'net_income' => $this->money((int) $is['net_income']),
            ],
            'revenues' => array_map($line, $is['revenues']),
            'expenses' => array_map($line, $is['expenses']),
        ];

        if (isset($is['unallocated'])) {
            $result['unallocated'] = [
                'total_revenue' => $this->money((int) $is['unallocated']['total_revenue']),
                'total_expense' => $this->money((int) $is['unallocated']['total_expense']),
                'net_income' => $this->money((int) $is['unallocated']['net_income']),
            ];
        }

        $result['sources'] = [[
            'type' => 'report',
            'service' => 'ReportService::incomeStatement',
            'api_path' => $this->apiPath('income-statement', ['from' => $arguments['from'], 'to' => $arguments['to']], $branchFilter),
            'ui_path' => '/reports/general/income-statement',
        ]];

        return $result;
    }

    public function auditMeta(array $result): array
    {
        return [
            'row_count' => count($result['revenues'] ?? []) + count($result['expenses'] ?? []),
            'period_days' => (int) \Carbon\CarbonImmutable::parse($result['period']['from'])->diffInDays(\Carbon\CarbonImmutable::parse($result['period']['to'])) + 1,
            'branch_mode' => (string) $result['scope']['branch']['mode'],
            'branch_count' => count($result['scope']['branch']['ids']),
        ];
    }
}
