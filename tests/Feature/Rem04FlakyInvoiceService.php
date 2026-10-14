<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\User;
use App\Services\Accounting\InvoiceService;
use Illuminate\Database\QueryException;
use PDOException;

/**
 * REM-04 — يحاكي ضحيةَ جمود PostgreSQL (SQLSTATE 40P01) **بعد** أن كتبت المعاملة كل أثرها
 * (قيد + ICV + حالة الفاتورة): الخطّاف في `settle()` — آخر خطوة داخل معاملة الترحيل — فيُثبت
 * الاختبار أن الإلغاء الكامل والإعادة لا يتركان أثراً جزئياً. لا يغيّر أي منطق مالي.
 */
class Rem04FlakyInvoiceService extends InvoiceService
{
    /** عدد المحاولات القادمة التي ستفشل بـ40P01. */
    public static int $failures = 0;

    /** عدد مرات الوصول إلى نقطة الحقن (= عدد محاولات المعاملة). */
    public static int $calls = 0;

    public static function reset(int $failures): void
    {
        self::$failures = $failures;
        self::$calls = 0;
    }

    protected function settle(Invoice $invoice, int $total, ?User $actor = null): void
    {
        self::$calls++;
        if (self::$failures > 0) {
            self::$failures--;
            $pdo = new PDOException('SQLSTATE[40P01]: Deadlock detected: 7 ERROR:  deadlock detected');
            $pdo->errorInfo = ['40P01', 7, 'deadlock detected'];

            throw new QueryException('pgsql', 'update "tenants" set …', [], $pdo);
        }

        parent::settle($invoice, $total, $actor);
    }
}
