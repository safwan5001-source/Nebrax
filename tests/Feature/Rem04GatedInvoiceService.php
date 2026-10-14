<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Services\Accounting\InvoiceService;
use Illuminate\Support\Facades\DB;

/**
 * خطّاف اختباري: بعد أن يأخذ `assertWithinCreditLimit()` قفل صف العميل يوقف العملية حتى
 * تُحجب العملية المنافسة على قفل (دليل ببنية `pg_stat_activity` لا بمهلة زمنية) أو تنتهي.
 * لا يغيّر أي منطق مالي؛ يعمل فقط داخل هذا الاختبار.
 */
class Rem04GatedInvoiceService extends InvoiceService
{
    public static string $dir = '';

    /** تحكّم اختباري: القفل القديم `FOR UPDATE` (الضابط السالب الذي يثبت أن الاختبار يرصد الجمود). */
    public static bool $legacyPartnerLock = false;

    protected function lockPartnerForCreditCheck(string $partnerId): ?\App\Models\Partner
    {
        if (! self::$legacyPartnerLock) {
            return parent::lockPartnerForCreditCheck($partnerId);
        }

        return \App\Tenancy\BranchScope::reference(\App\Models\Partner::class)->lockForUpdate()->find($partnerId);
    }

    protected function assertWithinCreditLimit(Invoice $invoice, int $total): void
    {
        parent::assertWithinCreditLimit($invoice, $total);

        $dir = self::$dir;
        file_put_contents($dir.'/a_partner_locked', '1');

        $deadline = microtime(true) + 20.0;
        while (microtime(true) < $deadline) {
            if (file_exists($dir.'/b_done')) {
                return; // لا تعارض: B أنهت دون حجب.
            }
            $pid = is_file($dir.'/b_pid') ? (int) file_get_contents($dir.'/b_pid') : 0;
            if ($pid > 0) {
                $blocked = DB::selectOne(
                    "select 1 as b from pg_stat_activity where pid = ? and wait_event_type = 'Lock'",
                    [$pid]
                );
                if ($blocked !== null) {
                    return; // B محجوبة على قفل نملكه — تابع (الدورة تتشكّل الآن إن وُجد ترتيب معاكس).
                }
            }
            usleep(2000);
        }

        throw new \RuntimeException('gate timeout: B neither finished nor blocked');
    }
}
