<?php

namespace App\Services\AppBuilder;

use App\Models\BuilderApp;
use App\Models\BuilderPublishedExperienceVersion;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  سلطة نشر نسخة تجربة جديدة الوحيدة — APP-BUILDER-1/2 (AB-03)
 * ═══════════════════════════════════════════════════════════════
 *
 * `publish()` تقفل صفّ `builder_apps` نفسه (مِرساة تزامن) ثم تعيد حساب
 * `max(version)+1` **داخل** القفل — ينشر تاجران لنفس التطبيق في اللحظة
 * نفسها كان سيتسابقان بلا هذا (كلاهما يقرأ نفس max القديم فينتج رقم
 * نسخة مكرَّراً يصطدم بالقيد الفريد `(builder_app_id, version)` لأحدهما
 * فقط صامتاً بترتيب تنفيذ غير محدَّد). النمط مطابقٌ حرفياً لـ
 * `CommercePaymentIntentService::markCollected()`.
 *
 * إعادة التحقق البنيوي هنا (لا الاكتفاء بتحقق وقت الحفظ) مطابقة لتمييز
 * `APP_SCHEMA_V1.md` §21 بين "Authoring validation" و"Publish validation" —
 * الأخيرة أشدّ صراحةً ولا تثق بأن حالة المسودة لم تتغيّر بين الحفظ والنشر.
 *
 * **APP-BUILDER-2**: إضافةً للتحقق البنيوي، النشر يستدعي
 * `CompatibilityResolver` مقابل بناء AWJ Mobile Runtime **الحالي**
 * (`CapabilityManifest::current()`) — قدرة مطلوبة غير مدعومة تمنع النشر
 * كاملاً («compatibility failure cannot silently publish»، Quality Gate E)؛
 * تجاوزات اختيارية آمنة (`fallbacks`) لا تمنعه.
 */
final class BuilderPublishedExperienceVersionService
{
    public function __construct(
        private readonly AppSchemaParser $parser,
        private readonly CompatibilityResolver $compatibilityResolver,
    ) {}

    /**
     * @throws RuntimeException لا توجد مسودة لهذا التطبيق (لا يحدث عملياً
     *                          — `BuilderAppService::create()` يضمن وجودها
     *                          ذرّياً)، أو المسودة غير صالحة بنيوياً، أو غير
     *                          متوافقة مع بناء AWJ Mobile Runtime الحالي.
     */
    public function publish(BuilderApp $app, ?string $note, ?string $userId): BuilderPublishedExperienceVersion
    {
        return DB::transaction(function () use ($app, $note, $userId): BuilderPublishedExperienceVersion {
            $lockedApp = BuilderApp::query()->whereKey($app->id)->lockForUpdate()->firstOrFail();

            $schema = $this->validatedDraftSchema($lockedApp);

            $nextVersion = (int) (BuilderPublishedExperienceVersion::query()
                ->where('builder_app_id', $lockedApp->id)
                ->max('version') ?? 0) + 1;

            return BuilderPublishedExperienceVersion::create([
                'builder_app_id' => $lockedApp->id,
                'version' => $nextVersion,
                'schema' => $schema,
                'schema_version' => (string) $schema['schemaVersion'],
                'published_by' => $userId,
                'published_at' => now(),
                'note' => $note,
            ]);
        });
    }

    /**
     * ═══════════════════════════════════════════════════════════════
     *  فحص مسودة دون نشر — APP-BUILDER-10
     * ═══════════════════════════════════════════════════════════════
     * يُشغِّل تحقّقَي `publish()` نفسيهما (بنيوي ثم توافق) بلا قفل وبلا إنشاء
     * صفّ — فحصٌ صريح لا فعل. لا قاعدة تحقّق جديدة: يعيد استخدام
     * `validatedDraftSchema()` حرفياً، فنجاح الفحص يعني نجاح نشرٍ فعلي لاحق
     * بنفس المسودة (ما لم تتغيّر المسودة أو بناء التشغيل الحالي بين الفحص
     * والنشر — سباقٌ نادر، ونشرٌ فاشل بعده يُبلّغ برسالته الحقيقية كأي فشل آخر).
     *
     * @throws RuntimeException لا توجد مسودة، أو غير صالحة بنيوياً، أو غير متوافقة.
     */
    public function validate(BuilderApp $app): void
    {
        $this->validatedDraftSchema($app);
    }

    /**
     * @return array<string, mixed> مخطط المسودة بعد تحقّقٍ بنيوي وتوافقي كاملين.
     *
     * @throws RuntimeException لا توجد مسودة، أو غير صالحة بنيوياً، أو غير متوافقة.
     */
    private function validatedDraftSchema(BuilderApp $app): array
    {
        $draft = $app->draft()->first();
        if ($draft === null) {
            throw new RuntimeException('لا توجد مسودة تجربة لهذا التطبيق.');
        }

        $schema = $draft->schema;
        $this->parser->validate($schema);

        $compatibility = $this->compatibilityResolver->resolve($schema, CapabilityManifest::current());
        if (! $compatibility->compatible) {
            throw new RuntimeException("التجربة غير متوافقة مع تطبيق الجوال الحالي: {$compatibility->message}");
        }

        return $schema;
    }
}
