<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * لقطة قراءة واحدة متسقة لمعاينة تقرّر ولا تكتب (P1-3a).
 *
 * على PostgreSQL وخارج أي معاملة قائمة: معاملة `REPEATABLE READ READ ONLY` تُرجَع دائماً، فتقرأ كل استعلامات الدالة من لقطة واحدة (بيع يُنهى بين استعلامين لا يظهر في
 * أحدهما دون الآخر فلا ازدواج احتساب). **لا قفل صفوف**: قراءات MVCC فقط، فلا تنتظر المعاينة أحداً ولا تحجب أحداً. داخل معاملة قائمة (اختبارات) أو على SQLite
 * (كاتب واحد) تعمل الدالة كما هي. العبارة الوحيدة المُصدَرة هي `SET TRANSACTION` للقراءة فقط؛ يحرس ذلك اختبار ساكن.
 */
final class ReadOnlySnapshot
{
    /**
     * @template T
     *
     * @param  callable():T  $callback
     * @return T
     */
    public static function run(callable $callback): mixed
    {
        if (DB::getDriverName() !== 'pgsql' || DB::transactionLevel() > 0) {
            return $callback();
        }

        DB::beginTransaction();
        try {
            DB::unprepared('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');

            return $callback();
        } finally {
            DB::rollBack();
        }
    }
}
