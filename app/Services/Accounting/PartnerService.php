<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\JournalEntry;
use App\Models\Partner;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PartnerService — الأرصدة الافتتاحية للأطراف (عملاء/موردون)
 * ═══════════════════════════════════════════════════════════════
 *  رصيد افتتاحي لعميل (ذمة مدينة علينا لصالحنا):
 *    مدين  1130 العملاء (مربوط بالطرف)  / دائن 3130 الأرصدة الافتتاحية
 *  رصيد افتتاحي لمورّد (ذمة دائنة علينا):
 *    دائن  2110 الموردون (مربوط بالطرف) / مدين 3130 الأرصدة الافتتاحية
 *
 *  السطر المربوط بالطرف يظهر في كشف حساب الطرف. لا كتابة مباشرة في journal_lines.
 */
class PartnerService
{
    private const ACC_RECEIVABLE = '1130'; // العملاء
    private const ACC_PAYABLE     = '2110'; // الموردون
    private const ACC_OPENING     = '3130'; // الأرصدة الافتتاحية (حقوق ملكية)

    public function __construct(protected LedgerService $ledger) {}

    /**
     * يولّد قيد رصيد افتتاحي للطرف عبر المحرك (اتجاهه وفق نوع الطرف).
     * الموردون → ذمة دائنة (2110)؛ غير ذلك (عميل/كلاهما) → ذمة مدينة (1130).
     */
    public function recordOpeningBalance(Partner $partner, int $amount, ?string $date = null): ?JournalEntry
    {
        if ($amount <= 0) {
            return null;
        }

        $date    = $date ?? now()->toDateString();
        $opening = $this->accountId(self::ACC_OPENING);
        $tagged  = ['partner_type' => Partner::class, 'partner_id' => $partner->id];

        if ($partner->type === 'supplier') {
            $lines = [
                ['account_id' => $this->accountId(self::ACC_PAYABLE), 'credit' => $amount] + $tagged,
                ['account_id' => $opening, 'debit' => $amount],
            ];
        } else {
            $lines = [
                ['account_id' => $this->accountId(self::ACC_RECEIVABLE), 'debit' => $amount] + $tagged,
                ['account_id' => $opening, 'credit' => $amount],
            ];
        }

        return $this->ledger->post($lines, [
            'entry_date'  => $date,
            'description' => "رصيد افتتاحي: {$partner->name}",
            'source_type' => Partner::class,
            'source_id'   => $partner->id,
        ]);
    }

    protected function accountId(string $code): string
    {
        $account = Account::where('code', $code)->first();
        if (! $account) {
            throw new RuntimeException("الحساب بالكود {$code} غير موجود في دليل الحسابات.");
        }

        return $account->id;
    }
}
