<?php

namespace App\Services\Reporting;

use App\Models\Account;
use App\Models\CashBankAccount;
use Illuminate\Support\Collection;

/**
 * مجموعة حسابات الأستاذ التي تُعدّ «نقداً وبنكاً» لمستأجر التقارير (TREASURY-T2). قراءة فقط، بنطاق المستأجر الحالي.
 *
 * التعريف = الحسابات المربوطة بكيانات `CashBankAccount` (خزائن وحسابات بنكية بكل حالاتها، فالمعطَّل يبقى لأن قيوده التاريخية
 * جزء من التدفق والرصيد) ∪ الحسابان النظاميان التاريخيان 1110/1120 إن وُجدا. لا يُفترض أن كل حساب يبدأ بـ111/112 نقدي:
 * مجموعتا 111/112 تجميعيتان، والانتماء يُحدَّد بالكيان لا بالرمز. ولا يُنشئ هذا شيئاً ولا يتراجع صامتاً إلى حساب آخر.
 *
 * يطابق النمط المستعمل في `VatRoleIntegrityService` و`ArApControlBalanceService` (كيانات ∪ 1110/1120)، ويصلح مصدراً واحداً
 * لكل تقرير يحتاج «النقد والبنك».
 */
class CashAccountResolver
{
    /** الحسابان النظاميان التاريخيان اللذان يُدرَجان حتى لو لم يُربطا بكيان بعد (مستأجر قديم أو تهيئة ناقصة). */
    public const LEGACY_CODES = ['1110', '1120'];

    /** @return Collection<int, string> معرّفات الحسابات، فريدة. */
    public function accountIds(): Collection
    {
        return CashBankAccount::query()->pluck('account_id')
            ->merge(Account::query()->whereIn('code', self::LEGACY_CODES)->pluck('id'))
            ->filter()
            ->unique()
            ->values();
    }
}
