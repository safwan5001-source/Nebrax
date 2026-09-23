<?php

namespace App\Services\AppBuilder;

use App\Models\BuilderApp;
use App\Models\BuilderPublishedExperienceVersion;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  سلطة نشر نسخة تجربة جديدة الوحيدة — APP-BUILDER-1 (AB-03)
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
 */
final class BuilderPublishedExperienceVersionService
{
    public function __construct(
        private readonly AppSchemaStructuralValidator $validator,
    ) {}

    /**
     * @throws RuntimeException لا توجد مسودة لهذا التطبيق (لا يحدث عملياً
     *                          — `BuilderAppService::create()` يضمن وجودها
     *                          ذرّياً)، أو المسودة غير صالحة بنيوياً.
     */
    public function publish(BuilderApp $app, ?string $note, ?string $userId): BuilderPublishedExperienceVersion
    {
        return DB::transaction(function () use ($app, $note, $userId): BuilderPublishedExperienceVersion {
            $lockedApp = BuilderApp::query()->whereKey($app->id)->lockForUpdate()->firstOrFail();

            $draft = $lockedApp->draft()->first();
            if ($draft === null) {
                throw new RuntimeException('لا توجد مسودة تجربة لهذا التطبيق.');
            }

            $schema = $draft->schema;
            $this->validator->validate($schema);

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
}
