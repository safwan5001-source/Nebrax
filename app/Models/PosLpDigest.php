<?php

namespace App\Models;

use App\Tenancy\CompanyWide;

/**
 * الملخص الرقابي اليومي — منتج بيانات مشتقّ، حتمي وقابل لإعادة التوليد idempotent لكل
 * `(tenant_id, digest_date)`. صفّ واحد لكل تاريخ (لا لكل فرع) يحمل تفصيل الفروع داخل
 * `branch_breakdown`/`payload` JSON — انظر مصفوفة الفجوات لتبرير القرار. مصنَّف `CompanyWide`
 * (منتج تجميعي عابر للفروع، كالتقارير)، فلا يُعزل بفرع نشط.
 *
 * **مؤشرات المراجعة والاستثناءات تساعد في ترتيب أولوية التحقيق، ولا تُثبت وحدها وجود مخالفة.**
 */
class PosLpDigest extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'digest_date', 'timezone', 'period_start', 'period_end', 'generated_at', 'generated_by',
        'new_exceptions_count', 'priority_exceptions_count', 'amount_under_review_minor',
        'new_cases_count', 'unresolved_high_priority_cases_count', 'confirmed_loss_count',
        'confirmed_loss_minor', 'control_failure_count', 'material_variance_sessions_count',
        'data_sufficiency_caveats', 'branch_breakdown', 'payload',
    ];

    protected function casts(): array
    {
        return [
            // تنسيق صريح Y-m-d: الافتراضي يسلسل بصيغة التاريخ/الوقت الكاملة عند الكتابة
            // (القراءة فقط تُقصَّر لتاريخ) فيفشل تطابق `updateOrCreate`/`where('digest_date', ...)`
            // مع السلسلة النصية الخام المستعملة في مفتاح idempotency.
            'digest_date' => 'date:Y-m-d',
            'period_start' => 'datetime',
            'period_end' => 'datetime',
            'generated_at' => 'datetime',
            'amount_under_review_minor' => 'integer',
            'confirmed_loss_minor' => 'integer',
            'data_sufficiency_caveats' => 'array',
            'branch_breakdown' => 'array',
            'payload' => 'array',
        ];
    }
}
