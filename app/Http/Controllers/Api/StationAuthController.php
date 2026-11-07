<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StationLoginRequest;
use App\Models\Tenant;
use App\Services\StationPinCredentialService;
use App\Support\AuthUserPayload;
use App\Support\PlanGate;
use App\Tenancy\HostnameTenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\RateLimiter;

/**
 * STATION-PIN — دخول تطبيق «محطات أَوْج» برقم الموظف + PIN (6 أرقام) على مستخدمي أَوْج القائمين.
 *
 * - المستأجر من مضيف الطلب حصراً (لا من الجسم): على مضيف بلا مستأجر ⇒ 422 برسالة عامة.
 * - الجلسة المُصدَرة مقيَّدة بقدرة `station-ops` فلا تفتح واجهات أَوْج الإدارية (`StationSessionBoundary`)؛ الخروج بـ`POST /logout` القائم.
 * - كل فشل (مجهول/PIN غير مضبوط/خاطئ/غير نشط) برسالة واحدة. لا قفل حساب دائم: طبقة إغراق لكل عنوان (`station-pin-login`) + عدّ **الفشلات فقط**:
 *   (أ) لكل (مستأجر، رقم، عنوان) {@see self::IP_EMPLOYEE_MAX} فشلات/{@see self::IP_EMPLOYEE_DECAY} ث — يحجز المخمِّن من عنوانه لا الموظف من أجهزته الأخرى،
 *   (ب) سقف لكل (مستأجر، رقم) {@see self::GLOBAL_MAX} فشلاً/ساعة ضد الهجوم الموزَّع. المحجوب يتلقى 429 + `Retry-After` دون التحقق من الرمز (فلا يُستدل
 *   على صحته). الرقم المجهول يُحتسب كالمعروف. نجاح الدخول يصفّر عدّاد (أ) لهذا العنوان. النوافذ تنتهي وحدها.
 * - دخول البريد وكلمة المرور (`AuthController::login`) لا يتغيّر.
 */
class StationAuthController extends ApiController
{
    private const FAILURE = 'رقم الموظف أو رمز PIN غير صحيح.';

    public const IP_EMPLOYEE_MAX = 5;

    public const IP_EMPLOYEE_DECAY = 300;

    public const GLOBAL_MAX = 25;

    public const GLOBAL_DECAY = 3600;

    public function login(StationLoginRequest $request, StationPinCredentialService $credentials): JsonResponse
    {
        $data = $request->validated();

        if (app(HostnameTenantContext::class)->id() === null) {
            return response()->json(['message' => 'افتح التطبيق من رابط مؤسستك لتسجيل الدخول.', 'reason' => 'tenant_required'], 422);
        }

        $tenantId = (string) app(HostnameTenantContext::class)->id();
        $employee = mb_strtolower(StationPinCredentialService::normalizeEmployeeNumber($data['employee_no']));
        $perIp = "station-pin-fail|{$tenantId}|{$employee}|{$request->ip()}";
        $global = "station-pin-fail-global|{$tenantId}|{$employee}";

        foreach ([[$perIp, self::IP_EMPLOYEE_MAX], [$global, self::GLOBAL_MAX]] as [$key, $max]) {
            if (RateLimiter::tooManyAttempts($key, $max)) {
                return response()->json(['message' => 'محاولات خاطئة كثيرة. انتظر قليلاً ثم حاول مجدداً.', 'reason' => 'too_many_attempts'], 429)
                    ->header('Retry-After', (string) RateLimiter::availableIn($key));
            }
        }

        $user = $credentials->verify($data['employee_no'], $data['pin']);
        if (! $user) {
            RateLimiter::hit($perIp, self::IP_EMPLOYEE_DECAY);
            RateLimiter::hit($global, self::GLOBAL_DECAY);

            return response()->json(['message' => self::FAILURE, 'reason' => 'invalid_credentials'], 422);
        }
        RateLimiter::clear($perIp);

        $tenant = Tenant::find($user->tenant_id);
        if (! $tenant || ! $tenant->is_active || ! PlanGate::subscriptionActive($tenant)) {
            return response()->json(['message' => 'اشتراك المؤسسة غير نشط أو منتهٍ.', 'reason' => 'subscription_inactive'], 403);
        }

        return response()->json([
            'token' => $credentials->issueSession($user),
            'user'  => AuthUserPayload::for($user) + ['station_session' => true],
        ])->header('Cache-Control', 'no-store');
    }
}
