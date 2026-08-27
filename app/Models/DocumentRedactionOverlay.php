<?php

namespace App\Models;

use App\Services\DocumentCenter\DocumentRedactionProjector;
use App\Tenancy\BranchContext;
use App\Tenancy\BranchScoped;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** Tombstone عرضي فقط؛ لا يخزّن القيمة المحجوبة ولا يغيّر extraction evidence. */
class DocumentRedactionOverlay extends BaseModel
{
    use BranchScoped;

    public const REASONS = [
        'privacy_request',
        'legal_review',
        'sensitive_metadata',
        'operational_restriction',
    ];

    protected $fillable = [
        'document_extraction_result_id',
        'field_path',
        'reason_code',
        'created_by',
        'redacted_at',
    ];

    protected function casts(): array
    {
        return ['redacted_at' => 'immutable_datetime'];
    }

    protected static function booted(): void
    {
        static::creating(function (self $overlay): void {
            $tenant = app(TenantContext::class);
            $branch = app(BranchContext::class);
            if (! $tenant->has() || ! $branch->has()) {
                throw new LogicException('Document redaction overlays require trusted tenant and branch contexts.');
            }
            if (! in_array($overlay->reason_code, self::REASONS, true)) {
                throw new LogicException('Document redaction reason is not permitted.');
            }
            $result = DocumentExtractionResult::query()->findOrFail($overlay->document_extraction_result_id);
            if ($result->tenant_id !== $tenant->id() || $result->branch_id !== $branch->id()) {
                throw new LogicException('Document redaction result scope must match the trusted context.');
            }
            if (! DocumentRedactionProjector::allows($overlay->field_path)) {
                throw new LogicException('Document redaction field is not permitted.');
            }

            $overlay->tenant_id = $tenant->id();
            $overlay->branch_id = $branch->id();
            $overlay->redacted_at ??= now('UTC');
        });

        static::updating(fn () => throw new LogicException('Document redaction overlays are append-only.'));
        static::deleting(fn () => throw new LogicException('Document redaction overlays are retained as governance evidence.'));
    }

    public function result(): BelongsTo
    {
        return $this->belongsTo(DocumentExtractionResult::class, 'document_extraction_result_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
