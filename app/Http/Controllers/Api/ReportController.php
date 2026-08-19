<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\GeneralReportRequest;
use App\Services\Reporting\ReportService;
use App\Support\Money;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ReportController extends ApiController
{
    public function __construct(protected ReportService $reports) {}

    public function trialBalance(Request $request): JsonResponse
    {
        $tb = $this->reports->trialBalance($this->filters($request));

        return response()->json([
            'rows' => array_map(fn ($r) => [
                'code'   => $r['code'],
                'name'   => $r['name'],
                'type'   => $r['type'],
                'debit'  => Money::toRiyal($r['debit']),
                'credit' => Money::toRiyal($r['credit']),
            ], $tb['rows']),
            'total_debit'  => Money::toRiyal($tb['total_debit']),
            'total_credit' => Money::toRiyal($tb['total_credit']),
            'balanced'     => $tb['balanced'],
        ]);
    }

    public function incomeStatement(Request $request): JsonResponse
    {
        $is = $this->reports->incomeStatement($this->filters($request));

        return response()->json(array_filter([
            'revenues'      => $this->mapAmounts($is['revenues']),
            'expenses'      => $this->mapAmounts($is['expenses']),
            'total_revenue' => Money::toRiyal($is['total_revenue']),
            'total_expense' => Money::toRiyal($is['total_expense']),
            'net_income'    => Money::toRiyal($is['net_income']),
            // يظهر عند التصفية بفرع فقط — انظر ReportService::incomeStatement.
            'unallocated'   => isset($is['unallocated']) ? [
                'total_revenue' => Money::toRiyal($is['unallocated']['total_revenue']),
                'total_expense' => Money::toRiyal($is['unallocated']['total_expense']),
                'net_income'    => Money::toRiyal($is['unallocated']['net_income']),
            ] : null,
        ], fn ($v) => $v !== null));
    }

    public function balanceSheet(Request $request): JsonResponse
    {
        $bs = $this->reports->balanceSheet($this->filters($request));

        return response()->json([
            'assets'                  => $this->mapAmounts($bs['assets']),
            'liabilities'             => $this->mapAmounts($bs['liabilities']),
            'equity'                  => $this->mapAmounts($bs['equity']),
            'total_assets'            => Money::toRiyal($bs['total_assets']),
            'total_liabilities'       => Money::toRiyal($bs['total_liabilities']),
            'total_equity'            => Money::toRiyal($bs['total_equity']),
            'net_income'              => Money::toRiyal($bs['net_income']),
            'total_equity_and_income' => Money::toRiyal($bs['total_equity_and_income']),
            'balanced'                => $bs['balanced'],
        ]);
    }

    public function accountLedger(Request $request, string $accountId): JsonResponse
    {
        $ledger = $this->reports->accountLedger($accountId, $this->filters($request));

        return response()->json([
            'account'         => $ledger['account'],
            'opening_balance' => Money::toRiyal($ledger['opening_balance']),
            'rows'            => array_map(fn ($r) => [
                'date'        => $r['date'],
                'number'      => $r['number'],
                'description' => $r['description'],
                'debit'       => Money::toRiyal($r['debit']),
                'credit'      => Money::toRiyal($r['credit']),
                'balance'     => Money::toRiyal($r['balance']),
            ], $ledger['rows']),
            'closing_balance' => Money::toRiyal($ledger['closing_balance']),
        ]);
    }

    public function partnerStatement(Request $request, string $partnerId): JsonResponse
    {
        $filters = $this->filters($request);
        $role = $request->query('partner_role');
        if (in_array($role, ['customer', 'supplier'], true)) {
            $filters['partner_role'] = $role;
        }
        $st = $this->reports->partnerStatement($partnerId, $filters);

        return response()->json([
            'partner'         => $st['partner'],
            'opening_balance' => Money::toRiyal($st['opening_balance']),
            'rows'            => array_map(fn ($r) => [
                'date'        => $r['date'],
                'number'      => $r['number'],
                'description' => $r['description'],
                'debit'       => Money::toRiyal($r['debit']),
                'credit'      => Money::toRiyal($r['credit']),
                'balance'     => Money::toRiyal($r['balance']),
                'source'      => $r['source'] ? [
                    'kind'        => $r['source']['kind'],
                    'id'          => $r['source']['id'],
                    'label'       => $r['source']['label'],
                    'allocations' => array_map(fn ($allocation) => [
                        'kind'   => $allocation['kind'],
                        'id'     => $allocation['id'],
                        'number' => $allocation['number'],
                        'amount' => Money::toRiyal($allocation['amount']),
                    ], $r['source']['allocations']),
                ] : null,
            ], $st['rows']),
            'closing_balance' => Money::toRiyal($st['closing_balance']),
        ]);
    }

    public function costCenterProfitability(Request $request): JsonResponse
    {
        $r = $this->reports->costCenterProfitability($this->filters($request));

        return response()->json([
            'rows' => array_map(fn ($row) => [
                'cost_center_id' => $row['cost_center_id'],
                'code'           => $row['code'],
                'name'           => $row['name'],
                'revenue'        => Money::toRiyal($row['revenue']),
                'expense'        => Money::toRiyal($row['expense']),
                'profit'         => Money::toRiyal($row['profit']),
            ], $r['rows']),
            'total_revenue' => Money::toRiyal($r['total_revenue']),
            'total_expense' => Money::toRiyal($r['total_expense']),
            'total_profit'  => Money::toRiyal($r['total_profit']),
        ]);
    }

    /** القيود المرحّلة مع سطورها الكاملة؛ مرشح الحساب لا يبتّر القيد المتوازن. */
    public function journalEntries(GeneralReportRequest $request): JsonResponse
    {
        $report = $this->reports->journalEntries($request->validated());

        return response()->json([
            'rows' => array_map(fn ($row) => [
                'entry_id'    => $row['entry_id'],
                'date'        => $row['date'],
                'number'      => $row['number'],
                'description' => $row['description'],
                'source_type' => $row['source_type'],
                'source_id'   => $row['source_id'],
                'debit'       => Money::toRiyal($row['debit']),
                'credit'      => Money::toRiyal($row['credit']),
                'lines'       => array_map(fn ($line) => [
                    'account_id'   => $line['account_id'],
                    'account_code' => $line['account_code'],
                    'account_name' => $line['account_name'],
                    'description'  => $line['description'],
                    'debit'        => Money::toRiyal($line['debit']),
                    'credit'       => Money::toRiyal($line['credit']),
                ], $row['lines']),
            ], $report['rows']),
            'total_debit'  => Money::toRiyal($report['total_debit']),
            'total_credit' => Money::toRiyal($report['total_credit']),
        ]);
    }

    /** التدفقات النقدية المباشرة من النقد والبنك في القيود المرحّلة. */
    public function cashFlow(GeneralReportRequest $request): JsonResponse
    {
        $flow = $this->reports->cashFlow($request->validated());
        $section = fn (array $value) => [
            'inflows'  => Money::toRiyal($value['inflows']),
            'outflows' => Money::toRiyal($value['outflows']),
            'net'      => Money::toRiyal($value['net']),
            'entries'  => array_map(fn ($entry) => [
                'date'        => $entry['date'],
                'number'      => $entry['number'],
                'description' => $entry['description'],
                'inflow'      => Money::toRiyal($entry['inflow']),
                'outflow'     => Money::toRiyal($entry['outflow']),
                'net'         => Money::toRiyal($entry['net']),
            ], $value['entries']),
        ];

        return response()->json([
            'operating'     => $section($flow['operating']),
            'investing'     => $section($flow['investing']),
            'financing'     => $section($flow['financing']),
            'net_cash_flow' => Money::toRiyal($flow['net_cash_flow']),
        ]);
    }

    /** حركة ضريبة القيمة المضافة من حسابي المدخلات والمخرجات النظاميين. */
    public function taxReport(GeneralReportRequest $request): JsonResponse
    {
        $report = $this->reports->taxReport($request->validated());

        return response()->json([
            'input_vat'  => Money::toRiyal($report['input_vat']),
            'output_vat' => Money::toRiyal($report['output_vat']),
            'net_vat'    => Money::toRiyal($report['net_vat']),
            'status'     => $report['status'],
        ]);
    }

    public function aging(Request $request, string $type): JsonResponse
    {
        abort_unless(in_array($type, ['receivable', 'payable'], true), 404);

        $aging = $this->reports->aging($type, array_filter([
            'as_of'     => $request->query('as_of'),
            'branch_id' => $request->query('branch_id'),
        ]));

        $bucketize = fn (array $r) => [
            'partner_id' => $r['partner_id'],
            'name'       => $r['name'],
            'b0_30'      => Money::toRiyal($r['b0_30']),
            'b31_60'     => Money::toRiyal($r['b31_60']),
            'b61_90'     => Money::toRiyal($r['b61_90']),
            'b90_plus'   => Money::toRiyal($r['b90_plus']),
            'total'      => Money::toRiyal($r['total']),
        ];

        return response()->json([
            'type'   => $aging['type'],
            'as_of'  => $aging['as_of'],
            'rows'   => array_map($bucketize, $aging['rows']),
            'totals' => [
                'b0_30'    => Money::toRiyal($aging['totals']['b0_30']),
                'b31_60'   => Money::toRiyal($aging['totals']['b31_60']),
                'b61_90'   => Money::toRiyal($aging['totals']['b61_90']),
                'b90_plus' => Money::toRiyal($aging['totals']['b90_plus']),
                'total'    => Money::toRiyal($aging['totals']['total']),
            ],
        ]);
    }

    private function filters(Request $request): array
    {
        return array_filter([
            'from'      => $request->query('from'),
            'to'        => $request->query('to'),
            // بُعد الفرع: اختياري — بلا تمريره تبقى التقارير مجمّعة لكل الفروع.
            'branch_id' => $request->query('branch_id'),
        ]);
    }

    private function mapAmounts(array $rows): array
    {
        return array_map(fn ($r) => [
            'code'   => $r['code'],
            'name'   => $r['name'],
            'amount' => Money::toRiyal($r['amount']),
        ], $rows);
    }
}
