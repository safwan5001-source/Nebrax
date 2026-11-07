<?php

namespace App\Support;

use App\Models\Employee;
use App\Models\User;
use Illuminate\Http\Request;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * حدّ جلسة تطبيق المحطات (STATION-PIN): توكن Sanctum بقدرة `station-ops` وحدها (بلا `*`) لا يعمل إلا على مسارات
 * تشغيل المحطات المسرودة هنا — وأي واجهة إدارية أخرى لأَوْج تردّ 403 مهما كانت صلاحيات المستخدم.
 *
 * - **مكان الفرض:** `SetTenant` — البوابة المشتركة لكل مسارات مستخدمي ERP، بما فيها ما تسجّله مزوّدو الخدمة خارج `routes/api.php` (مثل `pos-shifts`).
 * - **فشل مغلق:** أي توكن مستخدم بلا `*` وبلا `station-ops` مرفوض في كل مكان.
 * - **قائمة بيضاء بمسارات** (URI المسجَّل) لا بالأسماء: كل مسار جديد خارج القائمة محجوب افتراضياً. تُحرس بـ`StationSessionBoundaryTest`.
 * - **التفويض لا يتغيّر:** داخل القائمة يطبّق كل مسار RBAC + نطاق المستأجر/الفرع/المحطة كما لو دخل صاحبه بالبريد.
 * - **حياة الجلسة:** موظف غير نشط/محذوف ⇒ 403 عند أول طلب (لا ينتظر انتهاء التوكن). تعطيل المستخدم تغطّيه `SetTenant`.
 * - تعيين/تصفير PIN لا يُسمح به من جلسة PIN (تصعيد ضعيف العامل): خارج القائمة عمداً.
 */
final class StationSessionBoundary
{
    public const ABILITY = 'station-ops';

    public const TOKEN_NAME = 'station-ops';

    /** بادئات مسارات الوقود التي يستهلكها تطبيق المحطات فعلاً (مقابلة لعملاء `station-ops/*` في الواجهة). */
    private const FUEL_PREFIXES = [
        'fuel-stations/stations',
        'fuel-stations/products',
        'fuel-stations/pumps',
        'fuel-stations/nozzles',
        'fuel-stations/tanks',
        'fuel-stations/tank-levels',
        'fuel-stations/prices',
        'fuel-stations/shifts',
        'fuel-stations/sales',
        'fuel-stations/readings',
        'fuel-stations/reading-requests',
        'fuel-stations/deliveries',
        'fuel-stations/delivery-suppliers',
        'fuel-stations/staff',
    ];

    /** مسارات عامة لازمة لأي جلسة (قراءة الهوية والخروج). */
    private const SESSION_URIS = ['api/me', 'api/logout'];

    /** مسارات تُستثنى حتى لو وقعت تحت بادئة مسموحة. */
    private const DENIED_URI_SUFFIXES = ['/pin'];

    /**
     * هل الطلب بتوكن مستخدم **مقيَّد القدرات** (لا يحمل `*`)؟ يُقرأ من قدرات التوكن المخزَّنة (مصفوفة حقيقية)، لا من `can()`:
     * توكن اختبار `Sanctum::actingAs($user)` بلا قدرات (محاكاة) لا يحمل مصفوفة فلا يُعدّ مقيَّداً، فيبقى سلوك الاختبارات القائمة كما هو،
     * بينما كل توكن حقيقي يُصدره التطبيق إما `['*']` (دخول عادي) أو `['station-ops']` (جلسة محطة).
     */
    public static function isRestricted(Request $request): bool
    {
        $abilities = self::abilities($request);

        return $abilities !== null && ! in_array('*', $abilities, true);
    }

    public static function isStationSession(Request $request): bool
    {
        $abilities = self::abilities($request);

        return $abilities !== null && ! in_array('*', $abilities, true) && in_array(self::ABILITY, $abilities, true);
    }

    /** @return list<string>|null null = ليس توكناً مخزَّناً بقدرات (جلسة عادية/محاكاة) */
    private static function abilities(Request $request): ?array
    {
        $user = $request->user();
        if (! $user instanceof User) {
            return null;
        }
        $token = $user->currentAccessToken();
        if (! $token instanceof PersonalAccessToken) {
            return null;
        }
        $abilities = $token->getAttribute('abilities');

        return is_array($abilities) ? array_values($abilities) : null;
    }

    /** هل يُسمح لهذا الطلب (المقيَّد) بالمرور؟ */
    public static function allows(Request $request): bool
    {
        if (! self::isStationSession($request)) {
            return false; // توكن مقيَّد لا نعرفه ⇒ مرفوض
        }

        $uri = ltrim((string) $request->route()?->uri(), '/');
        if ($uri === '') {
            return false;
        }
        if (! self::uriAllowed($uri)) {
            return false;
        }

        return self::employeeStillActive($request->user());
    }

    public static function uriAllowed(string $uri): bool
    {
        $uri = ltrim($uri, '/');
        if (in_array($uri, self::SESSION_URIS, true)) {
            return true;
        }
        foreach (self::DENIED_URI_SUFFIXES as $suffix) {
            if (str_ends_with($uri, $suffix)) {
                return false;
            }
        }
        foreach (self::FUEL_PREFIXES as $prefix) {
            $full = 'api/' . $prefix;
            if ($uri === $full || str_starts_with($uri, $full . '/')) {
                return true;
            }
        }

        return false;
    }

    /** @return list<string> */
    public static function allowedPrefixes(): array
    {
        return self::FUEL_PREFIXES;
    }

    private static function employeeStillActive(User $user): bool
    {
        if ($user->employee_id === null) {
            return false;
        }

        return Employee::query()
            ->withoutGlobalScopes() // لا يعتمد على سياق مستأجر محيط؛ الشرط الصريح أدناه هو الحدّ
            ->where('tenant_id', $user->tenant_id)
            ->where('id', $user->employee_id)
            ->where('is_active', true)
            ->exists();
    }
}
