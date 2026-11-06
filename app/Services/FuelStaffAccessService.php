<?php

namespace App\Services;

use App\Models\FuelStation;
use App\Models\Role;
use App\Models\User;
use App\Support\FuelStaffRevisionConflictException;
use App\Support\FuelStaffTemplates;
use App\Support\Rbac;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * FUEL-B3: إدارة صلاحيات موظفي محطات الوقود ونطاق محطاتهم — **فوق RBAC القائم** (جدول `roles` وسقف المنح `Rbac::covers`)، لا نظام موازٍ.
 *
 * النموذج: كل موظف وقود له **دور شخصي** (`fuel-staff-xxxxxxxx`) يُنسخ إليه القالب ثم تُعدَّل مفاتيحه فردياً؛ فتعديل صلاحيات موظف لا يمسّ غيره
 * (دور مشترك كان يغيّر كل حامليه). الدور الشخصي = (مفاتيحه غير الوقودية كما هي) ∪ (مفاتيح الوقود المطلوبة)، فلا يُسحب من الموظف ما ليس للوقود
 * ولا يُمنح ما ليس له.
 *
 * ═══ الحدود (كلها على الخادم، وكل رفض 403 يُدقَّق كمحاولة مرفوضة) ═══
 *  1. **ليس نفسه**: لا يعدّل الفاعل صلاحياته أو نطاقه (لا تصعيد ذاتي).
 *  2. **ليس المالك/المسؤول الأعلى**: كل هدف يملك `*` (أو دوره owner/admin) محجوب.
 *  3. **موظف وقود فقط**: صلاحياته غير الوقودية ⊆ خط الأساس (`staff` ∪ `self_service`)؛ من يملك أكثر (محاسب، موارد بشرية…) يُدار من شاشة المستخدمين العامة.
 *  4. **سقف المنح**: كل صلاحية **مضافة** يجب أن يغطيها الفاعل (`Rbac::covers`)، وصلاحياته الحالية فوق سقف الفاعل تمنع إدارته. المفتاحان
 *     المحجوزان (`fuel.governance.manage`، `fuel.staff.manage`) لا يمنحهما إلا حامل `*` — ولا يدخلان قالباً ولا «كل صلاحيات الوقود».
 *  5. **نطاق الفاعل**: لا يُدار مستخدم نطاقه (فرعاً/مخزناً/محطات) أوسع من نطاق الفاعل المقيَّد، ولا تُسنَد محطة خارج نطاقه.
 *  6. **التزامن**: صف المستخدم (ثم دوره) مقفول طوال المعاملة، و`expected_revision` اختياري يرفض (409) تعديلاً فوق حالة تغيّرت.
 *  7. **التدقيق**: حدث `fuel_staff.updated` بالفاعل والمستهدف والقبل/بعد داخل المعاملة نفسها.
 *
 * بعد أي تحديث يصير المستخدم `fuel_station_scope = assigned`: المحطات المسنَدة هي نطاقه، **وبلا محطة لا وصول** (فشل مغلق) — لا يُترك موظف يتلقى
 * قالباً مفتوح المحطات بالسهو.
 */
class FuelStaffAccessService
{
    public const ROLE_PREFIX = 'fuel-staff-';

    public function __construct(private AccessChangeAuditor $auditor) {}

    /** @return array<string, mixed> */
    public function templates(User $actor): array
    {
        $actorPermissions = Rbac::permissionsForRole($actor->role);
        $isTop = in_array('*', $actorPermissions, true);
        $delegable = array_values(array_filter(
            FuelStaffTemplates::catalog(),
            fn (string $key) => Rbac::covers($actorPermissions, [$key]) && ($isTop || ! in_array($key, FuelStaffTemplates::RESERVED, true)),
        ));

        return [
            'templates' => collect(FuelStaffTemplates::all())->map(fn (array $t, string $key) => [
                'key' => $key, 'label_ar' => $t['label_ar'], 'label_en' => $t['label_en'], 'permissions' => $t['permissions'],
                // ما يستطيع هذا الفاعل تفويضه منه فعلاً (الباقي يُرفض عند الإسناد).
                'assignable' => Rbac::covers($actorPermissions, $t['permissions']),
            ])->values()->all(),
            'catalog' => FuelStaffTemplates::catalog(),
            'delegable' => $delegable,
            'reserved' => FuelStaffTemplates::RESERVED,
        ];
    }

