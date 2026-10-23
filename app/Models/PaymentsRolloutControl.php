<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

/**
 * ضابط تفعيل المدفوعات الإلكترونية — PAY-H1-02. نموذج تشغيلي للمنصة (كنماذج `Platform*`): بلا نطاق مستأجر تلقائي لأن صف المنصة بلا
 * `tenant_id` ولأن مدير المنصة لا يمرّ بـ`SetTenant`. العزل بقراءة صريحة بالمستأجر في `PaymentsRolloutControlService` وبقيود القاعدة.
 *
 * `enabled` و`version` لا يتغيّران بالنموذج: التغيير الوحيد بحدث تدقيق (`PaymentsRolloutControlEvent`) يطبّقه مُشغّل القاعدة؛
 * حارس النموذج رسالة أوضح قبل الوصول إليها. لا حذف.
 */
class PaymentsRolloutControl extends Model
{
    use HasUuids;

    public const SCOPE_PLATFORM = 'platform';
    public const SCOPE_TENANT = 'tenant';

    public const FEATURE_ONLINE_PAYMENTS = 'online_payments';

    public const FEATURES = [self::FEATURE_ONLINE_PAYMENTS];

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = ['scope', 'tenant_id', 'feature_key', 'enabled'];

    protected function casts(): array
    {
        return [
            'enabled' => 'boolean',
            'version' => 'integer',
        ];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('حالة ضابط التفعيل تتغيّر بحدث تدقيق فقط.'));
        static::deleting(fn () => throw new LogicException('ضابط التفعيل لا يُحذف.'));
    }

    public function events(): HasMany
    {
        return $this->hasMany(PaymentsRolloutControlEvent::class, 'control_id');
    }
}
