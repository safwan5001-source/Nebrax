<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\Invoice;
use App\Models\Payment;
use App\Models\PosSession;
use App\Models\User;
use App\Support\ResolvedTreasury;
use App\Support\TreasurySelection;
use App\Support\TreasurySelectionException;
use App\Support\TreasurySelectionPolicy;

/**
 * TREASURY-T6 (D-T6-1): الخزينة التي يُدائنها ردٌّ نقدي في نقطة البيع (مرتجع POS نقدي أو فائض استبدال نقدي) — **خزينة الجلسة
 * المثبَّتة وقت فتحها** (`pos_sessions.cash_account_id`، أي «الدرج»)، ويعمل فقط حين تكون سياسة T4 الفعّالة غير `legacy` (بوابة T4 نفسها).
 *
 * القواعد (كلها فشل مغلق، بلا بديل صامت وبلا سقوط إلى 1110 ولا إلى الرئيسية):
 *  1. الجلسة تحمل خزينة مثبَّتة (الجلسات القديمة بلا خزينة تُرفض — لا تلفيق ولا هجرة).
 *  2. الفاتورة المصدر تخصّ الجلسة نفسها (مرتجع POS يُشترط أصلاً بجلسة الفاتورة؛ هذا حارس ثانٍ).
 *  3. يُحلّ الحساب بمحلِّل T3 (نوع نقد/كيان نشط/حساب أصل حركي)، ثم تخويل **`withdraw`** للفاعل على الكيان المحلول، ثم عملة المؤسسة.
 *  4. **لا صرف عبر خزائن:** كل قبض نقدي مرحَّل على الفاتورة المصدر يجب أن يكون في خزينة الجلسة نفسها؛ أي قبض في خزينة أخرى (أو بلا خزينة
 *     مسجَّلة) ⇒ `refund_treasury_mismatch`. فاتورة بلا قبض نقدي (بطاقة فقط) لا تحمل خزينة تحصيل تُقارَن؛ ردّها نقداً يبقى محكوماً بسياسة
 *     POS الصريحة (`cash_refund_policy`) ورصيد الدرج، فيخرج من خزينة الجلسة كما تقرر تلك السياسة.
 *
 * لا كتابة ولا تهيئة ولا قفل مِرساة؛ يُستدعى قبل القيد فيتراجع كل شيء بلا ICV ولا مدخل سلسلة. يأخذ `FOR KEY SHARE` على حساب الخزينة
 * قبل قراءة حالة الكيان (كمحلِّل T5): التعطيل يبدأ بـ`FOR UPDATE` على الحساب نفسه فيسبق الترحيلَ فيُرفض أو ينتظر التزامه — لا يلتزم ردٌّ
 * بعد تعطيل خزينته ولا يقع جمود حساب↔مِرساة.
 */
class PosCashRefundTreasuryResolver
{
    public function __construct(
        protected TreasurySelectionResolver $resolver,
        protected TreasuryCurrencyGuard $currency,
    ) {}

    public function resolve(?PosSession $session, ?Invoice $source, ?User $actor): ResolvedTreasury
    {
        if ($session === null || $session->cash_account_id === null) {
            throw TreasurySelectionException::for(TreasurySelectionException::SESSION_TREASURY_REQUIRED);
        }
        if ($source === null || ! $source->isPosted() || $source->pos_session_id !== $session->id) {
            throw TreasurySelectionException::for(TreasurySelectionException::REFUND_SOURCE_REQUIRED);
        }

        $sessionAccountId = (string) $session->cash_account_id;

        // قبل أي قراءة لحالة الكيان (انظر رأس الصنف). على SQLite لا أثر للقفل.
        Account::query()->whereKey($sessionAccountId)->lock('for key share')->first();

        $resolved = $this->resolver->resolve(
            TreasurySelection::ledgerAccount($sessionAccountId),
            'cash',
            TreasurySelectionPolicy::ExplicitRequired,
            'withdraw',
            $actor,
        );
        $this->currency->assertMatchesTenant($resolved);

        $collected = Payment::query()
            ->where('invoice_id', $source->id)
            ->where('direction', 'received')
            ->where('status', 'posted')
            ->where('method', 'cash')
            ->pluck('cash_account_id');
        foreach ($collected as $accountId) {
            if ($accountId === null || (string) $accountId !== $sessionAccountId) {
                throw TreasurySelectionException::for(TreasurySelectionException::REFUND_TREASURY_MISMATCH);
            }
        }

        return $resolved;
    }
}
