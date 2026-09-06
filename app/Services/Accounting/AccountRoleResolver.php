<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\AccountRoleMapping;
use App\Support\AccountingRoles;
use RuntimeException;

/**
 * يحلّ دوراً محاسبياً دلالياً إلى حساب فعلي للمستأجر النشط.
 *
 * **مسار حلٍّ واحد فقط: التعيين الصريح.** لا Transitional Legacy Fallback —
 * غياب التعيين أو فساده (حساب محذوف/معطّل/تجميعي) فشلٌ مغلق (`RuntimeException`)
 * دائماً، ولا يتحوّل صمتاً إلى بحثٍ بالكود القديم في `AccountingRoles`. الكود
 * القديم هناك قيمة افتراضية تُزرع صراحةً (`AccountRoleMappingSeeder`) — لا مسار
 * تنفيذ بديل هنا.
 *
 * **بلا مستهلك واحد في ACC-2**: بنية تحتية فقط. لا خدمة فوترة/مشتريات/دفع/
 * مرتجع/مخزون تستدعي هذا المحلِّل بعد — ذلك ACC-3 فما بعد.
 */
class AccountRoleResolver
{
    public function resolve(string $roleKey): Account
    {
        if (! AccountingRoles::exists($roleKey)) {
            throw new RuntimeException("دور محاسبي غير معروف: «{$roleKey}».");
        }

        $mapping = AccountRoleMapping::query()->where('role_key', $roleKey)->first();
        if ($mapping === null) {
            throw new RuntimeException("لا يوجد تعيين حساب صريح للدور «{$roleKey}».");
        }

        // تحقّق تعريفي بالمستأجر النشط — لا يُقبل UUID لمجرّد وجوده في مستأجر
        // آخر: whereKey يمرّ عبر TenantScope فلا يُرجع صفاً من مستأجر أجنبي.
        $account = Account::query()->whereKey($mapping->account_id)->first();
        if ($account === null) {
            throw new RuntimeException("الحساب المعيَّن للدور «{$roleKey}» لم يعد موجوداً.");
        }

        if (! $account->is_active) {
            throw new RuntimeException("الحساب المعيَّن للدور «{$roleKey}» معطَّل.");
        }

        if ($account->is_group) {
            throw new RuntimeException("الحساب المعيَّن للدور «{$roleKey}» حساب تجميعي ولا يقبل ترحيلاً مباشراً.");
        }

        return $account;
    }
}