    /** @return list<array<string, mixed>> */
    public function list(User $actor): array
    {
        return User::where('tenant_id', $actor->tenant_id)
            ->where(fn ($q) => $q->where('fuel_station_scope', User::FUEL_SCOPE_ASSIGNED)->orWhere('role', 'like', self::ROLE_PREFIX . '%'))
            ->orderBy('name')->get()
            ->filter(fn (User $u) => $this->isVisibleTo($actor, $u))
            ->map(fn (User $u) => $this->view($u))
            ->values()->all();
    }

    /** @return array<string, mixed> */
    public function show(User $actor, string $userId): array
    {
        $target = $this->find($actor, $userId);
        if (! $this->isVisibleTo($actor, $target)) {
            throw new ModelNotFoundException(); // خارج النطاق/محجوب ⇒ 404 موحّد (لا كشف وجود)
        }

        return $this->view($target);
    }

    /**
     * يتحقق من وجود الهدف في مؤسسة الفاعل (404 موحّد لمعرّف مفقود أو لمستأجر آخر). **يُستدعى من المتحكم قبل `domain()`**: `ModelNotFoundException` ترث
     * `RuntimeException` فلو رُميت داخل `domain()` لصارت 422 بدل 404 (نفس درس `abort(404)` داخل `domain()`).
     */
    public function ensureTargetExists(User $actor, string $userId): void
    {
        $this->find($actor, $userId);
    }

    /**
     * @param  array<string, mixed>  $input  template? grant_all_fuel? add_permissions? remove_permissions? station_ids? expected_revision? reason?
     * @return array<string, mixed>
     */
    public function update(User $actor, string $userId, array $input): array
    {
        return DB::transaction(function () use ($actor, $userId, $input): array {
            $target = $this->find($actor, $userId, lock: true);
            $this->assertManageable($actor, $target);

            $currentRevision = $this->revision($target);
            if (($input['expected_revision'] ?? null) !== null && $input['expected_revision'] !== $currentRevision) {
                throw new FuelStaffRevisionConflictException($currentRevision);
            }

            $before = $this->state($target);
            $currentFull = Rbac::permissionsForRole($target->role);
            $currentFuel = $this->fuelKeys($currentFull);
            $actorPermissions = Rbac::permissionsForRole($actor->role);

            $desired = $this->desiredFuelPermissions($input, $currentFuel, $actorPermissions);
            $added = array_values(array_diff($desired, $currentFuel));
            $this->assertGrantable($actorPermissions, $added);

            $stationIds = array_key_exists('station_ids', $input) ? $this->resolveStations($actor, $target, (array) $input['station_ids']) : null;

            $role = $this->personalRoleFor($target);
            $role->permissions = FuelStaffTemplates::sorted([...array_values(array_diff($currentFull, $currentFuel)), ...$desired]);
            $role->name = mb_substr('موظف وقود — ' . $target->name, 0, 100);
            $role->save();

            $target->role = $role->slug;
            $target->fuel_station_scope = User::FUEL_SCOPE_ASSIGNED;
            $target->save();
            if ($stationIds !== null) {
                $target->fuelStations()->sync($stationIds);
            }

            $target->refresh();
            $this->auditor->record(
                'fuel_staff.updated', AccessChangeAuditor::SUBJECT_FUEL_STAFF, $target->id, $target->id,
                $before, $this->state($target), $actor, isset($input['reason']) ? (string) $input['reason'] : null,
            );

            return $this->view($target);
        });
    }

    // ───────────────────────── الحراس ─────────────────────────

