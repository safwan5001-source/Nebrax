<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

/**
 * تشغيلة مطابقة كشف طرف (IMP-PS-A2c، `CompanyWide`). **مشتقّة لا مصدر حقيقة مالية**: لا قيد ولا مستند ولا رصيد. غير قابلة للتعديل بعد الإنشاء؛
 * إعادة المطابقة بعد تغيّر الدفتر تُنشئ تشغيلة جديدة وتبقى القديمة (لا حذف).
 */
class PartnerStatementMatchRun extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id', 'reconciliation_id', 'engine_version', 'run_key', 'status', 'policy', 'scope', 'ledger_fingerprint', 'counts', 'created_by',
    ];

    protected $casts = ['policy' => 'array', 'scope' => 'array', 'counts' => 'array'];

    protected static function booted(): void
    {
        parent::booted();
        static::updating(static function (): void {
            throw new LogicException('تشغيلة المطابقة غير قابلة للتعديل بعد إنشائها.');
        });
    }

    public function matches(): HasMany
    {
        return $this->hasMany(PartnerStatementMatch::class, 'run_id');
    }
}
