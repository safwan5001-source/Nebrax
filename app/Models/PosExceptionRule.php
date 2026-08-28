<?php

namespace App\Models;

use App\Tenancy\CompanyWide;

/**
 * قاعدة كشف رقابية قابلة للضبط لكل مؤسسة. إعداد مشترك (CompanyWide) لا دليل:
 * لكل تعديل يرتفع `version`، وتحفظ الاستثناءات لقطة الإصدار وقت الكشف كي يبقى
 * التفسير التاريخي ثابتاً بعد تغيير الإعداد. تعطيل قاعدة لا يحذف استثناءاتها.
 */
class PosExceptionRule extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'rule_key', 'category', 'is_enabled', 'weight', 'min_sample',
        'window_days', 'threshold', 'version', 'config',
    ];

    protected function casts(): array
    {
        return [
            'is_enabled' => 'boolean',
            'weight' => 'integer',
            'min_sample' => 'integer',
            'window_days' => 'integer',
            'threshold' => 'integer',
            'version' => 'integer',
            'config' => 'array',
        ];
    }

    /** لقطة الإعداد المجمّدة التي تُحفظ في الاستثناء وقت الكشف. */
    public function snapshot(): array
    {
        return [
            'rule_key' => $this->rule_key,
            'category' => $this->category,
            'version' => $this->version,
            'weight' => $this->weight,
            'min_sample' => $this->min_sample,
            'window_days' => $this->window_days,
            'threshold' => $this->threshold,
            'config' => $this->config ?? [],
        ];
    }
}
