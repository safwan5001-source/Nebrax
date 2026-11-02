<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use LogicException;

/**
 * مطالبة نهائية بحركة (قيد يومية) من مقارنة كشف طرف مُغلقة (IMP-PS-A3d، `CompanyWide`). تُكتب حصراً عبر `PartnerStatementClaimService` داخل معاملة الإغلاق،
 * و**لا تُعدَّل ولا تُحذف** (النموذج والقاعدة؛ إفراج A3e يفتح `released_at`). فهرس فريد جزئي في القاعدة يمنع مطالبتين فعّالتين على الحركة نفسها. **لا أثر مالي.**
 */
class PartnerStatementUnitClaim extends BaseModel implements CompanyWide
{
    public const UPDATED_AT = null;

    public const BASIS_PERIOD = 'period';

    public const BASIS_DECISION = 'decision';

    protected $fillable = ['tenant_id', 'reconciliation_id', 'partner_id', 'role', 'journal_entry_id', 'basis', 'line_id', 'claimed_at'];

    protected static function booted(): void
    {
        parent::booted();
        static::updating(static function (): void {
            throw new LogicException('المطالبة النهائية غير قابلة للتعديل (A3d؛ الإفراج مع A3e).');
        });
        static::deleting(static function (): void {
            throw new LogicException('المطالبة النهائية غير قابلة للحذف.');
        });
    }
}
