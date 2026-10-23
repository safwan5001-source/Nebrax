<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

/**
 * ضابط مشغّل لإجراءات المساعد — IMP-X-01a. نموذج تشغيلي للمنصة (كنماذج `Platform*`): بلا نطاق مستأجر تلقائي لأن صف المنصة بلا `tenant_id` ولأن مدير
 * المنصة لا يمرّ بـ`SetTenant`. العزل بقراءة صريحة بالمستأجر في الخدمتين وبقيود القاعدة.
 *
 * `enabled` و`version` لا يتغيّران بالنموذج: التغيير الوحيد بحدث تدقيق (`AiActionControlEvent`) يطبّقه مُشغّل القاعدة. لا حذف.
 * الافتراضي رفض: غياب الصف = `enabled = false` (قرار المالك D-11).
 */
class AiActionControl extends Model
{
    use HasUuids;

    public const SCOPE_PLATFORM = 'platform';
    public const SCOPE_TENANT = 'tenant';

    /** المفتاح الرئيسي على مستوى المنصة (كل الأنواع). */
    public const ALL_TYPES = '*';

    /** المعاينة والمراجعة (قراءة وتجهيز مسودات؛ لا تكتب بيانات مجال). */
    public const CAPABILITY_USE = 'use';

    /** التشغيل الوحيد الذي يكتب بيانات المجال (`run`/`retry`). */
    public const CAPABILITY_EXECUTION = 'execution';

    public const CAPABILITIES = [self::CAPABILITY_USE, self::CAPABILITY_EXECUTION];

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = ['scope', 'tenant_id', 'action_type', 'capability', 'enabled'];

    protected function casts(): array
    {
        return [
            'enabled' => 'boolean',
            'version' => 'integer',
        ];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('حالة ضابط إجراءات المساعد تتغيّر بحدث تدقيق فقط.'));
        static::deleting(fn () => throw new LogicException('ضابط إجراءات المساعد لا يُحذف.'));
    }

    public function events(): HasMany
    {
        return $this->hasMany(AiActionControlEvent::class, 'control_id');
    }
}
