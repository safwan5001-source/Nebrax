<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * وحدة فاشلة/غير منجزة من تشغيلة استيراد دائم (IMP-H1-S8a). لا تُكتب إلا من `ImportJobUnitRecorder` (والانتقال `failed → repaired`
 * من خدمة الإصلاح في S8b). مشتركة على مستوى المؤسسة كـ`ImportJob`.
 */
class ImportJobUnit extends BaseModel implements CompanyWide
{
    public const FAILED = 'failed';

    public const REPAIRED = 'repaired';

    protected $fillable = [
        'tenant_id', 'import_job_id', 'source_unit_ref', 'unit_ordinal',
        'status', 'error_code', 'error_message', 'repaired_by_job_id',
    ];

    protected function casts(): array
    {
        return ['unit_ordinal' => 'integer'];
    }

    public function job(): BelongsTo
    {
        return $this->belongsTo(ImportJob::class, 'import_job_id');
    }
}
