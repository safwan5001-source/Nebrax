<?php

namespace App\Services;

use App\Models\Employee;
use App\Models\User;
use App\Support\StationPin;
use App\Support\StationSessionBoundary;
use App\Tenancy\HostnameTenantContext;
use Illuminate\Support\Facades\Hash;

/**
 * تحقق بيانات دخول تطبيق المحطات (رقم الموظف + PIN) وإصدار جلسة المحطة، فوق مستخدمي أَوْج القائمين (لا جدول مستخدمين موازٍ).
 *
 * - المستأجر **من مضيف الطلب فقط** (`HostnameTenantContext`)؛ بلا مضيف مستأجر ⇒ فشل (لا بحث عابر للمستأجرين على مضيف مشترك).
 * - رقم الموظف الظاهر `employees.employee_no` (فريد لكل مستأجر) لا المعرّف الداخلي؛ المطابقة التامة ثم غير الحسّاسة لحالة الأحرف
 *   حين تكون واحدة بالضبط.
 * - كل فشل (رقم مجهول، PIN غير مضبوط، موظف/حساب غير نشط، PIN خاطئ) يعيد `null` نفسه، وتُنفَّق مقارنة تجزئة وهمية للمجهول فلا
 *   يتمايز الزمن بين «موجود» و«غير موجود».
 */
final class StationPinCredentialService
{
    /** تجزئة وهمية صالحة الشكل لمعادلة الزمن (تُحسب مرة لكل عملية). */
    private static ?string $dummyHash = null;

    public function verify(string $employeeNumber, string $pin): ?User
    {
        $tenantId = app(HostnameTenantContext::class)->id();
        if ($tenantId === null) {
            return null; // No cross-tenant employee-number lookup on a shared host.
        }

        $pin = StationPin::normalize($pin);
        if (! StationPin::isWellFormed($pin)) {
            return null;
        }

        $user = $this->findUser($tenantId, self::normalizeEmployeeNumber($employeeNumber));
        $hash = $user !== null && is_string($user->station_pin_hash) && $user->station_pin_hash !== ''
            ? $user->station_pin_hash
            : null;

        if ($hash === null) {
            Hash::check($pin, self::dummyHash()); // equalise timing

            return null;
        }

        return Hash::check($pin, $hash) ? $user : null;
    }

    /** يصدر توكن جلسة المحطة (قدرة `station-ops` وحدها) بمدة قصيرة. */
    public function issueSession(User $user): string
    {
        return $user->createToken(
            StationSessionBoundary::TOKEN_NAME,
            [StationSessionBoundary::ABILITY],
            now()->addHours((int) config('fuel_stations.station_session_hours', 12)),
        )->plainTextToken;
    }

    /** يلغي كل جلسات المحطة لهذا المستخدم (تغيير/تصفير PIN، إيقاف). جلسات الدخول العادية لأَوْج لا تُمسّ. */
    public function revokeSessions(User $user): int
    {
        return $user->tokens()->where('name', StationSessionBoundary::TOKEN_NAME)->delete();
    }

    public static function normalizeEmployeeNumber(string $input): string
    {
        $digits = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
        $input = str_replace(['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'], $digits, $input);
        $input = str_replace(['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'], $digits, $input);

        return trim($input);
    }

    private function findUser(string $tenantId, string $employeeNumber): ?User
    {
        if ($employeeNumber === '' || mb_strlen($employeeNumber) > 64) {
            return null;
        }

        // بلا نطاق عام: تسجيل الدخول لا يعتمد على سياق مستأجر محيط؛ الشرط الصريح `tenant_id` (من المضيف) هو الحدّ.
        $employee = Employee::query()
            ->withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('employee_no', $employeeNumber)
            ->where('is_active', true)
            ->first();

        if ($employee === null) {
            $matches = Employee::query()
                ->withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereRaw('lower(employee_no) = ?', [mb_strtolower($employeeNumber)])
                ->where('is_active', true)
                ->limit(2)
                ->get();
            $employee = $matches->count() === 1 ? $matches->first() : null;
        }

        if ($employee === null) {
            return null;
        }

        return User::query()
            ->where('tenant_id', $tenantId)
            ->where('employee_id', $employee->id)
            ->where('is_active', true)
            ->first();
    }

    private static function dummyHash(): string
    {
        return self::$dummyHash ??= Hash::make('000000-dummy');
    }
}
