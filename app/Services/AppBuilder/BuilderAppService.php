<?php

namespace App\Services\AppBuilder;

use App\Models\BuilderApp;
use App\Models\BuilderDraftExperience;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  سلطة إنشاء/تعديل هوية `BuilderApp` الوحيدة — APP-BUILDER-1
 * ═══════════════════════════════════════════════════════════════
 *
 * `create()` هي المكان الوحيد الذي ينشئ فيه تطبيقاً — يضمن بنيوياً أن كل
 * تطبيق يولد **بمسودة واحدة موجودة فوراً** (معاملة واحدة)، فلا مسار كودي
 * يمكن أن يترك تطبيقاً بلا مسودة (بخلاف فحص "قد تكون المسودة null" في كل
 * استهلاك لاحق).
 */
final class BuilderAppService
{
    public function __construct(
        private readonly AppSchemaParser $parser,
    ) {}

    /**
     * @throws RuntimeException مسار إنشاء غير مدعوم.
     */
    public function create(string $name, ?string $nameEn, string $creationSource, ?string $userId): BuilderApp
    {
        if (! in_array($creationSource, BuilderApp::CREATION_SOURCES, true)) {
            throw new RuntimeException('مسار إنشاء التطبيق غير مدعوم.');
        }

        // مسارات الإنشاء الثلاثة تنتج نفس المحتوى الأدنى الآمن في V1 —
        // التمايز الحقيقي (تصميم المتجر/القالب) مؤجَّلٌ إلى APP-BUILDER-8/9
        // (انظر توثيق `BuilderDraftExperience::minimalSafeSchema()`).
        $schema = BuilderDraftExperience::minimalSafeSchema();
        $this->parser->validate($schema);

        return DB::transaction(function () use ($name, $nameEn, $creationSource, $userId, $schema): BuilderApp {
            $app = BuilderApp::create([
                'name' => $name,
                'name_en' => $nameEn,
                'creation_source' => $creationSource,
                'created_by' => $userId,
            ]);

            BuilderDraftExperience::create([
                'builder_app_id' => $app->id,
                'schema' => $schema,
                'revision' => 0,
                'updated_by' => $userId,
            ]);

            return $app;
        });
    }

    public function rename(BuilderApp $app, string $name, ?string $nameEn): BuilderApp
    {
        $app->update(['name' => $name, 'name_en' => $nameEn]);

        return $app->fresh();
    }
}
