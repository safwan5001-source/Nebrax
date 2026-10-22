<?php

namespace App\Models;

use App\Tenancy\CompanyWide;

/**
 * معاينة استيراد أحادية الاستعمال (IMP-H1-S3b). يحفظها الخادم عند المعاينة وتُنفَق بإنشاء تشغيلة تنفيذية واحدة؛ لا تُكتب
 * من أي مسار سوى `ImportPreviewService`. مشتركة على مستوى المؤسسة كـ`ImportJob` (الفرع حقل ربط لا ملكية).
 */
class ImportPreview extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id', 'branch_id', 'user_id', 'domain',
        'file_sha256', 'archive_sha256', 'options', 'preview_hash',
        'expires_at', 'consumed_at', 'consumed_job_id',
    ];

    protected function casts(): array
    {
        return [
            'options' => 'array',
            'expires_at' => 'datetime',
            'consumed_at' => 'datetime',
        ];
    }
}
