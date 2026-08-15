<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreUserRequest;
use App\Http\Requests\UpdateUserRequest;
use App\Http\Resources\UserResource;
use App\Models\Employee;
use App\Models\Tenant;
use App\Models\User;
use App\Support\PlanGate;
use App\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * إدارة مستخدمي المؤسسة (owner/admin فقط).
 * User لا يرث BaseModel، فالعزل يدوي بالـ tenant_id في كل استعلام.
 */
class UserController extends ApiController
{
    private function tenantId(): string
    {
        return app(TenantContext::class)->id();
    }

    /**
     * حراسة دور المالك: منح دور owner أو المساس بحساب owner قائم حكرٌ على owner.
     * يمنع تصعيد admin نفسه (أو غيره) إلى مالك، أو تعديل/حذف المالك من دونه.
     */
    private function guardOwnerRole(Request $request, ?User $target = null, ?string $newRole = null): void
    {
        $actorIsOwner = $request->user()->role === 'owner';

        if ($newRole === 'owner' && ! $actorIsOwner) {
            abort(403, 'منح دور المالك حكر على المالك.');
        }

        if ($target && $target->role === 'owner' && ! $actorIsOwner) {
            abort(403, 'لا يمكن تعديل حساب المالك إلا من مالك.');
        }
    }

    /**
     * تحقّق ربط الموظف بالمستخدم (`User ⊃ Employee`). لا فعل إن كان `null`
     * (غير مرسَل أو فكّ ربط). وإلا: الموظف يجب أن يخصّ المستأجر وألّا يكون
     * مرتبطاً بمستخدم آخر — فحسابُ دخولٍ واحد لكل موظف على الأكثر.
     *
     * يشمل الفحصُ المستخدمين المحذوفين ناعماً (`withTrashed`): صفُّهم يبقى في
     * القاعدة ويحجز القيد الفريد، فبلا ذلك كان الربط يمرّ هنا ثم يسقط بخطأ
     * قاعدة بيانات خام. (إعادة إتاحة موظفِ مستخدمٍ محذوف تُعالَج لاحقاً.)
     */
    private function assertLinkableEmployee(?string $employeeId, ?string $exceptUserId = null): void
    {
        if ($employeeId === null) {
            return;
        }

        // Employee يرث BaseModel، فالبحث معزولٌ بالمستأجر تلقائياً.
        if (! Employee::whereKey($employeeId)->exists()) {
            abort(422, 'الموظف غير موجود.');
        }

        $taken = User::withTrashed()
            ->where('tenant_id', $this->tenantId())
            ->where('employee_id', $employeeId)
            ->when($exceptUserId, fn ($q) => $q->where('id', '!=', $exceptUserId))
            ->exists();

        if ($taken) {
            abort(422, 'هذا الموظف مرتبط بمستخدم آخر بالفعل.');
        }
    }

    public function index(): JsonResponse
    {
        $users = User::where('tenant_id', $this->tenantId())->with('employee')->latest()->get();

        return UserResource::collection($users)->response();
    }

    public function store(StoreUserRequest $request): JsonResponse
    {
        $data = $request->validated();
        $this->guardOwnerRole($request, null, $data['role'] ?? null);
        $tenantId = $this->tenantId();

        // فرض حدّ الخطة لعدد المستخدمين
        $tenant = Tenant::find($tenantId);
        $limit = PlanGate::limit($tenant, 'users');
        if ($limit !== null && User::where('tenant_id', $tenantId)->count() >= $limit) {
            abort(422, "تجاوزت حدّ خطتك ({$limit} مستخدمين). رقِّ خطتك للمزيد.");
        }

        // البريد فريد عالمياً (الدخول بالبريد وحده)
        if (User::where('email', $data['email'])->exists()) {
            abort(422, 'البريد الإلكتروني مستخدم بالفعل.');
        }

        $this->assertLinkableEmployee($data['employee_id'] ?? null);

        $user = User::create([
            'tenant_id'   => $tenantId,
            'employee_id' => $data['employee_id'] ?? null,
            'name'        => $data['name'],
            'email'       => $data['email'],
            'password'    => $data['password'],
            'role'        => $data['role'],
            'is_active'   => $data['is_active'] ?? true,
        ]);

        return (new UserResource($user->load('employee')))->response()->setStatusCode(201);
    }

    public function update(UpdateUserRequest $request, string $id): JsonResponse
    {
        $user = User::where('tenant_id', $this->tenantId())->findOrFail($id);
        $data = $request->validated();
        $this->guardOwnerRole($request, $user, $data['role'] ?? null);

        if (empty($data['password'])) {
            unset($data['password']);
        }

        // الغياب يُبقي الربط الحالي؛ `null` صريحة تفكّه؛ ومعرّفٌ يُتحقّق ثم يُربط.
        $this->assertLinkableEmployee($data['employee_id'] ?? null, $user->id);

        $user->update($data);

        return (new UserResource($user->load('employee')))->response();
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        if ($request->user()->id === $id) {
            abort(422, 'لا يمكنك حذف حسابك الخاص.');
        }

        $user = User::where('tenant_id', $this->tenantId())->findOrFail($id);
        $this->guardOwnerRole($request, $user);
        $user->delete();

        return response()->json(['message' => 'تم الحذف.']);
    }
}
