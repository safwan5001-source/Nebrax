<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StationLoginRequest;
use App\Models\Tenant;
use App\Services\StationPinCredentialService;
use App\Support\AuthUserPayload;
use App\Support\PlanGate;
use App\Tenancy\HostnameTenantContext;
use Illuminate\Http\JsonResponse;

/**
 * STATION-PIN — دخول تطبيق «محطات أَوْج» برقم الموظف + PIN (6 أرقام) على مستخدمي أَوْج القائمين.
 *
 * - المستأجر من مضيف الطلب حصراً (لا من الجسم): على مضيف بلا مستأجر ⇒ 422 برسالة عامة.
 * - الجلسة المُصدَرة مقيَّدة بقدرة `station-ops` فلا تفتح واجهات أَوْج الإدارية (`StationSessionBoundary`)؛ الخروج بـ`POST /logout` القائم.
 * - كل فشل (مجهول/PIN غير مضبوط/خاطئ/غير نشط) برسالة واحدة. لا قفل حساب دائم: الحماية من التخمين الآلي بتحديد المعدل
 *   (`station-pin-login`: لكل عنوان ولكل (مستأجر، رقم موظف)) ويحمل ردّ 429 `Retry-After`.
 * - دخول البريد وكلمة المرور (`AuthController::login`) لا يتغيّر.
 */
class StationAuthController extends ApiController
{
    private const FAILURE = 'رقم الموظف أو رمز PIN غير صحيح.';

    public function login(StationLoginRequest $request, StationPinCredentialService $credentials): JsonResponse
    {
        $data = $request->validated();

        if (app(HostnameTenantContext::class)->id() === null) {
            abort(422, 'افتح التطبيق من رابط مؤسستك لتسجيل الدخول.');
        }

        $user = $credentials->verify($data['employee_no'], $data['pin']);
        if (! $user) {
            abort(422, self::FAILURE);
        }

        $tenant = Tenant::find($user->tenant_id);
        if (! $tenant || ! $tenant->is_active || ! PlanGate::subscriptionActive($tenant)) {
            abort(403, 'اشتراك المؤسسة غير نشط أو منتهٍ.');
        }

        return response()->json([
            'token' => $credentials->issueSession($user),
            'user'  => AuthUserPayload::for($user) + ['station_session' => true],
        ])->header('Cache-Control', 'no-store');
    }
}
