<?php

namespace App\Services;

use App\Models\Branch;
use App\Models\User;
use App\Models\Warehouse;
use App\Support\AiAssistantDenied;

/**
 * نطاق الفرع/المخزن الفعّال للمساعد — **رفض صريح** لا تقاطع صامت.
 *
 * تقارير ERP الحالية (`ReportBranchScope`) تعيد كل نطاق المستخدم حين يكون المطلوب
 * ممنوعاً؛ هذا مقبول لشاشة تقرير لكنه يوسّع سؤال المساعد عمّا قصده. هنا أي معرّف
 * خارج نطاق الفاعل (أو خارج مستأجره) يُرفض بـ403 ولا يُستبدل بنطاق أوسع.
 *
 * دلالة القوائم الفارغة محفوظة كما في النموذج: `allowedBranchIds() === null`
 * تعني «غير مقيَّد» لا «لا شيء». المخرج:
 *   mode = all      غير مقيَّد ولم يطلب شيئاً (ids = []، لا تصفية)
 *   mode = selected طلب مجموعةً صريحةً ومسموحة
 *   mode = assigned مقيَّد ولم يطلب شيئاً → كل ما أُسند إليه
 */
class AiAssistantScopeGuard
{
    /**
     * @param  list<string>  $branchIds
     * @param  list<string>  $warehouseIds
     * @return array{branch: array{mode:string, ids:list<string>}, warehouse: array{mode:string, ids:list<string>}}
     * @throws AiAssistantDenied
     */
    public function resolve(User $actor, array $branchIds, array $warehouseIds): array
    {
        return [
            'branch' => $this->dimension(
                $actor->allowedBranchIds(),
                $branchIds,
                fn (array $ids): int => Branch::query()->whereIn('id', $ids)->count(),
                'branch_scope_forbidden',
            ),
            'warehouse' => $this->dimension(
                $actor->allowedWarehouseIds(),
                $warehouseIds,
                fn (array $ids): int => Warehouse::query()->whereIn('id', $ids)->count(),
                'warehouse_scope_forbidden',
            ),
        ];
    }

    /**
     * @param  array<int,string>|null  $allowed  null = غير مقيَّد
     * @param  list<string>  $requested
     * @param  callable(list<string>):int  $countInTenant
     * @return array{mode:string, ids:list<string>}
     */
    private function dimension(?array $allowed, array $requested, callable $countInTenant, string $reason): array
    {
        $requested = array_values(array_unique($requested));

        if ($allowed !== null) {
            if (array_diff($requested, $allowed) !== []) {
                throw AiAssistantDenied::for($reason);
            }

            return $requested === []
                ? ['mode' => 'assigned', 'ids' => array_values($allowed)]
                : ['mode' => 'selected', 'ids' => $requested];
        }

        if ($requested === []) {
            return ['mode' => 'all', 'ids' => []];
        }

        // غير مقيَّد: يجب أن تكون كل المعرّفات موجودة داخل مستأجره (TenantScope).
        if ($countInTenant($requested) !== count($requested)) {
            throw AiAssistantDenied::for($reason);
        }

        return ['mode' => 'selected', 'ids' => $requested];
    }
}
