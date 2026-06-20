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
