<?php

namespace App\Support;

use Illuminate\Http\Request;

/**
 * أدوات Idempotency الخالصة للـ Public API: تحقّق المفتاح، تجزئته، وبصمة الطلب
 * المُقنّنة. لا حالة ولا وصول لقاعدة بيانات هنا (المطالبة/الإكمال/التحرير في
 * `EnforceApiIdempotency`) — فهذه دوال قابلة لإعادة الاستخدام والاختبار المباشر.
 *
 * مبدأ الخصوصية: المفتاح الخام لا يُخزَّن (تُخزَّن `hashKey`)، وجسم الطلب لا
 * يُخزَّن (تُخزَّن `fingerprint` = sha256 لتمثيلٍ مُقنّن). التقنين يجعل حمولتين
 * متكافئتين دلاليًا (ترتيب مفاتيح مختلف) تُنتجان البصمة نفسها.
 */
final class PublicApiIdempotency
{
    /** حدود المفتاح الوارد: طول ومحارف URL-safe محدودة. */
    public const KEY_MIN = 8;
    public const KEY_MAX = 255;
    private const KEY_PATTERN = '/^[A-Za-z0-9._:\-]{8,255}$/';

    /** أقصى حجم لجسم استجابة يُخزَّن لإعادة التشغيل (64KB — يسع نطاق text). */
    public const MAX_REPLAY_BYTES = 65535;

    /**
     * عقد إيجار (lease) سجلّ in_progress = مدى صلاحية `expires_at` أثناء التنفيذ.
     * ما دام سارياً، أيّ طلبٍ متزامنٍ بالمفتاح نفسه يُرفض (409 in_progress) فلا
     * تنفيذ مزدوج. لا يُستعاد السجلّ إلا بعد **انقضاء** الإيجار (طلبٌ انهار/انتهت
     * مهلته). يُختار الإيجار أطولَ من أقصى عمرٍ ممكنٍ لطلبٍ على هذه البنية (المهلة
     * القصوى لـ PHP/Render تقتل الطلب قبله بكثير)، فلا يُستعاد سجلٌّ لطلبٍ لا يزال
     * حيًّا. كتابةٌ قد تتجاوز الإيجار تحتاج تجديدَ إيجار/heartbeat — مؤجَّل حتى
     * توجد مسارات كتابة فعلية (PR-5)؛ PR-4 لا يضيف كتابةً.
     */
    public const IN_PROGRESS_LEASE_SECONDS = 900;

    /** الاحتفاظ الافتراضي لسجلّ idempotency **مكتمِل** (للإعادة) منذ إكماله. */
    public const RETENTION_HOURS = 48;

    public static function isValidKey(string $rawKey): bool
    {
        return preg_match(self::KEY_PATTERN, $rawKey) === 1;
    }

    /** تجزئة sha256 (64 hex) للمفتاح الخام — الخام لا يُخزَّن قطّ. */
    public static function hashKey(string $rawKey): string
    {
        return hash('sha256', $rawKey);
    }

    /**
     * بصمة الطلب: sha256 لسلسلة مُقنّنة = method + مسار + query مرتّب + جسم مُقنّن.
     * تُستعمل للكشف عن «نفس المفتاح بعمليةٍ/حمولةٍ مختلفة» ⇒ تعارض (409). لا
     * تُخزَّن الحمولة الخام — البصمة فقط.
     */
    public static function fingerprint(Request $request): string
    {
        return self::fingerprintParts(
            $request->getMethod(),
            $request->path(),
            $request->query(),
            $request->getContent(),
            (string) $request->headers->get('Content-Type', ''),
        );
    }

    /**
     * حساب البصمة من أجزاء صريحة — يتيح للاختبارات إعادة إنتاج البصمة ذاتها
     * لمحاكاة طلبٍ متزامنٍ سبق أن طالب بالمفتاح.
     *
     * @param  array<string, mixed>  $query
     */
    public static function fingerprintParts(
        string $method,
        string $path,
        array $query,
        string $rawBody,
        string $contentType = '',
    ): string {
        $canonical = implode("\n", [
            strtoupper($method),
            '/' . ltrim($path, '/'),
            // نوع الوسائط المطبَّع جزءٌ من البصمة: نفس البايتات بنوعٍ مختلف
            // (JSON مقابل text/plain) يفسّرها الخادم مختلفةً، فهي عمليةٌ مختلفة
            // ⇒ تعارض لا إعادة تشغيل.
            self::normalizeMediaType($contentType),
            self::canonicalArray($query),
            self::canonicalBody($rawBody, $contentType),
        ]);

        return hash('sha256', $canonical);
    }

    /** نوع الوسائط بلا معاملات (charset…)، صغيرًا ومُشذَّبًا — لبصمةٍ ثابتة. */
    private static function normalizeMediaType(string $contentType): string
    {
        $type = explode(';', $contentType, 2)[0];

        return strtolower(trim($type));
    }

    /** تقنين جسم JSON (ترتيب المفاتيح تعاوديًا)، وإلا البايتات الخام كما هي. */
    private static function canonicalBody(string $rawBody, string $contentType): string
    {
        if ($rawBody === '') {
            return '';
        }

        $looksJson = str_contains(strtolower($contentType), 'json')
            || (isset($rawBody[0]) && ($rawBody[0] === '{' || $rawBody[0] === '['));

        if ($looksJson) {
            $decoded = json_decode($rawBody, true);
            if (json_last_error() === JSON_ERROR_NONE && is_array($decoded)) {
                return self::canonicalArray($decoded);
            }
        }

        return $rawBody;
    }

    /** ترميز مصفوفة بترتيب مفاتيح مستقر تعاوديًا — لبصمة ثابتة. */
    private static function canonicalArray(array $data): string
    {
        self::ksortRecursive($data);

        return (string) json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    private static function ksortRecursive(array &$data): void
    {
        foreach ($data as &$value) {
            if (is_array($value)) {
                self::ksortRecursive($value);
            }
        }
        unset($value);

        ksort($data);
    }
}
