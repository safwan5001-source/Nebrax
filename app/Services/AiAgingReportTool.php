<?php

namespace App\Services;

use App\Models\User;
use App\Services\Reporting\ReportService;
use App\Tenancy\TenantContext;

/**
 * `finance.receivables_aging` / `finance.payables_aging` — أعمار الديون من `ReportService::aging`.
 *
 * ── الأساس كما ينفّذه ReportService (يُعلَن صراحةً في كل نتيجة، لا يُغيَّر هنا) ──
 *  - الرصيد = المتبقي (الإجمالي − المسدَّد) على الفواتير/المشتريات **المرحَّلة غير المسدَّدة بالكامل**،
 *    وهو الرصيد **الحالي** وقت التوليد لا رصيداً مُعاد بناؤه لتاريخٍ ماضٍ: `as_of` يحرّك مرجع العمر فقط.
 *    لذلك يحمل الردّ تحذيراً `as_of_not_historical` متى اختلف `as_of` عن اليوم بتوقيت المستأجر.
 *  - مرجع العمر: تاريخ الاستحقاق إن وُجد وإلا تاريخ المستند. الشرائح بأيام التأخر: ≤30 (يشمل غير المستحق)،
 *    31–60، 61–90، >90.
 *  - **ليس مطابقاً لحساب الأستاذ الرقابي** (ليس رصيد 1130/2110)؛ هو أعمار مستندات.
 *
 * ── حقل مقيَّد ──
 * تفاصيل الأطراف (المعرّف والاسم) تتطلب `partners.view` فوق `reports.view`. من لا يملكها يرى الإجماليات
 * والشرائح فقط مع `partner_detail = withheld` — ولا تُحذف الأرقام ولا تُعاد حسابها.
 */
class AiAgingReportTool extends AiFinanceReportTool
{
    private const BUCKETS = [
        ['key' => 'b0_30', 'days_past_due' => '<=30', 'includes_not_yet_due' => true],
        ['key' => 'b31_60', 'days_past_due' => '31-60', 'includes_not_yet_due' => false],
        ['key' => 'b61_90', 'days_past_due' => '61-90', 'includes_not_yet_due' => false],
        ['key' => 'b90_plus', 'days_past_due' => '>90', 'includes_not_yet_due' => false],
    ];

    /** @param 'receivable'|'payable' $type */
    public function __construct(TenantContext $tenantContext, private readonly ReportService $reports, private readonly string $type)
    {
        parent::__construct($tenantContext);
    }

    public function name(): string
    {
        return $this->type === 'payable' ? 'finance.payables_aging' : 'finance.receivables_aging';
    }

    public function description(): string
    {
        return ($this->type === 'payable'
            ? 'Payables (suppliers) aging: current outstanding balances owed to suppliers, bucketed by days past due, in SAR.'
            : 'Receivables (customers) aging: current outstanding customer balances, bucketed by days past due, in SAR.')
            . ' as_of (YYYY-MM-DD, not in the future) only moves the age reference; balances are always the current ones.';
    }

    public function inputSchema(): array
    {
        return [
            'type' => 'object',
            'properties' => ['as_of' => ['type' => 'string', 'description' => 'Age reference date YYYY-MM-DD (usually today).']],
            'required' => ['as_of'],
            'additionalProperties' => false,
        ];
    }

    public function validate(array $arguments): array
    {
        $this->assertClosedSchema($arguments, ['as_of']);

        return ['as_of' => $this->parseDate($arguments['as_of'] ?? null, $this->timezone())->format('Y-m-d')];
    }

    protected function build(User $actor, array $arguments, array $branchScope, ?array $branchFilter, string $timezone): array
    {
        $filters = ['as_of' => $arguments['as_of']];
        if ($branchFilter !== null) {
            $filters['branch_id'] = $branchFilter;
        }

        $aging = $this->reports->aging($this->type, $filters);

        $buckets = fn (array $r): array => [
            'b0_30' => $this->money((int) $r['b0_30']),
            'b31_60' => $this->money((int) $r['b31_60']),
            'b61_90' => $this->money((int) $r['b61_90']),
            'b90_plus' => $this->money((int) $r['b90_plus']),
            'total' => $this->money((int) $r['total']),
        ];

        $withPartners = $actor->hasPermission('partners.view');
        $isToday = $arguments['as_of'] === $this->today($timezone)->format('Y-m-d');

        $result = $this->envelope($this->type === 'payable' ? 'payables_aging' : 'receivables_aging', $timezone, $branchScope) + [
            'as_of' => $arguments['as_of'],
            'basis' => [
                'method' => 'document_remaining_balance',
                'documents' => $this->type === 'payable' ? 'posted_purchases_not_fully_paid' : 'posted_invoices_not_fully_paid',
                'balance_semantics' => 'current_outstanding_balance',
                // `as_of` يغيّر مرجع حساب العمر فقط؛ الرصيد حاليٌّ وقت التوليد ولا يُعاد بناؤه لذلك التاريخ.
                'as_of_role' => 'age_reference_only',
                'historical_balance_rebuilt' => false,
                'balance_as_of' => 'generation_time',
                'age_reference' => 'due_date_else_document_date',
                'reconciled_to_control_ledger' => false,
            ],
            'buckets' => self::BUCKETS,
            'totals' => $buckets($aging['totals']),
            'partner_detail' => $withPartners ? 'included' : 'withheld',
            'rows' => $withPartners
                ? array_map(fn (array $r): array => ['partner_id' => $r['partner_id'], 'name' => $r['name']] + $buckets($r), $aging['rows'])
                : [],
            'warnings' => $isToday ? [] : [[
                'code' => 'as_of_not_historical',
                'as_of' => $arguments['as_of'],
                'balance_as_of' => 'generation_time',
            ]],
        ];

        $result['sources'] = [[
            'type' => 'report',
            'service' => 'ReportService::aging',
            'api_path' => $this->apiPath('aging/' . $this->type, ['as_of' => $arguments['as_of']], $branchFilter),
            'ui_path' => $this->type === 'payable' ? '/reports/purchases/aging' : '/reports/customers/aging',
        ]];

        return $result;
    }

    public function auditMeta(array $result): array
    {
        return [
            'row_count' => count($result['rows'] ?? []),
            'partner_detail' => (string) $result['partner_detail'],
            'branch_mode' => (string) $result['scope']['branch']['mode'],
            'branch_count' => count($result['scope']['branch']['ids']),
        ];
    }
}
