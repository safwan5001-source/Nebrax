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
    /** عدد النداءات القادمة التي ستفشل بالرمز المحقون. */
    public static int $failures = 0;

    /** عدد مرات الوصول إلى نقطة الحقن (= عدد محاولات المعاملة؛ يجب أن يكون 1 — لا إعادة محاولة). */
    public static int $calls = 0;

    /** SQLSTATE المحقون (`40P01` جمود، `40001` تسلسل، أو أي رمز آخر لإثبات أنه يبقى 500). */
    public static string $sqlState = '40P01';

    public static function reset(int $failures, string $sqlState = '40P01'): void
    {
        self::$failures = $failures;
        self::$calls = 0;
        self::$sqlState = $sqlState;
    }

    protected function settle(Invoice $invoice, int $total, ?User $actor = null): void
    {
        self::$calls++;
        if (self::$failures > 0) {
            self::$failures--;
            // نص الرسالة يتبع الرمز: Laravel يصنّف التزامن أيضاً بنص الرسالة، فلا تحمل الرموز
            // الأخرى كلمة deadlock وإلا لالتبست بتعارض تزامن.
            $text = in_array(self::$sqlState, ['40P01', '40001'], true) ? 'deadlock detected' : 'injected database failure';
            $pdo = new PDOException('SQLSTATE['.self::$sqlState.']: '.$text);
            $pdo->errorInfo = [self::$sqlState, 7, $text];

            throw new QueryException('pgsql', 'update "tenants" set …', [], $pdo);
        }

        parent::settle($invoice, $total, $actor);
    }
}
