<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * إعدادات تشغيل قناة المتجر (COPS-H1-3، ADR-29 §2.5): صف واحد لكل قناة ويب، `CompanyWide`. **غيابه = السلوك الحالي حرفياً.**
 * الكاتب الوحيد `CommerceChannelOperationsSettingsService` (قفل صف القناة، `version`، تدقيق في `sales_channel_setting_events`) — لا يُكتب من
 * مكان آخر، ولذلك لا شيء من أعمدته في `$fillable`.
 */
class CommerceChannelOperationSetting extends BaseModel implements CompanyWide
{
    public const MODE_AUTO = 'auto';

    public const MODE_MANUAL = 'manual';

    public const MODES = [self::MODE_AUTO, self::MODE_MANUAL];

    protected $table = 'commerce_channel_operation_settings';

    /** عمداً فارغ: الكتابة عبر الخدمة بـforceFill فقط. */
    protected $fillable = [];

    protected function casts(): array
    {
        return [
            'acceptance_reminder_minutes' => 'integer',
            'acceptance_escalation_minutes' => 'integer',
            'version' => 'integer',
        ];
    }

    public function channel(): BelongsTo
    {
        return $this->belongsTo(SalesChannel::class, 'sales_channel_id');
    }

    public function updatedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'updated_by_user_id');
    }
}
