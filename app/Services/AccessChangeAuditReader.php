<?php

namespace App\Services;

use App\Models\AccessChangeEvent;
use App\Models\Role;
use App\Models\User;
use App\Support\Rbac;
use Carbon\Carbon;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;

/**
 * FUEL-B4: قراءة سجل `access_change_events` — **قراءة فقط** (لا كتابة ولا تعديل ولا حذف، ويحرسها أصلاً مشغّلات القاعدة والنموذج).
 *
 * النطاق (على الخادم، لا على الواجهة):
 *  - حامل `*` (المالك/المسؤول الأعلى): كل الأحداث (أدوار ومستخدمون وموظفو وقود).
 *  - غيره (يملك `fuel.staff.manage`): أحداث `fuel_staff` فقط، وحصراً لموظفين يراهم في إدارة الموظفين (نطاقه) **أو** محاولاته هو؛
 *    لا أحداث الأدوار والمستخدمين العامة ولا موظف خارج نطاقه.
 *
 * العرض: لا تُعاد لقطات `before/after` الخام. يُحسب **ملخص** بمفاتيح مسموحة فقط (قوائم صلاحيات/محطات كـ«أضيف/أزيل»، وقيم بسيطة
 * مقتصرة على نصوص قصيرة/منطقية)، وأي قيمة محجوبة (`[redacted]`) تُهمل. لا بريد ولا كلمة مرور ولا رمز في أي حقل.
 */
class AccessChangeAuditReader
{
    /** مفاتيح تُعرض كقوائم (إضافة/إزالة). */
    private const LIST_KEYS = ['permissions', 'fuel_permissions', 'station_ids', 'fuel_station_ids', 'branch_ids', 'warehouse_ids', 'add_permissions', 'remove_permissions'];

    /** مفاتيح تُعرض كقيم بسيطة. */
    private const SCALAR_KEYS = ['template', 'role', 'name', 'is_active', 'is_system', 'fuel_station_scope', 'grant_all_fuel', 'employee_id', 'password_changed'];

    public function __construct(private FuelStaffAccessService $staff) {}

    /**
     * @param  array{outcome?: ?string, target_user_id?: ?string, from?: ?string, to?: ?string, per_page?: ?int}  $filters
     * @return array{data: list<array<string, mixed>>, meta: array<string, int>}
     */
    public function page(User $actor, array $filters): array
    {
        $query = AccessChangeEvent::query()->orderByDesc('occurred_at')->orderByDesc('id');

        if (! in_array('*', Rbac::permissionsForRole($actor->role), true)) {
            $visible = $this->staff->visibleStaffIds($actor);
            $query->where('subject_type', AccessChangeAuditor::SUBJECT_FUEL_STAFF)
                ->where(fn ($q) => $q->where('actor_id', $actor->id)->orWhereIn('target_user_id', $visible === [] ? ['-'] : $visible));
        }
        if (! empty($filters['outcome'])) {
            $query->where('outcome', $filters['outcome']);
        }
        if (! empty($filters['target_user_id'])) {
            $query->where('target_user_id', $filters['target_user_id']);
        }
        if (! empty($filters['from'])) {
            $query->where('occurred_at', '>=', Carbon::parse($filters['from']));
        }
        if (! empty($filters['to'])) {
            $to = Carbon::parse($filters['to']);
            $query->where('occurred_at', '<=', preg_match('/^\d{4}-\d{2}-\d{2}$/', trim($filters['to'])) ? $to->endOfDay() : $to);
        }

        /** @var LengthAwarePaginator $paginator */
        $paginator = $query->paginate((int) ($filters['per_page'] ?? 25));
        $events = $paginator->getCollection();

        $userIds = $events->flatMap(fn (AccessChangeEvent $e) => [$e->actor_id, $e->target_user_id])->filter()->unique()->values()->all();
        $users = User::whereIn('id', $userIds)->get(['id', 'name'])->keyBy('id');
        $roleIds = $events->where('subject_type', AccessChangeAuditor::SUBJECT_ROLE)->pluck('subject_id')->filter()->unique()->values()->all();
        $roles = $roleIds === [] ? collect() : Role::whereIn('id', $roleIds)->get(['id', 'name'])->keyBy('id');

        return [
            'data' => $events->map(fn (AccessChangeEvent $e) => $this->present($e, $users, $roles))->values()->all(),
            'meta' => [
                'current_page' => $paginator->currentPage(), 'last_page' => $paginator->lastPage(),
                'per_page' => $paginator->perPage(), 'total' => $paginator->total(),
            ],
        ];
    }

