<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use LogicException;

/**
 * FUEL-B3: حدث تدقيق لتغيير الأدوار والصلاحيات ونطاق الوصول، أو لمحاولة مرفوضة (`outcome = denied`).
 * append-only: النموذج هنا (طبقة أولى) والمشغّلات في القاعدة (الحارس الأخير ضد SQL الخام).
 * `CompanyWide`: الأدوار والمستخدمون يخصّون المؤسسة كلها لا فرعاً.
 */
class AccessChangeEvent extends BaseModel implements CompanyWide
{
    public const OUTCOME_APPLIED = 'applied';
    public const OUTCOME_DENIED = 'denied';

    protected $fillable = [
        'tenant_id', 'actor_id', 'target_user_id', 'subject_type', 'subject_id', 'action', 'outcome',
        'before', 'after', 'reason', 'denial_reason', 'occurred_at',
    ];

    protected $casts = ['before' => 'array', 'after' => 'array', 'occurred_at' => 'datetime'];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('حدث تدقيق الصلاحيات غير قابل للتعديل.'));
        static::deleting(fn () => throw new LogicException('حدث تدقيق الصلاحيات غير قابل للحذف.'));
    }
}