    private function assertManageable(User $actor, User $target): void
    {
        if ($actor->id === $target->id) {
            throw new AuthorizationException('لا يمكنك تعديل صلاحياتك أو نطاق محطاتك بنفسك.');
        }
        $permissions = Rbac::permissionsForRole($target->role);
        if ($this->isTopAccount($target, $permissions)) {
            throw new AuthorizationException('حساب المالك أو المسؤول الأعلى لا يُدار من إدارة موظفي المحطات.');
        }
        if (array_diff(array_values(array_diff($permissions, $this->fuelKeys($permissions))), $this->baseline()) !== []) {
            throw new AuthorizationException('هذا المستخدم يملك صلاحيات خارج مجال محطات الوقود؛ يُدار من شاشة المستخدمين العامة.');
        }
        if (! Rbac::covers(Rbac::permissionsForRole($actor->role), $this->fuelKeys($permissions))) {
            throw new AuthorizationException('صلاحيات الوقود الحالية لهذا الموظف تتجاوز صلاحياتك.');
        }
        if (! $this->withinActorScope($actor, $target)) {
            throw new AuthorizationException('نطاق وصول هذا الموظف أوسع من نطاقك.');
        }
    }

    /** @param list<string> $added */
    private function assertGrantable(array $actorPermissions, array $added): void
    {
        $reserved = array_values(array_intersect($added, FuelStaffTemplates::RESERVED));
        if ($reserved !== [] && ! in_array('*', $actorPermissions, true)) {
            throw new AuthorizationException('منح صلاحيتَي حوكمة الوقود وإدارة موظفي المحطات حكرٌ على المالك أو المسؤول الأعلى.');
        }
        if (! Rbac::covers($actorPermissions, $added)) {
            throw new AuthorizationException('لا يمكنك منح صلاحياتٍ لا تملك حق تفويضها.');
        }
    }

    /** الهدف ظاهر للفاعل (للقراءة): ليس حساباً أعلى، ونطاقه ضمن نطاق الفاعل. */
    private function isVisibleTo(User $actor, User $target): bool
    {
        return ! $this->isTopAccount($target, Rbac::permissionsForRole($target->role)) && $this->withinActorScope($actor, $target);
    }

    /** نطاق الهدف (فرع/مستودع/محطات) ⊆ نطاق الفاعل في كل بُعد يقيّده. فاعل غير مقيَّد في بُعد لا يقيّده فيه. */
    private function withinActorScope(User $actor, User $target): bool
    {
        foreach ([
            [$actor->allowedBranchIds(), $target->allowedBranchIds()],
            [$actor->allowedWarehouseIds(), $target->allowedWarehouseIds()],
            [$actor->allowedFuelStationIds(), $target->allowedFuelStationIds()],
        ] as [$mine, $theirs]) {
            if ($mine !== null && ($theirs === null || array_diff($theirs, $mine) !== [])) {
                return false;
            }
        }

        return true;
    }

    /** @param list<string> $permissions */
    private function isTopAccount(User $target, array $permissions): bool
    {
        return in_array('*', $permissions, true) || in_array($target->role, ['owner', 'admin'], true);
    }

    // ───────────────────────── الحساب ─────────────────────────

    /**
     * @param  array<string, mixed>  $input
     * @param  list<string>  $currentFuel
     * @param  list<string>  $actorPermissions
     * @return list<string>
     */
    private function desiredFuelPermissions(array $input, array $currentFuel, array $actorPermissions): array
    {
        if (array_key_exists('template', $input)) {
            $base = $input['template'] === null
                ? []
                : (FuelStaffTemplates::permissions((string) $input['template']) ?? throw new RuntimeException('قالب صلاحيات غير معروف.'));
        } else {
            $base = $currentFuel; // بلا قالب جديد: تعديل فوق الحالي
        }

        $desired = $base;
        if (! empty($input['grant_all_fuel'])) {
            $desired = [...$desired, ...FuelStaffTemplates::grantableAll($actorPermissions)];
        }
        $desired = [...$desired, ...$this->requestedKeys($input['add_permissions'] ?? [])];

        return FuelStaffTemplates::sorted(array_values(array_diff($desired, $this->requestedKeys($input['remove_permissions'] ?? []))));
    }

    /**
     * @param  mixed  $keys
     * @return list<string>
     */
    private function requestedKeys(mixed $keys): array
    {
        $keys = array_values(array_unique(array_map('strval', (array) $keys)));
        foreach ($keys as $key) {
            if ($key === '*' || ! in_array($key, Rbac::PERMISSIONS, true) || ! FuelStaffTemplates::isFuelDomain($key)) {
                throw new RuntimeException('صلاحية غير معروفة أو خارج مجال محطات الوقود.');
            }
        }

        return $keys;
    }

