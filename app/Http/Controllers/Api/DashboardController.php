<?php

namespace App\Http\Controllers\Api;

use App\Services\Reporting\DashboardService;
use App\Support\Money;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * تجميعات لوحة التحكم — **قراءة فقط**. لا قيد ولا رصيد ولا كتابة.
 * الأرقام المحاسبية الرسمية تبقى من `ReportController` المبني على الدفتر.
 */
class DashboardController extends ApiController
{
    public function __construct(protected DashboardService $dashboard) {}

    public function salesBreakdown(Request $request): JsonResponse
    {
        $request->validate([
            'by'          => ['required', 'in:' . implode(',', DashboardService::DIMENSIONS)],
            'from'        => ['nullable', 'date'],
            'to'          => ['nullable', 'date'],
            'branch_id'   => ['nullable'],
            'branch_id.*' => ['uuid'],
        ]);

        $result = $this->domain(fn () => $this->dashboard->salesBreakdown(
            $request->query('by'),
            [
                'from'      => $request->query('from'),
                'to'        => $request->query('to'),
                'branch_id' => (array) $request->query('branch_id', []),
            ]
        ));

        return response()->json([
            'dimension' => $result['dimension'],
            // الهللات تُحوَّل إلى ريال في طبقة العرض وحدها — كبقية الموارد.
            // VAR-REPORT-1: product_id/product_variant_id إضافيّان — موجودان
            // فقط لبُعد `product` (DashboardService::byProductDimension())،
            // فـ`?? null` يبقي بقية الأبعاد (يوم/فئة/فرع/بائع) بلا أي تغيير.
            'data'      => array_map(fn ($r) => [
                'key'                => $r['key'],
                'label'              => $r['label'],
                'amount'             => Money::toRiyal($r['amount']),
                'product_id'         => $r['product_id'] ?? null,
                'product_variant_id' => $r['product_variant_id'] ?? null,
            ], $result['rows']),
        ]);
    }
}
