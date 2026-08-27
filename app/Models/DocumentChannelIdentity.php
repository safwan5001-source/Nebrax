<?php

namespace App\Models;

use App\Support\DocumentSourceChannel;
use App\Tenancy\BranchContext;
use App\Tenancy\BranchScoped;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

/** هوية قناة موثوقة تربط fingerprint غير سري بنطاق تشغيل محدد. */
class DocumentChannelIdentity extends BaseModel
{
    use BranchScoped;

    public const STATUS_ACTIVE = 'active';

    public const STATUS_DISABLED = 'disabled';

    protected $fillable = [
        'channel',
        'display_name',
        'external_identity_fingerprint',
        'external_identity_masked',
        'metadata',
        'created_by',
    ];

    protected $attributes = [
        'status' => self::STATUS_ACTIVE,
    ];

    protected function casts(): array
    {
        return [
            'channel' => DocumentSourceChannel::class,
            'metadata' => 'array',
            'disabled_at' => 'immutable_datetime',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (self $identity): void {
            $tenant = app(TenantContext::class);
            $branch = app(BranchContext::class);
            if (! $tenant->has() || ! $branch->has()) {
                throw new LogicException('Document channel identities require trusted tenant and branch contexts.');
            }

            $identity->tenant_id = $tenant->id();
            $identity->branch_id = $branch->id();
        });

        static::updating(function (self $identity): void {
            $allowed = ['display_name', 'metadata', 'status', 'disabled_by', 'disabled_at', 'updated_at'];
            if (array_diff(array_keys($identity->getDirty()), $allowed) !== []) {
                throw new LogicException('Document channel identity scope and external fingerprint are immutable.');
            }
        });

        static::deleting(function (self $identity): void {
            if ($identity->receipts()->exists() || $identity->auditEvents()->exists()) {
                throw new LogicException('Document channel identities with history must be disabled, not deleted.');
            }
        });
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function disabler(): BelongsTo
    {
        return $this->belongsTo(User::class, 'disabled_by');
    }

    public function receipts(): HasMany
    {
        return $this->hasMany(DocumentSourceReceiptRecord::class);
    }

    public function auditEvents(): HasMany
    {
        return $this->hasMany(DocumentSourceAuditEvent::class);
    }
}
