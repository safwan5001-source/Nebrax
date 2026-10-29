<?php

namespace App\Models;

use App\Tenancy\CompanyWide;

/**
 * مطابقة أعمدة محفوظة لمعالج استيراد (IMP-H8-S2a). **مشتركة عن قصد:** إعداد على مستوى المؤسسة كلها (كمطابقة مورّد ثابت)، لا فرع يملكها — كـ`ImportJob`.
 * لا تحمل سياسات تشغيل ولا بيانات صفوف: عناوين أعمدة ومفاتيح حقول فقط.
 */
class ImportMappingPreset extends BaseModel implements CompanyWide
{
    protected $fillable = ['tenant_id', 'domain', 'name', 'name_key', 'columns', 'created_by'];

    protected function casts(): array
    {
        return ['columns' => 'array'];
    }
}
