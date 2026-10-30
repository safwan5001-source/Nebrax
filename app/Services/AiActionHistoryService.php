<?php

namespace App\Services;

use App\Models\AiAction;
use App\Models\AiActionExecution;
use App\Models\AiActionExecutionRow;
use App\Models\AiActionVersion;
use App\Models\User;
use App\Support\AiActionException;
use App\Tenancy\BranchContext;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Collection;

/**
 * IMP-H8-S4a: قراءة سجلّ AI Actions للمؤسسة (قائمة مقسَّمة، قراءة فقط).
 *
 * لا بوابة أضعف من `AiActionGateway::show`: التفويض العام (المنصة/المؤسسة/الفاعل/`ai.actions.use`) يُفحص أولاً ويُرفض بخطئه،
 * ثم **لكل نوع مسجّل** يُعاد فحص بوابات النوع نفسها (صلاحيات المجال وقدرة التطبيق وضوابط المشغّل) عبر `AiActionPolicy::authorize`؛
 * النوع الذي يفشل فحصه يُستبعد من النتيجة (لا يُكشف وجوده) بدل رفض القائمة كلها. نطاق الفرع هو نطاق `assertBranchContext`:
 * سجلٌّ بلا فرع أو بفرع الطلب النشط فقط.
 *
 * لا تُعاد المقترحات ولا التكاليف ولا ملفات المعاينة: الصف ملخّص (العدّادات من `validation_summary` ونتيجة آخر تنفيذ). الحالة هي
 * المخزَّنة؛ انتهاء الصلاحية الزمني يتجسّد عند فتح السجل (`show`) لأن القائمة لا تكتب شيئاً.
 */
final class AiActionHistoryService
{
    public const DEFAULT_PER_PAGE = 15;

    public const MAX_PER_PAGE = 50;

    public function __construct(
        private readonly AiActionRegistry $registry,
        private readonly AiActionPolicy $policy,
        private readonly BranchContext $branchContext,
    ) {}

    /**
     * @param array{type?:?string,status?:?string,mine?:?bool,from?:?string,to?:?string} $filters
     * @return array{page:LengthAwarePaginator,versions:Collection<string,AiActionVersion>,executions:Collection<string,array<string,mixed>>}
     */
    public function list(User $requestActor, array $filters, int $perPage): array
    {
        // التفويض العام بلا نوع: يرفع نفس أخطاء `show` (platform_disabled / tenant_not_enabled / permission_denied …).
        $actor = $this->policy->authorize((string) $requestActor->id, AiActionPolicy::USE, []);

        $types = [];
        foreach ($this->registry->types() as $type) {
            $definition = $this->registry->definition($type);
            try {
                $this->policy->authorize((string) $actor->id, AiActionPolicy::USE, $definition['domain_permissions'], $definition['application_key'], $definition['type']);
            } catch (AiActionException) {
                continue;
            }
            $types[] = $type;
        }

        $perPage = max(1, min(self::MAX_PER_PAGE, $perPage));
        $branchId = $this->branchContext->id();

        $query = AiAction::query()
            ->with('creator:id,name')
            ->whereIn('type', $types === [] ? ['__none__'] : $types)
            ->where(function ($scope) use ($branchId): void {
                $scope->whereNull('branch_id');
                if ($branchId !== null) {
                    $scope->orWhere('branch_id', $branchId);
                }
            });

        if (! empty($filters['type'])) {
            $query->where('type', $filters['type']);
        }
        if (! empty($filters['status'])) {
            $query->where('status', $filters['status']);
        }
        if (! empty($filters['mine'])) {
            $query->where('created_by', $actor->id);
        }
        if (! empty($filters['from'])) {
            $query->where('created_at', '>=', $filters['from'].' 00:00:00');
        }
        if (! empty($filters['to'])) {
            $query->where('created_at', '<=', $filters['to'].' 23:59:59');
        }

        $page = $query->orderByDesc('created_at')->orderByDesc('id')->paginate($perPage);
        $actions = $page->getCollection();

        return [
            'page' => $page,
            'versions' => $this->latestVersions($actions),
            'executions' => $this->latestExecutions($actions),
        ];
    }

    /** @return Collection<string,AiActionVersion> بلا عمود `proposal` (قد يكون ضخماً ويحمل بيانات تكلفة). */
    private function latestVersions(Collection $actions): Collection
    {
        if ($actions->isEmpty()) {
            return collect();
        }

        return AiActionVersion::query()
            ->select(['id', 'tenant_id', 'ai_action_id', 'version', 'validation_summary'])
            ->where(function ($pairs) use ($actions): void {
                foreach ($actions as $action) {
                    $pairs->orWhere(fn ($pair) => $pair->where('ai_action_id', $action->id)->where('version', $action->version));
                }
            })
            ->get()
            ->keyBy('ai_action_id');
    }

    /** @return Collection<string,array<string,mixed>> آخر تنفيذ لكل سجل مع عدّاد صفوفه بحسب الحالة. */
    private function latestExecutions(Collection $actions): Collection
    {
        if ($actions->isEmpty()) {
            return collect();
        }

        $latest = AiActionExecution::query()
            ->select(['id', 'tenant_id', 'ai_action_id', 'status', 'retry_count', 'started_at', 'finished_at'])
            ->whereIn('ai_action_id', $actions->pluck('id'))
            ->orderBy('started_at')
            ->orderBy('id')
            ->get()
            ->groupBy('ai_action_id')
            ->map(fn (Collection $executions) => $executions->last());

        if ($latest->isEmpty()) {
            return collect();
        }

        $counts = AiActionExecutionRow::query()
            ->selectRaw('ai_action_execution_id, status, COUNT(*) as total')
            ->whereIn('ai_action_execution_id', $latest->pluck('id'))
            ->groupBy('ai_action_execution_id', 'status')
            ->get()
            ->groupBy('ai_action_execution_id');

        return $latest->map(fn (AiActionExecution $execution) => [
            'id' => $execution->id,
            'status' => $execution->status,
            'retry_count' => (int) $execution->retry_count,
            'started_at' => optional($execution->started_at)->toIso8601String(),
            'finished_at' => optional($execution->finished_at)->toIso8601String(),
            'rows' => ($counts->get($execution->id) ?? collect())
                ->mapWithKeys(fn ($row) => [(string) $row->status => (int) $row->total])
                ->all(),
        ]);
    }
}
