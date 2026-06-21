<?php

namespace App\Http\Controllers\Api;

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

        return response()->json([
            'revenues'      => $this->mapAmounts($is['revenues']),
            'expenses'      => $this->mapAmounts($is['expenses']),
            'total_revenue' => Money::toRiyal($is['total_revenue']),
            'total_expense' => Money::toRiyal($is['total_expense']),
            'net_income'    => Money::toRiyal($is['net_income']),
        ]);
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
        $st = $this->reports->partnerStatement($partnerId, $this->filters($request));

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
            ], $st['rows']),
            'closing_balance' => Money::toRiyal($st['closing_balance']),
        ]);
    }

    public function aging(Request $request, string $type): JsonResponse
    {
        abort_unless(in_array($type, ['receivable', 'payable'], true), 404);

        $aging = $this->reports->aging($type, array_filter(['as_of' => $request->query('as_of')]));

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
            'from' => $request->query('from'),
            'to'   => $request->query('to'),
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
