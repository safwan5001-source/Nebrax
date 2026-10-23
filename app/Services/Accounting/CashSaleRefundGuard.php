<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\Invoice;
use App\Models\JournalLine;
use RuntimeException;

/**
 * TREASURY-T4 (D-T4b): يمنع ردّاً نقدياً لا يطابق خزينة التحصيل الأصلية.
 *
 * الإشعار الدائن النقدي والمرتجع النقدي يُدائنان 1110 مرمَّزاً (TREASURY-T5/T6 لم تُنفَّذ بعد). فإن حُصِّل بيعٌ نقدي في
 * خزينة غير 1110 (توجيه T4 المفعَّل) ثم رُدَّ نقداً من 1110 تضخّمت تلك الخزينة وقد يصير 1110 سالباً. هذا الحارس **يرفض**
 * (فشل مغلق) ولا يبدّل حساباً ولا يوجّه الردّ: التوجيه الصحيح مهمة T5/T6.
 *
 * قراءة فقط: لا يكتب ولا يقفل ولا يمسّ قيداً تاريخياً. أثره صفر ما دام كل بيع نقدي مرحَّل على 1110 (كل ما قبل التفعيل
 * وكل مستأجر على `legacy`)، فلا يغيّر شيئاً في الإنتاج اليوم.
 */
class CashSaleRefundGuard
{
    private const LEGACY_CASH_CODE = '1110';

    /** @throws RuntimeException إن حُصِّلت الفاتورة النقدية المصدر في غير 1110 */
    public function assertCashRefundMatchesCollection(?Invoice $source): void
    {
        if ($source === null || $source->payment_type !== 'cash' || $source->journal_entry_id === null) {
            return;
        }

        $legacyId = Account::query()->where('code', self::LEGACY_CASH_CODE)->value('id');

        $debited = JournalLine::query()
            ->where('journal_entry_id', $source->journal_entry_id)
            ->where('debit', '>', 0)
            ->pluck('account_id');

        // قيد البيع النقدي سطر مدين واحد: إن لم يكن 1110 فالتحصيل في خزينة أخرى.
        if ($debited->isNotEmpty() && ($legacyId === null || ! $debited->contains($legacyId))) {
            throw new RuntimeException(
                'لا يمكن ردّ هذه الفاتورة نقداً: حُصِّلت في خزينة غير الصندوق 1110، وتوجيه الردّ النقدي إلى تلك الخزينة غير مدعوم بعد. '
                .'استخدم الردّ الآجل (رصيد للعميل) ثم صرف المبلغ بسند صرف من الخزينة المناسبة.'
            );
        }
    }
}
