<?php

namespace App\Models;

use App\Tenancy\CompanyWide;

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
}
