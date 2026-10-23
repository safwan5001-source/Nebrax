<?php

namespace App\Services;

use App\Models\AiActionControl;
use App\Models\Tenant;
use App\Support\AiActionsAccessDecision;
use App\Support\Settings;
use Illuminate\Support\Str;

/**
 * ═══════════════════════════════════════════════════════════════
 *  الحالة الفعّالة لإجراءات المساعد — IMP-X-01a (القراءة)
 * ═══════════════════════════════════════════════════════════════
 *  `effective(tenant, type, capability)` يعيد قراراً برمز سبب ثابت. **قراءة واحدة بلا أقفال، وفشل مغلق** (نمط ضوابط المنصة القائمة).
 *
 *  الطبقات (قرار المالك D-10/D-11)، وكلها لازمة معاً:
 *    أرضية البيئة ← مفتاح المنصة الرئيسي ← توفّر النوع ← منحة المستأجر للنوع ← قبول المستأجر نفسه.
 *  القدرات: `preview` و`review` تُقيَّمان بسلسلة `use`؛ `execution` تستلزم سلسلة `use` كاملة **ثم** سلسلتها الخاصة (أرضية `AI_ACTIONS_EXECUTION_ENABLED`،
 *  مفتاح المنصة للتنفيذ، توفّر النوع للتنفيذ، منحة المستأجر للتنفيذ، **وموافقة مالك المؤسسة** `ai_actions.execution_approved`). إيقاف التنفيذ بأي مستوى
 *  يترك المعاينة والمراجعة تعملان؛ ومنحة قدرة أدنى لا تفيد أعلى.
 *
 *  هذا القرار شرط لازم لا كافٍ: لا يمنح صلاحية RBAC ولا يوسّع نطاق فرع ولا يتجاوز المعاينة والموافقة قبل التنفيذ. لا يقرؤه أي مسار بعد (التوصيل:
 *  IMP-X-01b خلف بوابة نشر مغلقة).
 */
final class AiActionsAccessResolver
{
    public const PREVIEW = 'preview';
    public const REVIEW = 'review';
    public const EXECUTION = 'execution';

    public const CAPABILITIES = [self::PREVIEW, self::REVIEW, self::EXECUTION];

    public function __construct(private readonly AiActionRegistry $registry) {}

    public function effective(?string $tenantId, string $actionType, string $capability): AiActionsAccessDecision
    {
        if (! in_array($capability, self::CAPABILITIES, true)) {
            return AiActionsAccessDecision::denied('invalid_capability', $capability);
        }
        if (! in_array($actionType, $this->registry->types(), true)) {
            return AiActionsAccessDecision::denied('unknown_type', $capability);
        }
        if (! is_string($tenantId) || ! Str::isUuid($tenantId)) {
            return AiActionsAccessDecision::denied('no_tenant_context', $capability);
        }

        $execution = $capability === self::EXECUTION;

        // الأرضية الصلبة (D-10): لا إعداد مشغّل يتجاوزها.
        if (config('ai_actions.enabled') !== true) {
            return AiActionsAccessDecision::denied('env_floor_off', $capability);
        }

        $rows = $this->rows($tenantId, $actionType);

        foreach ($this->useChain($rows, $actionType) as $reason) {
            return AiActionsAccessDecision::denied($reason, $capability);
        }

        $tenant = Tenant::query()->find($tenantId);
        if ($tenant === null || ! $tenant->is_active) {
            return AiActionsAccessDecision::denied('tenant_inactive', $capability);
        }
        if ((Settings::group('ai_actions', $tenant)['enabled'] ?? false) !== true) {
            return AiActionsAccessDecision::denied('tenant_not_enabled', $capability);
        }

        if (! $execution) {
            return AiActionsAccessDecision::allowed($capability);
        }

        if (config('ai_actions.execution_enabled') !== true) {
            return AiActionsAccessDecision::denied('execution_env_floor_off', $capability);
        }
        if (! $this->on($rows, AiActionControl::SCOPE_PLATFORM, AiActionControl::ALL_TYPES, AiActionControl::CAPABILITY_EXECUTION)) {
            return AiActionsAccessDecision::denied('execution_platform_off', $capability);
        }
        if (! $this->on($rows, AiActionControl::SCOPE_PLATFORM, $actionType, AiActionControl::CAPABILITY_EXECUTION)) {
            return AiActionsAccessDecision::denied('execution_type_off', $capability);
        }
        if (! $this->on($rows, AiActionControl::SCOPE_TENANT, $actionType, AiActionControl::CAPABILITY_EXECUTION)) {
            return AiActionsAccessDecision::denied('execution_tenant_not_granted', $capability);
        }
        if ((Settings::group('ai_actions', $tenant)['execution_approved'] ?? false) !== true) {
            return AiActionsAccessDecision::denied('tenant_owner_not_approved', $capability);
        }

        return AiActionsAccessDecision::allowed($capability);
    }

    /**
     * مصفوفة القرارات لكل نوع مسجَّل وكل قدرة (لعرض مدير المنصة وللاختبارات).
     *
     * @return array<string, array<string, array{allowed: bool, reason: string}>>
     */
    public function matrix(?string $tenantId): array
    {
        $matrix = [];
        foreach ($this->registry->types() as $type) {
            foreach (self::CAPABILITIES as $capability) {
                $decision = $this->effective($tenantId, $type, $capability);
                $matrix[$type][$capability] = ['allowed' => $decision->allowed, 'reason' => $decision->reason];
            }
        }

        return $matrix;
    }

    /**
     * @param  array<string, bool>  $rows
     * @return list<string> أول سبب رفض في سلسلة `use`، أو فارغة.
     */
    private function useChain(array $rows, string $actionType): array
    {
        if (! $this->on($rows, AiActionControl::SCOPE_PLATFORM, AiActionControl::ALL_TYPES, AiActionControl::CAPABILITY_USE)) {
            return ['platform_off'];
        }
        if (! $this->on($rows, AiActionControl::SCOPE_PLATFORM, $actionType, AiActionControl::CAPABILITY_USE)) {
            return ['type_off'];
        }
        if (! $this->on($rows, AiActionControl::SCOPE_TENANT, $actionType, AiActionControl::CAPABILITY_USE)) {
            return ['tenant_not_granted'];
        }

        return [];
    }

    /**
     * عبارة SQL واحدة بلا أقفال: صفوف المنصة (المفتاح الرئيسي ونوعنا) وصفوف هذا المستأجر لنوعنا فقط — لا صف مستأجر آخر يُقرأ أبداً.
     *
     * @return array<string, bool> مفتاح `scope|type|capability` ⇒ enabled
     */
    private function rows(string $tenantId, string $actionType): array
    {
        $rows = AiActionControl::query()
            ->where(function ($query) use ($tenantId, $actionType) {
                $query->where(fn ($q) => $q->where('scope', AiActionControl::SCOPE_PLATFORM)->whereIn('action_type', [AiActionControl::ALL_TYPES, $actionType]))
                    ->orWhere(fn ($q) => $q->where('scope', AiActionControl::SCOPE_TENANT)->where('tenant_id', $tenantId)->where('action_type', $actionType));
            })
            ->get(['scope', 'action_type', 'capability', 'enabled']);

        $map = [];
        foreach ($rows as $row) {
            $map[$row->scope.'|'.$row->action_type.'|'.$row->capability] = (bool) $row->enabled;
        }

        return $map;
    }

    /** @param array<string, bool> $rows */
    private function on(array $rows, string $scope, string $type, string $capability): bool
    {
        return ($rows[$scope.'|'.$type.'|'.$capability] ?? false) === true;
    }
}
