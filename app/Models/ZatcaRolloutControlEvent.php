<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * حدث تدقيق ثابت لتغيير ضابط تفعيل ZATCA — REM-18b-3a. إدراجه هو التغيير نفسه (مُشغّل القاعدة يطبّق الحالة الجديدة ذرّياً).
 * لا تحديث ولا حذف: حارس النموذج رسالة مبكرة، والحارس الفعلي مُشغّلات القاعدة (E1–E3).
 */
class ZatcaRolloutControlEvent extends Model
{
    use HasUuids;

    public $incrementing = false;

    public const UPDATED_AT = null;

    protected $keyType = 'string';

    protected $fillable = [
        'control_id', 'scope', 'tenant_id', 'feature_key', 'version', 'previous_enabled', 'new_enabled',
        'platform_administrator_id', 'reason', 'occurred_at',
    ];

    protected function casts(): array
    {
        return [
            'version' => 'integer',
            'previous_enabled' => 'boolean',
            'new_enabled' => 'boolean',
            'occurred_at' => 'immutable_datetime',
        ];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('حدث تدقيق ضابط التفعيل لا يتغيّر.'));
        static::deleting(fn () => throw new LogicException('حدث تدقيق ضابط التفعيل لا يُحذف.'));
    }

    public function control(): BelongsTo
    {
        return $this->belongsTo(ZatcaRolloutControl::class, 'control_id');
    }

    public function administrator(): BelongsTo
    {
        return $this->belongsTo(PlatformAdministrator::class, 'platform_administrator_id');
    }
}
