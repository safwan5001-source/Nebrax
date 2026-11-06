<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreRoleRequest;
use App\Http\Resources\RoleResource;
use App\Models\Role;
use App\Models\User;
use App\Services\AccessChangeAuditor;
use App\Support\Rbac;
use App\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * أدوار الصلاحيات القابلة للضبط — مشروعٌ أمنيٌّ حسّاس. الثوابت غير القابلة للكسر:
 *
 *  1. دور `owner` غير قابل للمسّ (تعديلاً أو حذفاً) — يمنع حبس المالك خارج نظامه.
 *  2. الدور النظامي (`is_system`) لا يُحذف أبداً — يبقى ركيزة التوافق الرجعي.
 *  3. دورٌ يشير إليه مستخدمٌ لا يُحذف — لئلّا يصير مستخدمٌ بلا دور.
 *  4. الدور المخصَّص لا يملك `*` — الوصول الكامل محصورٌ في الأدوار النظامية.
 *  5. سقف المنح (AC-UX-00A): فاعلٌ بلا `*` لا يُنشئ ولا يعدّل دوراً بصلاحيات تتجاوز
 *     صلاحياته هو (دوره هو داخلاً)، ولا يعدّل دوراً قائماً يتجاوز سقفه — وإلا
 *     كان `roles.manage` طريقاً لترقية النفس فوق ما مُنح. وفاعلٌ مقيَّد بنطاق لا
 *     يعدّل دوراً مُسنَداً لمن نطاقه أوسع (الدور يُقرأ حيّاً لكل حامليه).
 */
class RoleController extends ApiController
{
    public function index(): JsonResponse
    {
        $roles = Role::query()
            ->orderByDesc('is_system')
            ->orderBy('name')
            ->get();

        // عدّ المستخدمين لكل دور بالـ slug — **العزل يدويّ**: User لا يرث
        // BaseModel، فبلا تصفية المستأجر يتسرّب العدّ عبر المؤسسات.
        $counts = User::where('tenant_id', app(TenantContext::class)->id())
            ->selectRaw('role, COUNT(*) as aggregate')
            ->groupBy('role')
            ->pluck('aggregate', 'role');

        $roles->each(fn (Role $r) => $r->users_count = (int) ($counts[$r->slug] ?? 0));

        return RoleResource::collection($roles)
            ->additional(['meta' => ['permissions' => Rbac::PERMISSIONS]])
            ->response();
    }

    /**
     * سقف المنح: يُقارَن ما سيُحفظ (والدور القائم إن وُجد) بصلاحيات الفاعل الفعلية.
     * الفاعل ذو `*` (owner/admin) لا يتأثر.
     *
     * @param array<int, string> $requested
     */
    private function guardGrantCeiling(Request $request, array $requested, ?Role $existing = null): void
    {
        $mine = Rbac::permissionsForRole($request->user()->role);

        if ($existing !== null && ! Rbac::covers($mine, $existing->permissions ?? [])) {
            abort(403, 'لا يمكنك تعديل دورٍ صلاحياته تتجاوز صلاحياتك.');
        }

        if (! Rbac::covers($mine, $requested)) {
            abort(403, 'لا يمكنك منح صلاحياتٍ تتجاوز صلاحياتك.');
        }

        // الدور مشتركٌ ويُقرأ حيّاً: فاعلٌ مقيَّد بنطاق لا يعدّل دوراً مُسنَداً لمن نطاقه
        // أوسع من نطاقه (أو غير مقيَّد)، وإلا ورث هذا المستخدم صلاحياتٍ خارج نطاق الفاعل.
        if ($existing !== null) {
            $actor = $request->user();
            $mineScope = [$actor->allowedBranchIds(), $actor->allowedWarehouseIds()];

            if ($mineScope !== [null, null]) {
                // العلاقتان تُحمَّلان دفعةً (استعلامان لا 2N+1)، والحساب على المجموعة المحمَّلة.
                User::with('branches', 'warehouses')
                    ->where('tenant_id', $existing->tenant_id)->where('role', $existing->slug)->get()
                    ->each(function (User $assignee) use ($mineScope): void {
                        $theirsBranches = $assignee->branches->pluck('id')->all() ?: null;
                        $theirsWarehouses = $assignee->warehouses->pluck('id')->all() ?: null;

                        foreach ([[$mineScope[0], $theirsBranches], [$mineScope[1], $theirsWarehouses]] as [$mine, $theirs]) {
                            if ($mine !== null && ($theirs === null || array_diff($theirs, $mine) !== [])) {
                                abort(403, 'لا يمكنك تعديل دورٍ مُسنَدٍ إلى مستخدمين نطاقهم أوسع من نطاقك.');
                            }
                        }
                    });
            }
        }
    }

