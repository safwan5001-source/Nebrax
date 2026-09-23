<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * ═══════════════════════════════════════════════════════════════
 *  مسودة تجربة تطبيق — AWJ App Builder (APP-BUILDER-1/2)
 * ═══════════════════════════════════════════════════════════════
 *
 * النسخة العاملة القابلة للتعديل لتجربة `BuilderApp`. صفٌّ واحد فقط لكل
 * تطبيق (`unique(builder_app_id)` في الترحيل) — الحفظ يُحدِّث هذا الصفّ
 * مكانه، لا ينشئ تاريخاً. النشر (`BuilderPublishedExperienceVersion`)
 * ينسخ لقطة من `schema` دون أن يمسّ هذا الصفّ أو يصفّره.
 *
 * **مفاتيح `schema` العليا المسموحة** مطابقة حرفياً لعقد App Schema
 * **الحقيقي المُختبَر فعلياً** في `mobile/lib/schema/app_schema.dart`
 * (`AppSchema`)، لا الشكل التوضيحي في `APP_SCHEMA_V1.md` §4 (ذاك يصرّح
 * صراحةً أنه "contract candidates... not locked"). APP-BUILDER-2 صحّح هذا
 * — الشكل الأول في APP-BUILDER-1 (`locales`/`defaultLocale`/`assets`/
 * `metadata`) كان اجتهاداً من الوثيقة المعمارية التوضيحية قبل قراءة العقد
 * القائم فعلياً؛ الأفق نفسه يمنع اختراع عقد مخطط/تشغيل ثانٍ («Do not invent
 * a second schema/runtime contract when the Mobile Runtime Proof already
 * established compatible primitives»). التحقق العميق (`AppSchemaParser`)
 * يطابق محلّل Flutter عقدة عقدة.
 */
class BuilderDraftExperience extends BaseModel implements CompanyWide
{
    /** مطابقة حرفية لمفاتيح `AppSchema` في `mobile/lib/schema/app_schema.dart`. */
    public const SCHEMA_KEYS = [
        'schemaVersion', 'minRuntimeVersion', 'requiredCapabilities', 'theme', 'navigation', 'pages',
    ];

    public const CURRENT_SCHEMA_VERSION = '1.0.0';

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
     * من الصفر" — صفحة رئيسية فارغة بلا مكوّنات فعلية بعد (تلك APP-BUILDER-5+)،
     * لكنها مخطّط صالح كاملاً يمرّ من `AppSchemaParser` **و**
     * `CompatibilityResolver` معاً منذ اللحظة الأولى (يطابق شكل
     * `kHomeSchemaJson`/`kCartSchemaJson` الحقيقي في `mobile/lib/app/runtime_schema.dart`
     * حرفياً — مكوّن جذرٍ واحد من نوع `Page` معروف في سجلّ AWJ Mobile Runtime).
     *
     * V1 يستعمل نفس اللقطة لكل مسارات الإنشاء الثلاثة — التمايز الحقيقي
     * (استيراد تصميم المتجر، محتوى القالب) مؤجَّلٌ صراحةً إلى APP-BUILDER-8/9
     * (انظر توثيق ترحيل `builder_apps`).
     *
     * @return array<string, mixed>
     */
    public static function minimalSafeSchema(): array
    {
        return [
            'schemaVersion' => self::CURRENT_SCHEMA_VERSION,
            'minRuntimeVersion' => self::CURRENT_SCHEMA_VERSION,
            'navigation' => ['initialPageId' => 'home'],
            'theme' => ['tokens' => []],
            'pages' => [
                'home' => [
                    'type' => 'Page',
                    'id' => 'home-root',
                    'children' => [],
                ],
            ],
        ];
    }
}
