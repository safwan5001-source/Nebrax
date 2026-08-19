<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * نوع تسوية عهدة موظف: قائمة إعداد على مستوى المؤسسة.
 *
 * لا ينشئ النوع قيداً ولا يختار الحساب المدين بالنيابة عن المستخدم. دوره ضبط
 * اللغة التشغيلية للتسوية، وتمكين اختيار الأنواع النشطة فقط عند بناء الدورة.
 * @see design-system/foundations/multi-branch-architecture.md — إعداد مشترك للمؤسسة.
 */
class SettlementType extends BaseModel implements CompanyWide
{
    protected $fillable = ['tenant_id', 'name', 'description', 'is_active'];

    protected $casts = ['is_active' => 'boolean'];

    protected $attributes = ['is_active' => true];

    /** تسويات العُهَد المرتبطة بالنوع؛ وجودها يجعل الحذف غير آمن. */
    public function custodySettlements(): HasMany
    {
        return $this->hasMany(EmployeeCustodySettlement::class, 'settlement_type_id');
    }
}
