<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreUserRequest;
use App\Http\Requests\UpdateUserRequest;
use App\Http\Resources\UserResource;
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

    public function index(): JsonResponse
    {
        $users = User::where('tenant_id', $this->tenantId())->latest()->get();

        return UserResource::collection($users)->response();
    }

    public function store(StoreUserRequest $request): JsonResponse
    {
        $data = $request->validated();
        $tenantId = $this->tenantId();

        // فرض حدّ الخطة لعدد المستخدمين
        $tenant = Tenant::find($tenantId);
        $limit = PlanGate::limit($tenant, 'users');
        if ($limit !== null && User::where('tenant_id', $tenantId)->count() >= $limit) {
            abort(422, "تجاوزت حدّ خطتك ({$limit} مستخدمين). رقِّ خطتك للمزيد.");
        }

        // البريد فريد داخل المؤسسة
        if (User::where('tenant_id', $tenantId)->where('email', $data['email'])->exists()) {
            abort(422, 'البريد الإلكتروني مستخدم بالفعل في هذه المؤسسة.');
        }

        $user = User::create([
            'tenant_id' => $tenantId,
            'name'      => $data['name'],
            'email'     => $data['email'],
            'password'  => $data['password'],
            'role'      => $data['role'],
            'is_active' => $data['is_active'] ?? true,
        ]);

        return (new UserResource($user))->response()->setStatusCode(201);
    }

    public function update(UpdateUserRequest $request, string $id): JsonResponse
    {
        $user = User::where('tenant_id', $this->tenantId())->findOrFail($id);
        $data = $request->validated();

        if (empty($data['password'])) {
            unset($data['password']);
        }

        $user->update($data);

        return (new UserResource($user))->response();
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        if ($request->user()->id === $id) {
            abort(422, 'لا يمكنك حذف حسابك الخاص.');
        }

        User::where('tenant_id', $this->tenantId())->findOrFail($id)->delete();

        return response()->json(['message' => 'تم الحذف.']);
    }
}
