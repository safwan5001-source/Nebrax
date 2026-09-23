<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * ═══════════════════════════════════════════════════════════════
 *  مسودة تجربة تطبيق — AWJ App Builder (APP-BUILDER-1)
 * ═══════════════════════════════════════════════════════════════
 *
 * النسخة العاملة القابلة للتعديل لتجربة `BuilderApp`. صفٌّ واحد فقط لكل
 * تطبيق (`unique(builder_app_id)` في الترحيل) — الحفظ يُحدِّث هذا الصفّ
 * مكانه، لا ينشئ تاريخاً. النشر (`BuilderPublishedExperienceVersion`)
 * ينسخ لقطة من `schema` دون أن يمسّ هذا الصفّ أو يصفّره.
 *
 * **مفاتيح `schema` العليا المسموحة** مطابقة لـ`APP_SCHEMA_V1.md` §4
 * حرفياً. التحقق هنا سطحي فقط (مفاتيح معروفة + أنواع أساسية) — لا تحقق
 * عميق من محتوى `pages`/الإجراءات/الروابط (ذاك APP-BUILDER-2/3، بعد وجود
 * سجلّات المكوّنات/الإجراءات/الموارد فعلياً).
 */
class BuilderDraftExperience extends BaseModel implements CompanyWide
{
    /** مطابقة حرفية لـ APP_SCHEMA_V1.md §4 — لا هوية/إصدار هنا (أعمدة خادمية). */
    public const SCHEMA_KEYS = [
        'schemaVersion', 'locales', 'defaultLocale', 'theme', 'navigation', 'pages', 'assets', 'metadata',
    ];

    public const CURRENT_SCHEMA_VERSION = '1.0';

    protected $fillable = [
        'tenant_id', 'builder_app_id', 'schema', 'revision', 'updated_by',
    ];

    protected $casts = [
        'schema' => 'array',
        'revision' => 'integer',
    ];

    public function app(): BelongsTo
    {
        return $this->belongsTo(BuilderApp::class, 'builder_app_id');
    }

    public function updater(): BelongsTo
    {
        return $this->belongsTo(User::class, 'updated_by');
    }

    /**
     * الحدّ الأدنى الآمن الذي يوصّف به معمارية App Builder §5 مسار "البدء
     * من الصفر" — بلا صفحات/مكوّنات فعلية بعد (تلك APP-BUILDER-3/5+)، لكنه
     * مخطّط صالح بنيوياً يمرّ من أي محقّق سطحي منذ اللحظة الأولى.
     *
     * V1 (APP-BUILDER-1) يستعمل نفس اللقطة لكل مسارات الإنشاء الثلاثة —
     * التمايز الحقيقي (استيراد تصميم المتجر، محتوى القالب) مؤجَّلٌ صراحةً
     * إلى APP-BUILDER-8/9 (انظر توثيق ترحيل `builder_apps`).
     *
     * @return array<string, mixed>
     */
    public static function minimalSafeSchema(): array
    {
        return [
            'schemaVersion' => self::CURRENT_SCHEMA_VERSION,
            'locales' => ['ar', 'en'],
            'defaultLocale' => 'ar',
            'theme' => [],
            'navigation' => [],
            'pages' => [],
            'assets' => [],
            'metadata' => [],
        ];
    }
}
