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
 * - **أقل امتياز:** قراءات بالبادئات، وكتابات بقائمة (طريقة+مسار) صريحة؛ الوظائف الإدارية (أصول المحطة، الأسعار، صلاحيات الموظفين وPIN، إعدادات الحوكمة،
 *   المبيعات، التصحيح، الرصيد الافتتاحي) مرفوضة لجلسة PIN حتى لمدير/مالك — تتطلب جلسة كاملة.
 */
final class StationSessionBoundary
{
    public const ABILITY = 'station-ops';

    public const TOKEN_NAME = 'station-ops';

    /**
     * قراءات (GET/HEAD) مسموحة لجلسة PIN: ما يعرضه التطبيق للبائع والمشرف فقط. **ليس منها** `staff*` (إدارة الصلاحيات) ولا `settings`
     * على مستوى المؤسسة ولا الحسابات/التسويات/الأجهزة/الرصيد الافتتاحي…
     */
    private const READ_PREFIXES = [
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
        // تقارير الوقود (قراءة + تصدير): التفويض الدقيق والأعمدة الحسّاسة والنطاق يفرضها المحرك لكل مستخدم.
        'fuel-stations/report-center',
    ];

    /**
     * كتابات مسموحة لجلسة PIN — **قائمة صريحة (طريقة + مسار)** بما يفعله تطبيق المحطات فعلاً (تشغيل الورديات والقراءات والاستلام وقرارات الطلبات)،
     * لا بادئات. كل ما عداها يُرفض 403 مهما كانت صلاحيات RBAC لصاحب الحساب (مدير/مالك أيضاً): أصول المحطة (إنشاء/تعديل/حذف محطات ومضخات
     * وفوهات وخزانات ومنتجات)، الأسعار، المبيعات/تحصيلها، تصحيح الورديات، إعدادات المحطة (الحوكمة)، صلاحيات الموظفين وPIN، الرصيد الافتتاحي.
     * هذه وظائف إدارية تتطلب جلسة كاملة (بريد وكلمة مرور)؛ PIN من 6 أرقام عامل ضعيف لا يُفوَّض به تغيير صلاحيات أو إعدادات أو أصول.
     *
     * @var list<array{0: string, 1: string}> [طريقة، تعبير نمطي على الـURI المسجَّل]
     */
    private const WRITE_RULES = [
        ['POST', '#^api/fuel-stations/shifts/open$#'],
        ['POST', '#^api/fuel-stations/shifts/\{[a-zA-Z]+\}/(staff|meter-readings|tank-readings|cash-movements|close|collection|collection/review|cash-variance/review|approve)$#'],
        ['POST', '#^api/fuel-stations/readings$#'],
        ['POST', '#^api/fuel-stations/reading-requests/\{[a-zA-Z]+\}/(approve|reject)$#'],
        ['POST', '#^api/fuel-stations/deliveries$#'],
        ['POST', '#^api/fuel-stations/deliveries/\{[a-zA-Z]+\}/(approve|cost|attachments)$#'],
        ['DELETE', '#^api/fuel-stations/deliveries/\{[a-zA-Z]+\}/attachments/\{[a-zA-Z]+\}$#'],
        // تدقيق الطباعة/PDF/المشاركة من تطبيق المحطة (يسجّل حدثاً فقط، بلا أثر تشغيلي).
        ['POST', '#^api/fuel-stations/report-center/\{[a-zA-Z]+\}/audit$#'],
    ];

    /** مسارات عامة لازمة لأي جلسة (قراءة الهوية والخروج). */
    private const SESSION_RULES = [['GET', 'api/me'], ['POST', 'api/logout']];

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
        if (! self::routeAllowed($request->method(), $uri)) {
            return false;
        }

        return self::employeeStillActive($request->user());
    }

    /** هل (الطريقة، المسار المسجَّل) مسموح لجلسة PIN؟ قراءات بالبادئات، وكتابات بقائمة صريحة. */
    public static function routeAllowed(string $method, string $uri): bool
    {
        $method = strtoupper($method) === 'HEAD' ? 'GET' : strtoupper($method);
        $uri = ltrim($uri, '/');

        foreach (self::SESSION_RULES as [$m, $allowed]) {
            if ($m === $method && $allowed === $uri) {
                return true;
            }
        }
        if ($method === 'GET') {
            foreach (self::READ_PREFIXES as $prefix) {
                $full = 'api/' . $prefix;
                if ($uri === $full || str_starts_with($uri, $full . '/')) {
                    return true;
                }
            }

            return false;
        }
        foreach (self::WRITE_RULES as [$m, $pattern]) {
            if ($m === $method && preg_match($pattern, $uri) === 1) {
                return true;
            }
        }

        return false;
    }

    /** @return list<string> */
    public static function readPrefixes(): array
    {
        return self::READ_PREFIXES;
    }

    /** @return list<array{0: string, 1: string}> */
    public static function writeRules(): array
    {
        return self::WRITE_RULES;
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
