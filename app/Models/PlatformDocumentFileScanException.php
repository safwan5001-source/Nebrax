<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

class PlatformDocumentFileScanException extends Model
{
    use HasUuids;

    public $incrementing = false;
    protected $keyType = 'string';

    protected $fillable = ['tenant_id', 'reason', 'granted_by', 'granted_at', 'expires_at', 'revoked_at', 'revoked_by', 'revocation_reason'];

    protected function casts(): array
    {
        return ['granted_at' => 'immutable_datetime', 'expires_at' => 'immutable_datetime', 'revoked_at' => 'immutable_datetime'];
    }

    public function tenant(): BelongsTo { return $this->belongsTo(Tenant::class); }
    public function admissions(): HasMany { return $this->hasMany(DocumentFileScanExceptionAdmission::class, 'platform_document_file_scan_exception_id'); }

    public function isActive(?\DateTimeInterface $at = null): bool
    {
        $at ??= now('UTC');
        return $this->revoked_at === null && ($this->expires_at === null || $this->expires_at->gt($at));
    }

    public function revoke(PlatformAdministrator $administrator, string $reason): void
    {
        if ($this->revoked_at !== null) {
            throw new LogicException('File scan exceptions cannot be reactivated or revoked twice.');
        }
        $this->forceFill(['revoked_at' => now('UTC'), 'revoked_by' => $administrator->id, 'revocation_reason' => trim($reason)])->save();
    }

    protected static function booted(): void
    {
        static::updating(function (self $exception): void {
            $grantFields = ['tenant_id', 'reason', 'granted_by', 'granted_at', 'expires_at'];
            if (collect($grantFields)->contains(fn (string $field): bool => $exception->isDirty($field))) {
                throw new LogicException('File scan exception grant fields are immutable.');
            }
            $revocationFields = ['revoked_at', 'revoked_by', 'revocation_reason'];
            $wasRevoked = $exception->getOriginal('revoked_at') !== null;
            if ($wasRevoked) {
                if (collect($revocationFields)->contains(fn (string $field): bool => $exception->isDirty($field))) {
                    throw new LogicException('File scan exception revocation is immutable after completion.');
                }
                return;
            }
            $revocationChanged = collect($revocationFields)->contains(fn (string $field): bool => $exception->isDirty($field));
            if ($revocationChanged && ($exception->revoked_at === null || blank($exception->revoked_by) || blank($exception->revocation_reason))) {
                throw new LogicException('File scan exception revocation must be a complete one-way transition.');
            }
            if ($revocationChanged && ! $exception->isDirty('revoked_at')) {
                throw new LogicException('File scan exception revocation must begin with revoked_at.');
            }
        });
        static::deleting(function (): void { throw new LogicException('File scan exception grants cannot be deleted.'); });
    }
}