    /**
     * @param  \Illuminate\Support\Collection<string, User>  $users
     * @param  \Illuminate\Support\Collection<string, Role>  $roles
     * @return array<string, mixed>
     */
    private function present(AccessChangeEvent $e, $users, $roles): array
    {
        $isRole = $e->subject_type === AccessChangeAuditor::SUBJECT_ROLE;
        $target = null;
        if ($isRole && $e->subject_id !== null) {
            $name = $roles->get($e->subject_id)?->name ?? $this->scalar($e->after['name'] ?? $e->before['name'] ?? null);
            $target = ['kind' => 'role', 'id' => $e->subject_id, 'name' => is_string($name) ? $name : null];
        } elseif ($e->target_user_id !== null) {
            $target = ['kind' => 'user', 'id' => $e->target_user_id, 'name' => $users->get($e->target_user_id)?->name];
        }

        return [
            'id' => $e->id,
            'occurred_at' => $e->occurred_at?->toIso8601String(),
            'action' => $e->action,
            'subject_type' => $e->subject_type,
            'outcome' => $e->outcome,
            'actor' => $e->actor_id === null ? null : ['id' => $e->actor_id, 'name' => $users->get($e->actor_id)?->name],
            'target' => $target,
            'reason' => $e->reason,
            'denial_reason' => $e->denial_reason,
            'changes' => $this->changes($e),
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function changes(AccessChangeEvent $e): array
    {
        $before = (array) ($e->before ?? []);
        $after = (array) ($e->after ?? []);
        $attempted = $e->outcome === AccessChangeEvent::OUTCOME_DENIED;
        $out = [];

        foreach (array_unique([...array_keys($before), ...array_keys($after)]) as $key) {
            if (! is_string($key)) {
                continue;
            }
            $left = $before[$key] ?? null;
            $right = $after[$key] ?? null;
            if (in_array($key, self::LIST_KEYS, true)) {
                $l = $this->strings($left);
                $r = $this->strings($right);
                $added = $attempted ? $r : array_values(array_diff($r, $l));
                $removed = $attempted ? [] : array_values(array_diff($l, $r));
                if ($added !== [] || $removed !== [] || $attempted) {
                    $out[] = ['key' => $key, 'kind' => 'list', 'added' => $added, 'removed' => $removed, 'count' => count($r)];
                }
            } elseif (in_array($key, self::SCALAR_KEYS, true)) {
                $from = $this->scalar($left);
                $to = $this->scalar($right);
                if ($attempted || $from !== $to) {
                    $out[] = ['key' => $key, 'kind' => 'scalar', 'from' => $attempted ? null : $from, 'to' => $to];
                }
            }
        }

        return $out;
    }

    /** @return list<string> قائمة نصوص قصيرة فقط (معرّفات/مفاتيح)، ويُهمل المحجوب. */
    private function strings(mixed $value): array
    {
        if (! is_array($value)) {
            return [];
        }
        $items = [];
        foreach ($value as $item) {
            if ((is_string($item) || is_int($item)) && (string) $item !== AccessChangeAuditor::REDACTED && mb_strlen((string) $item) <= 100) {
                $items[] = (string) $item;
            }
        }
        sort($items);

        return array_values(array_unique($items));
    }

    private function scalar(mixed $value): string|bool|null
    {
        if (is_bool($value) || $value === null) {
            return $value;
        }
        if (is_string($value) && $value !== AccessChangeAuditor::REDACTED) {
            return mb_substr($value, 0, 100);
        }

        return null;
    }
}