    /**
     * @param  array<int, mixed>  $ids
     * @return list<string>
     */
    private function resolveStations(User $actor, User $target, array $ids): array
    {
        $ids = array_values(array_unique(array_map('strval', $ids)));
        $resolved = [];
        foreach ($ids as $id) {
            $station = FuelStation::query()->find($id);
            if ($station === null) {
                throw new RuntimeException('محطة غير موجودة في المؤسسة.'); // معرّف مستأجر آخر ≡ مفقود: لا كشف
            }
            if (! $actor->canAccessFuelStation($station)) {
                throw new AuthorizationException('لا يمكنك إسناد محطة خارج نطاقك.');
            }
            if (($station->branch_id !== null && ! $target->canAccessBranch($station->branch_id))
                || ($station->warehouse_id !== null && ! $target->canAccessWarehouse($station->warehouse_id))) {
                throw new RuntimeException('المحطة خارج فرع أو مستودع الموظف؛ لن يصل إليها فعلياً.');
            }
            $resolved[] = $station->id;
        }
        sort($resolved);

        return $resolved;
    }

    /** دور شخصي لهذا الموظف وحده: يُعاد استعمال دوره الشخصي إن لم يكن مشتركاً مع غيره، وإلا يُنشأ جديد. */
    private function personalRoleFor(User $target): Role
    {
        if (str_starts_with($target->role, self::ROLE_PREFIX)) {
            $role = Role::where('slug', $target->role)->lockForUpdate()->first();
            $sharedWithOthers = $role !== null
                && User::where('tenant_id', $target->tenant_id)->where('role', $role->slug)->where('id', '!=', $target->id)->exists();
            if ($role !== null && ! $sharedWithOthers) {
                return $role;
            }
        }

        do {
            $slug = self::ROLE_PREFIX . Str::lower(Str::random(8));
        } while (Role::where('slug', $slug)->exists());

        return new Role(['slug' => $slug, 'name' => 'موظف وقود', 'permissions' => [], 'is_system' => false]);
    }

    /** @return list<string> */
    private function baseline(): array
    {
        return array_values(array_unique([...Rbac::MATRIX['staff'], ...Rbac::MATRIX['self_service']]));
    }

    /**
     * @param  list<string>  $permissions
     * @return list<string>
     */
    private function fuelKeys(array $permissions): array
    {
        return FuelStaffTemplates::sorted(array_values(array_filter($permissions, fn (string $p) => $p !== '*' && FuelStaffTemplates::isFuelDomain($p))));
    }

    private function find(User $actor, string $userId, bool $lock = false): User
    {
        $query = User::where('tenant_id', $actor->tenant_id);
        if ($lock) {
            $query->lockForUpdate();
        }

        return $query->findOrFail($userId);
    }

    // ───────────────────────── العرض ─────────────────────────

    /** @return array<string, mixed> */
    private function state(User $target): array
    {
        $fuel = $this->fuelKeys(Rbac::permissionsForRole($target->role));

        return [
            'role' => $target->role,
            'template' => $this->detectTemplate($fuel),
            'fuel_permissions' => $fuel,
            'fuel_station_scope' => $target->fuel_station_scope,
            'station_ids' => $target->fuelStations()->pluck('fuel_stations.id')->sort()->values()->all(),
        ];
    }

    /** @return array<string, mixed> */
    private function view(User $target): array
    {
        return ['user' => ['id' => $target->id, 'name' => $target->name, 'email' => $target->email, 'is_active' => (bool) $target->is_active]]
            + $this->state($target)
            + ['revision' => $this->revision($target)];
    }

    /** @param list<string> $fuel */
    private function detectTemplate(array $fuel): string
    {
        foreach (FuelStaffTemplates::all() as $key => $template) {
            if ($template['permissions'] === $fuel) {
                return $key;
            }
        }

        return $fuel === [] ? 'none' : 'custom';
    }

    private function revision(User $target): string
    {
        $permissions = Rbac::permissionsForRole($target->role);
        sort($permissions);
        $stations = $target->fuelStations()->pluck('fuel_stations.id')->sort()->values()->all();

        return substr(sha1((string) json_encode([$target->role, $permissions, $target->fuel_station_scope, $stations])), 0, 16);
    }
}
