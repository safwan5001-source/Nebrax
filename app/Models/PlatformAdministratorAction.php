<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * سجل تدقيق ثابت لإجراء اتخذه مدير منصة على مستأجر (تغيير خطة/تجربة/حالة).
 *
 * يُنشأ حصراً من `PlatformTenantService`؛ لا تحديث ولا حذف بعد الإنشاء.
 */
class PlatformAdministratorAction extends Model
{
    use HasUuids;

    public const ACTION_PLAN_CHANGED = 'plan_changed';
    public const ACTION_TRIAL_EXTENDED = 'trial_extended';
    public const ACTION_ACTIVATED = 'activated';
    public const ACTION_DEACTIVATED = 'deactivated';
    public const ACTION_APPLICATION_GRANTED = 'application_granted';
    public const ACTION_APPLICATION_REVERTED = 'application_reverted';
    public const ACTION_APPLICATION_SHOWN = 'application_shown';
    public const ACTION_APPLICATION_HIDDEN = 'application_hidden';
    public const ACTION_APPLICATION_BULK = 'application_bulk';

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = [
        'platform_administrator_id',
        'tenant_id',
        'action',
        'from_value',
        'to_value',
    ];

    public function administrator(): BelongsTo
    {
        return $this->belongsTo(PlatformAdministrator::class, 'platform_administrator_id');
    }

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }
}
