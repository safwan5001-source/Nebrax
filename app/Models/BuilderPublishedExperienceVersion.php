<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  نسخة تجربة منشورة — AWJ App Builder (APP-BUILDER-1، AB-03)
 * ═══════════════════════════════════════════════════════════════
 *
 * **غير قابلة للتعديل أو الحذف إطلاقاً بعد الإنشاء** — الحارس هنا في
 * النموذج نفسه (لا في الخدمة وحدها) فلا يوجد مسار كودي يتجاوزه، مطابقاً
 * لنمط `TenantApplicationEvent::booted()` (سجلّ تدقيق ثابت) بلا استثناء
 * "حقل واحد قابل للتغيير" الذي يستعمله `CommercialProductVersion` — لا
 * حالة تقاعد/سحب في V1؛ ذلك يُنمذَج لاحقاً (APP-BUILDER-10) كنشر نسخة
 * جديدة فوقها، لا تعديلاً على صفّ قديم (`RUNTIME_COMPATIBILITY_V1.md` §15:
 * "Rollback means selecting/re-publishing a previously validated compatible
 * Experience").
 *
 * **`CompanyWide`**: يتبع تصنيف `builder_apps` رأسه.
 */
class BuilderPublishedExperienceVersion extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id', 'builder_app_id', 'version', 'schema', 'schema_version',
        'published_by', 'published_at', 'note',
    ];

    protected $casts = [
        'schema' => 'array',
        'version' => 'integer',
        'published_at' => 'immutable_datetime',
    ];

    protected static function booted(): void
    {
        static::updating(function (self $version): void {
            throw new LogicException('Published experience versions are immutable.');
        });
        static::deleting(function (self $version): void {
            throw new LogicException('Published experience versions cannot be deleted.');
        });
    }

    public function app(): BelongsTo
    {
        return $this->belongsTo(BuilderApp::class, 'builder_app_id');
    }

    public function publisher(): BelongsTo
    {
        return $this->belongsTo(User::class, 'published_by');
    }
}
