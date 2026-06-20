<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\LoginRequest;
use App\Http\Requests\RegisterRequest;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

class AuthController extends ApiController
{
    /**
     * تسجيل شركة جديدة + مالكها، وتهيئة دليل الحسابات، وإصدار توكن.
     */
    public function register(RegisterRequest $request): JsonResponse
    {
        $data = $request->validated();

        $tenant = Tenant::create([
            'name'       => $data['company_name'],
            'slug'       => $data['slug'],
            'vat_number' => $data['vat_number'] ?? null,
        ]);

        app(TenantContext::class)->set($tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($tenant->id);

        $user = User::create([
            'tenant_id' => $tenant->id,
            'name'      => $data['name'],
            'email'     => $data['email'],
            'password'  => $data['password'],
            'role'      => 'owner',
        ]);

        return response()->json([
            'token'  => $user->createToken('api')->plainTextToken,
            'user'   => $this->userPayload($user),
            'tenant' => ['id' => $tenant->id, 'name' => $tenant->name, 'slug' => $tenant->slug],
        ], 201);
    }

    /**
     * دخول ضمن مستأجر محدّد (بالـ slug) — مُعزَل صراحةً بالـ tenant_id.
     */
    public function login(LoginRequest $request): JsonResponse
    {
        $data = $request->validated();

        $tenant = Tenant::where('slug', $data['slug'])->first();
        $user = $tenant
            ? User::where('tenant_id', $tenant->id)->where('email', $data['email'])->first()
            : null;

        if (! $user || ! Hash::check($data['password'], $user->password)) {
            abort(422, 'بيانات الدخول غير صحيحة.');
        }

        return response()->json([
            'token' => $user->createToken('api')->plainTextToken,
            'user'  => $this->userPayload($user),
        ]);
    }

    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json(['message' => 'تم تسجيل الخروج.']);
    }

    public function me(Request $request): JsonResponse
    {
        return response()->json(['user' => $this->userPayload($request->user())]);
    }

    private function userPayload(User $user): array
    {
        return [
            'id'        => $user->id,
            'name'      => $user->name,
            'email'     => $user->email,
            'role'      => $user->role,
            'tenant_id' => $user->tenant_id,
        ];
    }
}
