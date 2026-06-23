<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\LoginRequest;
use App\Http\Requests\RegisterRequest;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Support\PlanGate;
use App\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

class AuthController extends ApiController
{
    /** مدة صلاحية التوكن (أيام). */
    private const TOKEN_TTL_DAYS = 7;

    /** مدة التجربة المجانية عند التسجيل (أيام). */
    private const TRIAL_DAYS = 14;

    /**
     * تسجيل شركة جديدة + مالكها، وتهيئة دليل الحسابات، وإصدار توكن.
     */
    public function register(RegisterRequest $request): JsonResponse
    {
        $data = $request->validated();

        $tenant = Tenant::create([
            'name'          => $data['company_name'],
            'slug'          => $data['slug'],
            'vat_number'    => $data['vat_number'] ?? null,
            'plan'          => 'free',
            'trial_ends_at' => now()->addDays(self::TRIAL_DAYS),
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
            'token'  => $this->issueToken($user),
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
        if (! $user->is_active) {
            abort(403, 'الحساب غير مفعّل.');
        }
        if (! PlanGate::subscriptionActive($tenant)) {
            abort(403, 'اشتراك المؤسسة غير نشط أو منتهٍ.');
        }

        return response()->json([
            'token' => $this->issueToken($user),
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
        $tenant = Tenant::find(app(TenantContext::class)->id());

        return response()->json([
            'user'    => $this->userPayload($request->user()),
            'company' => $this->companyPayload($tenant),
        ]);
    }

    private function issueToken(User $user): string
    {
        return $user->createToken('api', ['*'], now()->addDays(self::TOKEN_TTL_DAYS))->plainTextToken;
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

    /** بيانات الشركة (البائع) لإظهارها في رأس المستندات كالفاتورة الضريبية. */
    private function companyPayload(?Tenant $tenant): ?array
    {
        if (! $tenant) {
            return null;
        }

        return [
            'name'       => $tenant->name,
            'vat_number' => $tenant->vat_number,
            'cr_number'  => $tenant->cr_number,
            'currency'   => $tenant->currency,
            'country'    => $tenant->country,
        ];
    }
}
