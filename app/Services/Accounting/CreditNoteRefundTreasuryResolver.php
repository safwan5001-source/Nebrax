<?php

namespace App\Services\Accounting;

use App\Models\CashBankAccount;
use App\Models\Invoice;
use App\Models\JournalLine;
use App\Models\User;
use App\Support\ResolvedTreasury;
use App\Support\TreasurySelection;
use App\Support\TreasurySelectionException;
use App\Support\TreasurySelectionPolicy;

/**
 * TREASURY-T5: الخزينة التي يُدائنها استرداد نقدي لإشعار دائن مبيعات — **مشتقّة من قيد البيع النقدي الأصلي** لا من الخزينة الرئيسية الحالية
 * (D-T5-1)، ويفعّل فقط حين تكون سياسة T4 الفعّالة غير `legacy` (بوابة T4 نفسها).
 *
 * القواعد (كلها فشل مغلق، بلا بديل صامت وبلا سقوط إلى 1110):
 *  1. المصدر فاتورة **نقدية** مرحَّلة مرتبطة؛ المستقل والمرتبط بفاتورة آجلة (بما فيها «مدفوع بالفعل» والـPOS) يُرفض مهما كانت سياسة
 *     المستأجر (`main` أو `explicit_required`) — البديل إشعار آجل ثم سند صرف (D-T5-2).
 *  2. تُستنتج الخزينة من سطور المدين في قيد البيع التي حسابها كيان خزينة؛ **واحد بالضبط** مقبول، صفر أو أكثر من واحد يُرفض
 *     (قد يحمل القيد سطر مدين ثانياً لتسوية سالبة — لا يُؤخذ «أول سطر مدين»).
 *  3. يُحلّ الاختيار بمحلِّل T3 (مستأجر/نوع نقد/كيان نشط/حساب أصل حركي) ثم يُفحص تخويل `withdraw` للفاعل — الاتجاه سحب لا إيداع.
 *  4. عملة الخزينة = عملة المؤسسة.
 *
 * قراءة فقط: لا كتابة ولا قفل ولا تهيئة (الكيان المشتقّ موجود حتماً)؛ يُستدعى قبل القيد فيتراجع كل شيء بلا ICV ولا مدخل سلسلة.
 */
class CreditNoteRefundTreasuryResolver
{
    public function __construct(
        protected TreasurySelectionResolver $resolver,
        protected TreasuryCurrencyGuard $currency,
    ) {}

    public function resolve(?Invoice $source, ?User $actor): ResolvedTreasury
    {
        if ($source === null || $source->payment_type !== 'cash' || $source->journal_entry_id === null || ! $source->isPosted()) {
            throw TreasurySelectionException::for(TreasurySelectionException::REFUND_SOURCE_REQUIRED);
        }

        $debited = JournalLine::query()
            ->where('journal_entry_id', $source->journal_entry_id)
            ->where('debit', '>', 0)
            ->pluck('account_id');

        // كيانات الخزينة (نشطة أو معطَّلة — التعطيل يُرفض لاحقاً بسببه الصريح لا بالغموض) على حسابات سطور المدين.
        $treasuryAccounts = CashBankAccount::query()->whereIn('account_id', $debited)->pluck('account_id')->unique()->values();
        if ($treasuryAccounts->count() !== 1) {
            throw TreasurySelectionException::for(TreasurySelectionException::SOURCE_TREASURY_UNRESOLVED);
        }

        $resolved = $this->resolver->resolve(
            TreasurySelection::ledgerAccount((string) $treasuryAccounts->first()),
            'cash',
            TreasurySelectionPolicy::ExplicitRequired,
            'withdraw',
            $actor,
        );
        $this->currency->assertMatchesTenant($resolved);

        return $resolved;
    }
}
