<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\PlatformLoginRequest;
use App\Models\PlatformAdministrator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

/**
 * مصادقة مساحة تشغيل المنصة.
 *
 * لا تستعمل هذا المتحكم `TenantContext` أو صلاحيات RBAC الخاصة بالمستأجرين؛
 * فهو مصدر الجلسة الوحيد لمسارات `/api/platform/*`.
 */
class PlatformAuthController extends ApiController
{
    private const TOKEN_TTL_DAYS = 7;

    public function login(PlatformLoginRequest $request): JsonResponse
    {
        $data = $request->validated();
        $administrator = PlatformAdministrator::where('email', $data['email'])->first();

        if (! $administrator || ! Hash::check($data['password'], $administrator->password)) {
            abort(422, 'بيانات دخول مدير المنصة غير صحيحة.');
        }

        if (! $administrator->is_active) {
            abort(403, 'حساب مدير المنصة غير مفعّل.');
        }

        $administrator->forceFill(['last_login_at' => now()])->save();

        return response()->json([
            'token'         => $this->issueToken($administrator),
            'administrator' => $this->payload($administrator),
        ]);
    }

    public function logout(Request $request): JsonResponse
    {
        $request->user()?->currentAccessToken()?->delete();

        return response()->json(['message' => 'تم تسجيل خروج مدير المنصة.']);
    }

    public function me(Request $request): JsonResponse
    {
        /** @var PlatformAdministrator $administrator */
        $administrator = $request->user();

        return response()->json(['administrator' => $this->payload($administrator)]);
    }

    private function issueToken(PlatformAdministrator $administrator): string
    {
        return $administrator
            ->createToken('platform-console', ['platform:read', 'platform:manage'], now()->addDays(self::TOKEN_TTL_DAYS))
            ->plainTextToken;
    }

    /** @return array{id: string, name: string, email: string} */
    private function payload(PlatformAdministrator $administrator): array
    {
        return [
            'id'    => $administrator->id,
            'name'  => $administrator->name,
            'email' => $administrator->email,
        ];
    }
}
