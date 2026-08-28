<?php

namespace App\Models;

use App\Tenancy\CompanyWide;

/**
 * سبب منظم لعملية POS حساسة. بيانات رئيسية مشتركة للمؤسسة وليست دليلاً بحد ذاتها؛
 * يحفظ الحدث نسخة الاسم/الرمز وقت التنفيذ كي لا يضيع المعنى بعد تعديل الاسم أو التعطيل.
 */
class PosReasonCode extends BaseModel implements CompanyWide
{
    public const OTHER = 'other';

    protected $fillable = [
        'code', 'name_ar', 'name_en', 'requires_note', 'is_active',
    ];

    protected function casts(): array
    {
        return [
            'requires_note' => 'boolean',
            'is_active' => 'boolean',
        ];
    }
}
