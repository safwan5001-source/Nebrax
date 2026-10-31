<?php

namespace App\Http\Controllers\Api;

use App\Models\BuilderPublishedExperienceVersion;
use App\Services\AppBuilder\AppSchemaParser;
use App\Services\AppBuilder\CompatibilityResolver;
use App\Services\AppBuilder\RuntimeGenerations;
use App\Services\AppBuilder\SchemaFormatException;
use App\Support\PublicApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * ═══════════════════════════════════════════════════════════════
 *  تجربة App Builder المنشورة — Commerce API V1 (APP-BUILDER-19)
 * ═══════════════════════════════════════════════════════════════
 *
 * نقطة القراءة الوحيدة التي يعتمد عليها حلقة `last_known_good.dart` على
 * الجوال (`ExperienceFetchOutcome`) لجلب تجربة حقيقية بدل الاكتفاء بمخطط
 * مُجمَّع وقت الترجمة (`kHomeSchemaJson`/`kCartSchemaJson`).
 *
 * **سياسة اختيار مؤقّتة لـ V1 — ليست قراراً معمارياً دائماً**: قد ينشئ
 * التاجر أكثر من `BuilderApp` واحد (لا قيد فريد على `builder_apps.tenant_id`
 * — أداة تأليف حرّة، انظر `BuilderAppController`)، فلا يوجد عمود "التطبيق
 * النشط" اليوم. هذه النقطة تُعرِّف "التجربة الحية" مؤقّتاً بأنها **أحدث نسخة
 * منشورة عبر كل تطبيقات المستأجر مجتمعة** (`ORDER BY published_at DESC`) —
 * مطابقاً لسلوك التاجر المتوقَّع (ينشر نسخةً فتصبح هي الحية) دون تعديل مخطط
 * قاعدة البيانات أو ابتكار عمود "نشط" جديد؛ عزلٌ تلقائي عبر `TenantScope`
 * على `BuilderPublishedExperienceVersion` نفسه، لا استعلاماً يدوياً يتجاوزه.
 * **صراحةً قابلة للاستبدال**: أول ما يحتاج تاجرٌ حقيقي إدارة أكثر من تطبيق
 * حيّ في آنٍ واحد (تجربتان منفصلتان مثلاً)، هذه السياسة تُستبدَل بعمود
 * `is_live` صريح على `BuilderApp` — دون كسر شكل هذا العقد العام (`data.version`/
 * `data.schema_version`/`data.published_at`/`data.schema`)، إذ يتغيّر
 * الاستعلام هنا فقط لا الاستجابة. لا تنقل هذا الافتراض («الأحدث نشراً = الحيّ»)
 * إلى أي كودٍ آخر كحقيقة معمارية ثابتة.
 *
 * الحمولة `schema` هي وثيقة `APP_SCHEMA_V1` كاملة كما نُشرت (تتضمّن
 * `schemaVersion` داخلها) — هي بالضبط ما يتوقّعه `AppSchema.parse` على
 * الجوال دون أي غلاف إضافي؛ طبقة الجلب على الجوال هي من تستخرج حقل
 * `schema` من مغلّف `PublicApiResponse` قبل تمريره لِـ`resolveStartup`.
 */
class CommerceExperienceController extends PublicApiController
{
    /** أقصى عدد نسخ حديثة تُفحَص بحثاً عن الأعلى المتوافقة مع جيل الجهاز (حدّ للكلفة؛ يُضبط من `config/app_builder.php`). */
    private const DEFAULT_SCAN_LIMIT = 100;

    public function __construct(
        private readonly RuntimeGenerations $generations,
        private readonly AppSchemaParser $parser,
        private readonly CompatibilityResolver $resolver,
    ) {}

    /**
     * AD-02 (S05b): **أعلى نسخة منشورة متوافقة مع جيل الجهاز** (`X-Runtime-Version`)، لا «الأحدث» أيّاً كانت.
     * الترويسة الغائبة/التالفة ⇒ أقدم جيل معروف. لا نسخة متوافقة ⇒ 404 (يعود الجهاز إلى التجربة الافتراضية المضمَّنة)
     * بدل وثيقة لا يستطيع عرضها. صف تالف لا يخفي صفاً أقدم سليماً.
     */
    public function show(Request $request): JsonResponse
    {
        $manifest = $this->generations->forRuntime($request->header('X-Runtime-Version'));
        $limit = max(1, (int) config('app_builder.runtime_selection_scan_limit', self::DEFAULT_SCAN_LIMIT));

        $candidates = BuilderPublishedExperienceVersion::query()
            ->orderByDesc('published_at')
            ->orderByDesc('created_at')
            ->limit($limit)
            ->get();

        $version = $candidates->first(function (BuilderPublishedExperienceVersion $candidate) use ($manifest): bool {
            $schema = $candidate->schema;
            if (! is_array($schema)) {
                return false;
            }
            try {
                $this->parser->validate($schema);
            } catch (SchemaFormatException) {
                return false;
            }

            return $this->resolver->resolve($schema, $manifest)->compatible;
        });

        if ($version === null) {
            abort(404, 'لا توجد تجربة منشورة لهذا المستأجر.');
        }

        return PublicApiResponse::success($request, [
            'version' => $version->version,
            'schema_version' => $version->schema_version,
            'published_at' => $version->published_at?->toIso8601String(),
            'schema' => $version->schema,
        ])->header('Vary', 'X-Runtime-Version');
    }
}
