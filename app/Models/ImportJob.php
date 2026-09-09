<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

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
        'tenant_id', 'domain', 'status', 'idempotency_key',
        'original_filename', 'extension', 'mime_type', 'byte_size',
        'storage_disk', 'storage_path', 'content_sha256',
        'row_count', 'column_count', 'error_message',
        'created_by', 'cancelled_by',
        'queued_at', 'started_at', 'finished_at', 'cancelled_at', 'purge_after',
    ];

    protected function casts(): array
    {
        return [
            'byte_size' => 'integer',
            'row_count' => 'integer',
            'column_count' => 'integer',
            'queued_at' => 'datetime',
            'started_at' => 'datetime',
            'finished_at' => 'datetime',
            'cancelled_at' => 'datetime',
            'purge_after' => 'datetime',
        ];
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
