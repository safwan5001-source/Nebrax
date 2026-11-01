<?php

namespace App\Services\AppBuilder;

use App\Models\BuilderApp;
use App\Models\BuilderDraftExperience;
use App\Models\BuilderLivePointer;
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
        private readonly BuilderQuota $quota,
    ) {}

    /**
     * @throws RuntimeException مسار إنشاء غير مدعوم.
     */
    public function create(string $name, ?string $nameEn, string $creationSource, ?string $userId, ?string $templateKey = null): BuilderApp
    {
        if (! in_array($creationSource, BuilderApp::CREATION_SOURCES, true)) {
            throw new RuntimeException('مسار إنشاء التطبيق غير مدعوم.');
        }

        // بلا قالب: المحتوى الأدنى الآمن كما كان. مع `template_key` (AD-11): نسخة من مخطط القالب في السجل — بلا ارتباط حي به.
        $schema = BuilderDraftExperience::minimalSafeSchema();
        if ($templateKey !== null) {
            $template = app(AppTemplateRegistry::class)->find($templateKey);
            if ($template === null) {
                throw new RuntimeException('القالب غير موجود.');
            }
            $schema = $template['schema'];
        }
        $this->parser->validate($schema);

        return DB::transaction(function () use ($name, $nameEn, $creationSource, $userId, $schema): BuilderApp {
            // DRF-07: حدّ عدد التطبيقات (PlanGate) — بعد قفل صفّ المستأجر فلا يتجاوزه طلبان متزامنان.
            $this->quota->lockTenantRow();
            $this->quota->assertCanCreateApp();

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

    /**
     * أرشفة (soft، AD-06 / S05d): تحفظ التطبيق ونسخه وتُخرجه من التقديم والنشر والتحرير. **لا يُؤرشف التطبيق الحيّ**
     * (يشير إليه مؤشر قناة) — يُنقل المؤشر أولاً. القفل على صفّ التطبيق، فترقيةٌ متزامنة لنسخة منه (تقفله أولاً) تسبق الأرشفة
     * فتُرفض، أو تتأخر عنها فتُرفض على التطبيق المؤرشف. idempotent.
     *
     * @throws LivePointerConflictException `app_is_live`
     */
    public function archive(BuilderApp $app): BuilderApp
    {
        return DB::transaction(function () use ($app): BuilderApp {
            $locked = BuilderApp::query()->whereKey($app->id)->lockForUpdate()->firstOrFail();
            if ($locked->isArchived()) {
                return $locked;
            }
            if (BuilderLivePointer::query()->where('builder_app_id', $locked->id)->exists()) {
                throw new LivePointerConflictException('app_is_live', 'هذا التطبيق هو الحيّ حالياً؛ انقل النسخة الحيّة إلى تطبيق آخر قبل أرشفته.');
            }
            $locked->forceFill(['archived_at' => now()])->save();

            return $locked->fresh();
        });
    }

    /** إعادة تفعيل مؤرشف: يخضع لحدّ عدد التطبيقات (يُعاد احتسابه) تحت قفل المستأجر. idempotent. */
    public function unarchive(BuilderApp $app): BuilderApp
    {
        return DB::transaction(function () use ($app): BuilderApp {
            $this->quota->lockTenantRow();
            $locked = BuilderApp::query()->whereKey($app->id)->lockForUpdate()->firstOrFail();
            if (! $locked->isArchived()) {
                return $locked;
            }
            $this->quota->assertCanCreateApp();
            $locked->forceFill(['archived_at' => null])->save();

            return $locked->fresh();
        });
    }
}