    public function store(StoreRoleRequest $request): JsonResponse
    {
        $data = $request->validated();
        $auditor = app(AccessChangeAuditor::class);

        // FUEL-B3: التدقيق خارج معاملة الإنشاء (الرفض يُسجَّل بعد التراجع) وداخلها (الإنشاء الفعلي يُثبَّت مع أثره).
        $role = $auditor->guard('role.created', AccessChangeAuditor::SUBJECT_ROLE, null, null, $request->user(), $this->attempted($data), function () use ($request, $data, $auditor): Role {
            return DB::transaction(function () use ($request, $data, $auditor): Role {
                $this->guardGrantCeiling($request, $data['permissions']);

                $role = Role::create([
                    'slug'        => $this->uniqueSlug(),
                    'name'        => trim($data['name']),
                    'permissions' => array_values(array_unique($data['permissions'])),
                    'is_system'   => false,
                ]);
                $auditor->record('role.created', AccessChangeAuditor::SUBJECT_ROLE, $role->id, null, null, $this->snapshot($role), $request->user());

                return $role;
            });
        });

        $role->users_count = 0;

        return (new RoleResource($role))->response()->setStatusCode(201);
    }

    public function update(StoreRoleRequest $request, string $id): JsonResponse
    {
        $data = $request->validated();

        // صفّ الدور يُقفل داخل المعاملة نفسها التي تكتب، وإدارة المستخدمين تقفل الصفّ
        // نفسه قبل فحص سقف المنح (`UserController::canGrantRole`) — فلا يتّسع دورٌ بين
        // فحص تحديثٍ مفوَّض وكتابته.
        $auditor = app(AccessChangeAuditor::class);
        $role = $auditor->guard('role.updated', AccessChangeAuditor::SUBJECT_ROLE, $id, null, $request->user(), $this->attempted($data), fn () => DB::transaction(function () use ($request, $id, $data, $auditor): Role {
            $role = Role::lockForUpdate()->findOrFail($id);
            $before = $this->snapshot($role);

            // المالك ثابتٌ لا يُمسّ — حمايةٌ من حبس المالك عن صلاحياته.
            if ($role->isOwner()) {
                abort(422, 'دور المالك محميّ ولا يقبل التعديل.');
            }

            $this->guardGrantCeiling($request, $data['permissions'], $role);

            $role->update([
                'name'        => trim($data['name']),
                'permissions' => array_values(array_unique($data['permissions'])),
            ]);
            $auditor->record('role.updated', AccessChangeAuditor::SUBJECT_ROLE, $role->id, null, $before, $this->snapshot($role->refresh()), $request->user());

            return $role;
        }));

        $role->users_count = User::where('tenant_id', $role->tenant_id)
            ->where('role', $role->slug)->count();

        return (new RoleResource($role))->response();
    }

    public function destroy(string $id): JsonResponse
    {
        $actor = request()->user();
        $auditor = app(AccessChangeAuditor::class);

        $auditor->guard('role.deleted', AccessChangeAuditor::SUBJECT_ROLE, $id, null, $actor, null, function () use ($id, $actor, $auditor): void {
            $role = Role::findOrFail($id);

            if ($role->is_system) {
                abort(422, 'الأدوار النظامية لا تُحذف.');
            }

            // سقف المنح يشمل الحذف: فاعلٌ ممنوعٌ من تعديل دورٍ لا يُتلفه كذلك.
            if (! Rbac::covers(Rbac::permissionsForRole($actor->role), $role->permissions ?? [])) {
                abort(403, 'لا يمكنك حذف دورٍ صلاحياته تتجاوز صلاحياتك.');
            }

            // دورٌ مسنَدٌ لمستخدمٍ لا يُحذف — لئلّا يبقى مستخدمٌ بلا دور.
            // العزل يدويّ بالمستأجر (User لا يرث BaseModel).
            if (User::where('tenant_id', $role->tenant_id)->where('role', $role->slug)->exists()) {
                abort(422, 'لا يمكن حذف دورٍ مسنَدٍ إلى مستخدمين. أعِد إسنادهم أولاً.');
            }

            DB::transaction(function () use ($role, $actor, $auditor): void {
                $before = $this->snapshot($role);
                $role->delete();
                $auditor->record('role.deleted', AccessChangeAuditor::SUBJECT_ROLE, $role->id, null, $before, null, $actor);
            });
        });

        return response()->json(['message' => 'deleted']);
    }

    /** @return array<string,mixed> لقطة الدور للتدقيق: الاسم والصلاحيات (مرتّبة) والنظامية — بلا مستخدمين. */
    private function snapshot(Role $role): array
    {
        $permissions = array_values(array_unique($role->permissions ?? []));
        sort($permissions);

        return ['name' => $role->name, 'permissions' => $permissions, 'is_system' => (bool) $role->is_system];
    }

    /** ما حاوله الفاعل (اسم + مفاتيح صلاحيات). @return array<string,mixed> */
    private function attempted(array $data): array
    {
        $permissions = array_values(array_unique((array) ($data['permissions'] ?? [])));
        sort($permissions);

        return ['name' => $data['name'] ?? null, 'permissions' => $permissions];
    }

    /** مفتاحٌ داخليّ فريد للدور المخصَّص — الهوية المرئية هي `name` لا `slug`. */
    private function uniqueSlug(): string
    {
        do {
            $slug = 'role-' . Str::lower(Str::random(8));
        } while (Role::where('slug', $slug)->exists());

        return $slug;
    }
}
