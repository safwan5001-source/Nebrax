<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\PurchaseReportRequest;
use App\Models\User;
use App\Services\Reporting\PurchaseReportService;
use App\Support\Money;
use App\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** تقارير المشتريات التحليلية: واجهة قراءة فقط فوق PurchaseReportService. */
class PurchaseReportController extends ApiController
{
    public function __construct(protected PurchaseReportService $reports) {}

    public function show(PurchaseReportRequest $request): JsonResponse
    {
        $filters = $request->validated();
        $view = $filters['view'];
        unset($filters['view']);

        $result = $this->domain(fn () => $this->reports->report($view, $filters));

        return response()->json([
            'view'   => $result['view'],
            'scope'  => $result['scope'],
            'data'   => array_map(fn (array $row) => $this->toDisplay($row), $result['rows']),
            'totals' => $this->toDisplay($result['totals']),
        ]);
    }

    /**
     * قائمة منشئي فواتير الشراء ضمن المستأجر الحالي فقط. الرابط الاختياري بالموظف
     * يحسّن الاسم المعروض، لكن قيمة المرشح تبقى user_id المخزن في purchases.created_by.
     */
    public function creators(Request $request): JsonResponse
    {
        $tenantId = app(TenantContext::class)->id();
        $rows = User::query()
            ->leftJoin('employees', function ($join) {
                $join->on('employees.id', '=', 'users.employee_id')
                    ->on('employees.tenant_id', '=', 'users.tenant_id');
            })
            ->where('users.tenant_id', $tenantId)
            ->where('users.is_active', true)
            ->selectRaw('users.id, users.name as user_name, employees.name as employee_name')
            ->orderByRaw('COALESCE(employees.name, users.name)')
            ->get()
            ->map(fn ($row) => [
                'id'   => (string) $row->id,
                'name' => (string) ($row->employee_name ?: $row->user_name),
                'hint' => $row->employee_name ? (string) $row->user_name : null,
            ]);

        return response()->json(['data' => $rows]);
    }

    /** طبقة العرض وحدها تتعامل بالريال؛ العدادات تبقى أعداداً صحيحة. */
    private function toDisplay(array $row): array
    {
        foreach (['amount', 'net_purchases', 'tax', 'balance'] as $key) {
            if (array_key_exists($key, $row)) {
                $row[$key] = Money::toRiyal((int) $row[$key]);
            }
        }

        return $row;
    }
}
