<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreRoleRequest;
use App\Http\Resources\RoleResource;
use App\Models\Role;
use App\Models\User;
use App\Support\Rbac;
use App\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Str;

/**
 * أدوار الصلاحيات القابلة للضبط — مشروعٌ أمنيٌّ حسّاس. الثوابت غير القابلة للكسر:
 *
 *  1. دور `owner` غير قابل للمسّ (تعديلاً أو حذفاً) — يمنع حبس المالك خارج نظامه.
 *  2. الدور النظامي (`is_system`) لا يُحذف أبداً — يبقى ركيزة التوافق الرجعي.
 *  3. دورٌ يشير إليه مستخدمٌ لا يُحذف — لئلّا يصير مستخدمٌ بلا دور.
 *  4. الدور المخصَّص لا يملك `*` — الوصول الكامل محصورٌ في الأدوار النظامية.
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

    public function store(StoreRoleRequest $request): JsonResponse
    {
        $data = $request->validated();

        $role = Role::create([
            'slug'        => $this->uniqueSlug(),
            'name'        => trim($data['name']),
            'permissions' => array_values(array_unique($data['permissions'])),
            'is_system'   => false,
        ]);

        $role->users_count = 0;

        return (new RoleResource($role))->response()->setStatusCode(201);
    }

    public function update(StoreRoleRequest $request, string $id): JsonResponse
    {
        $role = Role::findOrFail($id);

        // المالك ثابتٌ لا يُمسّ — حمايةٌ من حبس المالك عن صلاحياته.
        if ($role->isOwner()) {
            abort(422, 'دور المالك محميّ ولا يقبل التعديل.');
        }

        $data = $request->validated();

        $role->update([
            'name'        => trim($data['name']),
            'permissions' => array_values(array_unique($data['permissions'])),
        ]);

        $role->users_count = User::where('tenant_id', $role->tenant_id)
            ->where('role', $role->slug)->count();

        return (new RoleResource($role))->response();
    }

    public function destroy(string $id): JsonResponse
    {
        $role = Role::findOrFail($id);

        if ($role->is_system) {
            abort(422, 'الأدوار النظامية لا تُحذف.');
        }

        // دورٌ مسنَدٌ لمستخدمٍ لا يُحذف — لئلّا يبقى مستخدمٌ بلا دور.
        // العزل يدويّ بالمستأجر (User لا يرث BaseModel).
        if (User::where('tenant_id', $role->tenant_id)->where('role', $role->slug)->exists()) {
            abort(422, 'لا يمكن حذف دورٍ مسنَدٍ إلى مستخدمين. أعِد إسنادهم أولاً.');
        }

        $role->delete();

        return response()->json(['message' => 'deleted']);
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
