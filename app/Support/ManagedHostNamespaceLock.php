<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * قفل استشاري (PostgreSQL advisory) يسلسل «تسجيل مستأجر جديد» مع «Backfill مضيفات متاجر مُدارة».
 *
 * المشكلة: فضاء أسماء المضيف المُدار مشترك بين جدولَين بقيدَين فريدَين مستقلَّين —
 * `tenants.slug` (المتجر الأول `{slug}.{base}`) و`storefront_domains.hostname`. فحص «هل الاسم
 * حرّ؟» ثم الإدراج في أحدهما لا يراه الآخر إن جرى بالتوازي ⇒ مستأجر وصفّ نطاق بنفس الشريحة.
 *
 * الحل بلا Schema: قفل استشاري على مستوى المعاملة بنمط قارئ/كاتب —
 *  - التسجيل يأخذ **المشترك** (`shared`): تسجيلات متعددة بالتوازي بلا تأثير على بعضها.
 *  - الـBackfill يأخذ **الحصري** (`exclusive`): ينتظر انتهاء التسجيلات الجارية (فيرى مستأجرها
 *    المُلتزَم عند فحصه) ويحجب التسجيلات الجديدة حتى يلتزم (فيرى تسجيلُها نطاقَه عند إعادة فحصه).
 * الفحص بعد أخذ القفل يعمل على READ COMMITTED فيرى كل ما التزمه الطرف الآخر.
 *
 * يُحرَّر القفل تلقائياً عند نهاية المعاملة. على غير PostgreSQL (SQLite للاختبار) لا يفعل شيئاً:
 * كتابة SQLite متسلسلة أصلاً.
 */
final class ManagedHostNamespaceLock
{
    /** مفتاح ثابت لهذا الفضاء ("AWJ-HOST" مشتقّاً) — bigint. */
    public const KEY = 7346128001;

    public static function shared(): void
    {
        self::lock('pg_advisory_xact_lock_shared');
    }

    public static function exclusive(): void
    {
        self::lock('pg_advisory_xact_lock');
    }

    private static function lock(string $fn): void
    {
        $conn = DB::connection();
        if ($conn->getDriverName() !== 'pgsql') {
            return;
        }
        // القفل «على مستوى المعاملة» بلا معاملة يُحرَّر فوراً فلا يحمي شيئاً — فشل مغلق صريح.
        if ($conn->transactionLevel() < 1) {
            throw new \LogicException('ManagedHostNamespaceLock يتطلب معاملة نشطة.');
        }
        $conn->select("select {$fn}(?)", [self::KEY]);
    }
}
