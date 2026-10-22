<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * تشغيلة استيراد دائم — هوية الملف والتشغيلة قبل أي معالجة مجزّأة أو ربط
 * بمجال فعلي. انظر `DURABLE-IMPORTS-DECOMPOSITION.md` §4 لعقد PR-DUR-1 كاملاً.
 *
 * **مشترك عن قصد لا عن إغفال:** عملية استيراد على مستوى المؤسسة كلها، تماماً
 * كـ`barcode_registry`/`product_barcodes` — لا فرع يملكها.
 */
class ImportJob extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id', 'branch_id', 'preview_id', 'preview_hash', 'domain', 'status', 'idempotency_key',
        'original_filename', 'extension', 'mime_type', 'byte_size',
        'storage_disk', 'storage_path', 'content_sha256',
        'media_archive_original_filename', 'media_archive_mime_type',
        'media_archive_byte_size', 'media_archive_storage_path', 'media_archive_content_sha256',
        'row_count', 'column_count', 'error_message',
        'processed_rows', 'apply_options', 'apply_result',
        'created_by', 'cancelled_by',
        'queued_at', 'started_at', 'finished_at', 'cancelled_at', 'purge_after',
    ];

    protected function casts(): array
    {
        return [
            'byte_size' => 'integer',
            'media_archive_byte_size' => 'integer',
            'row_count' => 'integer',
            'column_count' => 'integer',
            'processed_rows' => 'integer',
            'apply_options' => 'array',
            'apply_result' => 'array',
            'queued_at' => 'datetime',
            'started_at' => 'datetime',
            'finished_at' => 'datetime',
            'cancelled_at' => 'datetime',
            'purge_after' => 'datetime',
        ];
    }

    /** وحدات التشغيلة الفاشلة/غير المنجزة (IMP-H1-S8a). */
    public function units(): HasMany
    {
        return $this->hasMany(ImportJobUnit::class, 'import_job_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function canceller(): BelongsTo
    {
        return $this->belongsTo(User::class, 'cancelled_by');
    }
}
