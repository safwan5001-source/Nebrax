<?php

namespace App\Services\AppBuilder;

use App\Models\BuilderApp;
use App\Models\BuilderDraftExperience;
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
        private readonly AppSchemaContractChecker $contractChecker,
    ) {}

    /**
     * @throws RuntimeException لا توجد مسودة لهذا التطبيق (لا يحدث عملياً
     *                          — `BuilderAppService::create()` يضمن وجودها
     *                          ذرّياً)، أو المسودة غير صالحة بنيوياً، أو غير
     *                          متوافقة مع بناء AWJ Mobile Runtime الحالي.
     */
    public function publish(BuilderApp $app, ?string $note, ?string $userId, ?int $expectedDraftRevision = null): BuilderPublishedExperienceVersion
    {
        return DB::transaction(function () use ($app, $note, $userId, $expectedDraftRevision): BuilderPublishedExperienceVersion {
            $lockedApp = BuilderApp::query()->whereKey($app->id)->lockForUpdate()->firstOrFail();

            // AD-01 / S01d: قفل صفّ المسودة نفسه (ترتيب الأقفال: التطبيق ثم المسودة؛ الحفظ يقفل المسودة وحدها
            // فلا جمود). الالتقاط والتحقق والمقارنة كلها على الصفّ المقفول، فلا يُنشر مخطط حُفظ أثناء النشر.
            $draft = BuilderDraftExperience::query()
                ->where('builder_app_id', $lockedApp->id)
                ->lockForUpdate()
                ->first();
            if ($draft === null) {
                throw new RuntimeException('لا توجد مسودة تجربة لهذا التطبيق.');
            }
            if ($expectedDraftRevision !== null && (int) $draft->revision !== $expectedDraftRevision) {
                throw new DraftChangedSinceReviewException((int) $draft->revision, $expectedDraftRevision);
            }

            $schema = $this->validatedSchemaOf($draft);

            $nextVersion = (int) (BuilderPublishedExperienceVersion::query()
                ->where('builder_app_id', $lockedApp->id)
                ->max('version') ?? 0) + 1;

            return BuilderPublishedExperienceVersion::create([
                'builder_app_id' => $lockedApp->id,
                'version' => $nextVersion,
                'schema' => $schema,
                'schema_version' => (string) $schema['schemaVersion'],
                'source_draft_revision' => (int) $draft->revision,
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
     * `validatedSchemaOf()` حرفياً، فنجاح الفحص يعني نجاح نشرٍ فعلي لاحق
     * بنفس المسودة (ما لم تتغيّر المسودة أو بناء التشغيل الحالي بين الفحص
     * والنشر — سباقٌ نادر، ونشرٌ فاشل بعده يُبلّغ برسالته الحقيقية كأي فشل آخر).
     *
     * @throws RuntimeException لا توجد مسودة، أو غير صالحة بنيوياً، أو غير متوافقة.
     */
    public function validate(BuilderApp $app): void
    {
        $draft = $app->draft()->first();
        if ($draft === null) {
            throw new RuntimeException('لا توجد مسودة تجربة لهذا التطبيق.');
        }
        $this->validatedSchemaOf($draft);
    }

    /**
     * @return array<string, mixed> مخطط المسودة بعد تحقّقٍ بنيوي وتوافقي كاملين.
     *
     * @throws RuntimeException لا توجد مسودة، أو غير صالحة بنيوياً، أو غير متوافقة.
     */
    private function validatedSchemaOf(BuilderDraftExperience $draft): array
    {
        $schema = $draft->schema;
        $this->parser->validate($schema);

        $compatibility = $this->compatibilityResolver->resolve($schema, CapabilityManifest::current());
        if (! $compatibility->compatible) {
            throw new RuntimeException("التجربة غير متوافقة مع تطبيق الجوال الحالي: {$compatibility->message}");
        }

        // AD-12 (S02): مخالفات العقد الحاجبة تمنع النشر والفحص برسالة قابلة للإصلاح (`issues[]` في المتحكّم).
        $this->contractChecker->assertHardLimits($schema);
        $blocking = AppSchemaContractChecker::blocking($this->contractChecker->check($schema));
        if ($blocking !== []) {
            throw new SchemaContractViolationException($blocking);
        }

        return $schema;
    }
}
