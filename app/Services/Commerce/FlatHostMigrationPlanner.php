<?php

namespace App\Services\Commerce;

use App\Support\ManagedStorefrontHostname;
use App\Support\StorefrontBaseDomainMisconfiguredException;
use Illuminate\Support\Facades\DB;

/**
 * مخطِّط ترحيل الخيار A (قراءة فقط): يحسب لكل مضيف مُدار قائم المضيف الهدف
 * `{tenant}-{store}.{base}` ويكشف التعارضات. **لا يكتب شيئاً**: استعلامات SELECT
 * فقط، وليس فيه (ولا في أمره) مسار تطبيق. التنفيذ الفعلي مهمة منفصلة تحتاج موافقة.
 *
 * حالات الصف:
 *  - first            مضيف المتجر الأول `{tenant}.{base}` — لا يتغير.
 *  - legacy_nested    `{store}.{tenant}.{base}` مطابق لسلاج المتجر والمستأجر — له هدف.
 *  - unrecognized     مضيف مُدار لا يطابق أياً من الصيغتين — يُبلَّغ ولا يُمسّ.
 *  - (custom domains لا تُقرأ أصلاً: type = awj_subdomain فقط)
 *
 * سياسة الحالة (`apply_as`): active | inactive | skip_deleted — المخطِّط لا يقترح تفعيلاً أبداً.
 *
 * أنواع التعارض (conflict):
 *  - target_taken_by_domain   الهدف مسجَّل مسبقاً كصف آخر.
 *  - target_is_tenant_slug    الهدف يطابق سلاج مستأجر (محجوز لمتجره الأول).
 *  - duplicate_target         صفّان قديمان أو أكثر يشتركان في الهدف نفسه.
 *  - invalid_target           الهدف غير صالح كـhostname (طول شريحة > 63 مثلاً).
 */
final class FlatHostMigrationPlanner
{
    /** @return array{base_domain: string, rows: list<array<string,mixed>>, summary: array<string,int>} */
    public function plan(?string $baseDomain = null): array
    {
        $baseDomain = $baseDomain === null
            ? ManagedStorefrontHostname::configuredBaseDomain()
            : $baseDomain;

        $records = DB::table('storefront_domains as d')
            ->join('storefronts as s', 's.id', '=', 'd.storefront_id')
            ->join('tenants as t', 't.id', '=', 'd.tenant_id')
            ->where('d.type', 'awj_subdomain')
            ->orderBy('d.hostname')
            ->get(['d.id as domain_id', 'd.hostname', 'd.is_active', 'd.is_primary', 'd.verification_status', 'd.storefront_id', 't.id as tenant_id', 't.slug as tenant_slug', 's.slug as store_slug', 's.is_active as store_active', 's.deleted_at as store_deleted_at']);

        $existingHosts = DB::table('storefront_domains')->pluck('hostname')->flip();
        $tenantSlugs = DB::table('tenants')->pluck('slug')->flip();

        $rows = [];
        $targetCounts = [];

        foreach ($records as $r) {
            $row = [
                'domain_id' => $r->domain_id,
                'tenant_id' => $r->tenant_id,
                'storefront_id' => $r->storefront_id,
                'hostname' => $r->hostname,
                'is_active' => (bool) $r->is_active,
                'verification_status' => $r->verification_status,
                'store_active' => (bool) $r->store_active,
                'store_deleted' => $r->store_deleted_at !== null,
                // سياسة الحالة لأي تطبيق مستقبلي: لا تفعيل أبداً. مصدر معطَّل (نطاق أو متجر)
                // أو محذوف → الصف الجديد يُنشأ معطَّلاً أو يُتخطّى؛ لا يرث «نشطاً» من لا شيء.
                'apply_as' => 'active',
                'status' => 'unrecognized',
                'target' => null,
                'conflicts' => [],
            ];

            $nested = $r->store_slug.'.'.$r->tenant_slug.'.'.$baseDomain;
            if ($r->hostname === $r->tenant_slug.'.'.$baseDomain) {
                $row['status'] = 'first';
            } elseif ($r->hostname === $nested) {
                $row['status'] = 'legacy_nested';
                try {
                    $row['target'] = ManagedStorefrontHostname::forAdditionalStoreSlug($r->store_slug, $r->tenant_slug, $baseDomain);
                    $targetCounts[$row['target']] = ($targetCounts[$row['target']] ?? 0) + 1;
                } catch (StorefrontBaseDomainMisconfiguredException) {
                    $row['conflicts'][] = 'invalid_target';
                }
            }

            $rows[] = $row;
        }

        foreach ($rows as &$row) {
            if ($row['store_deleted']) {
                $row['apply_as'] = 'skip_deleted';
            } elseif (! $row['is_active'] || ! $row['store_active'] || $row['verification_status'] !== 'verified') {
                $row['apply_as'] = 'inactive';
            }
            $target = $row['target'];
            if ($target === null) {
                continue;
            }
            if (isset($existingHosts[$target])) {
                $row['conflicts'][] = 'target_taken_by_domain';
            }
            $label = ManagedStorefrontHostname::labelOf($target, $baseDomain);
            if ($label !== null && isset($tenantSlugs[$label])) {
                $row['conflicts'][] = 'target_is_tenant_slug';
            }
            if (($targetCounts[$target] ?? 0) > 1) {
                $row['conflicts'][] = 'duplicate_target';
            }
        }
        unset($row);

        $summary = ['first' => 0, 'legacy_nested' => 0, 'unrecognized' => 0, 'conflicting' => 0, 'safe_to_migrate' => 0, 'inactive_sources' => 0];
        foreach ($rows as $row) {
            $summary[$row['status']]++;
            if ($row['status'] === 'legacy_nested') {
                if ($row['apply_as'] !== 'active') {
                    $summary['inactive_sources']++;
                }
                $row['conflicts'] === [] ? $summary['safe_to_migrate']++ : $summary['conflicting']++;
            }
        }

        return ['base_domain' => $baseDomain, 'rows' => $rows, 'summary' => $summary];
    }
}
