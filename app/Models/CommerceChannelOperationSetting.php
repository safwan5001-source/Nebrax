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

    /** COPS-H4-3 (D-OPS-7): سلوك ما خارج ساعات العمل — `accept` (الافتراضي، مفتوح) | `block` (يمنع إنشاء الطلبات الجديدة). */
    public const OUTSIDE_HOURS_ACCEPT = 'accept';

    public const OUTSIDE_HOURS_BLOCK = 'block';

    public const OUTSIDE_HOURS_POLICIES = [self::OUTSIDE_HOURS_ACCEPT, self::OUTSIDE_HOURS_BLOCK];

    /** COPS-H4-3 (D-OPS-8): نطاق الحد الأدنى — `all` (الافتراضي) | `delivery_only` (يُستثنى الاستلام من المتجر). */
    public const MIN_SCOPE_ALL = 'all';

    public const MIN_SCOPE_DELIVERY_ONLY = 'delivery_only';

    public const MIN_SCOPES = [self::MIN_SCOPE_ALL, self::MIN_SCOPE_DELIVERY_ONLY];

    protected $table = 'commerce_channel_operation_settings';

    /** عمداً فارغ: الكتابة عبر الخدمة بـforceFill فقط. */
    protected $fillable = [];

    protected function casts(): array
    {
        return [
            'acceptance_reminder_minutes' => 'integer',
            'acceptance_escalation_minutes' => 'integer',
            'accepting_orders' => 'boolean',
            'paused_until' => 'immutable_datetime',
            'min_order_minor' => 'integer',
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
