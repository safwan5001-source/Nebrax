<?php

namespace App\Services\Accounting;

use App\Models\Tenant;
use App\Support\ResolvedTreasury;
use App\Support\TreasurySelectionException;
use App\Tenancy\TenantContext;

/**
 * مصدر واحد لفحص «عملة الخزينة = عملة المؤسسة» في مسارات التوجيه النقدي (T4 البيع، T5 الاسترداد)، فلا ينحرف أحدهما عن الآخر.
 * مبالغ المستندات (وZATCA) بعملة المؤسسة؛ خزينة بعملة أخرى كانت ستسجَّل بها هللات المؤسسة على أنها عملتها فيفسد رصيدها.
 * فشل مغلق بلا تحويل ولا سقوط إلى 1110. قراءة فقط. لا يدخل في محلِّل T3 العام (عقده لا يعرف عملة المستند).
 */
class TreasuryCurrencyGuard
{
    /** @throws TreasurySelectionException ⇒ currency_mismatch */
    public function assertMatchesTenant(ResolvedTreasury $treasury): void
    {
        $tenantCurrency = (string) (Tenant::query()->whereKey(app(TenantContext::class)->id())->value('currency') ?: 'SAR');

        if (strcasecmp($treasury->currency, $tenantCurrency) !== 0) {
            throw TreasurySelectionException::for(TreasurySelectionException::CURRENCY_MISMATCH);
        }
    }
}
