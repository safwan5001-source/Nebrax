<?php

namespace App\Http\Controllers\Api;

use App\Models\BuilderPublishedExperienceVersion;
use App\Services\AppBuilder\BuilderLivePointerService;
use App\Services\AppBuilder\AppSchemaParser;
use App\Services\AppBuilder\CompatibilityResolver;
use App\Services\AppBuilder\RuntimeGenerations;
use App\Services\AppBuilder\SchemaFormatException;
use App\Support\PublicApiResponse;
use App\Tenancy\StorefrontContext;
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
        private readonly BuilderLivePointerService $pointers,
        private readonly StorefrontContext $storefront,
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

        $candidates = $this->candidates($limit);

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

        // AD-06 / S05c: ETag = (النسخة المختارة، جيل Runtime) — يتغيّر بنشر/ترقية/تراجع أو بجيل جهاز آخر. `no-cache` يُلزم
        // الوسيط الخاص بإعادة التحقق في كل مرة (فنشر جديد يصل فوراً) بينما يُجيب `If-None-Match` المطابق بـ304 بلا حمولة.
        $etag = '"'.$version->id.'-'.$manifest->runtimeVersion.'"';
        $headers = ['ETag' => $etag, 'Cache-Control' => 'private, no-cache', 'Vary' => 'X-Runtime-Version'];

        if ($this->etagMatches($request->header('If-None-Match'), $etag)) {
            return response()->json(null, 304)->withHeaders($headers);
        }

        return PublicApiResponse::success($request, [
            'version' => $version->version,
            'schema_version' => $version->schema_version,
            'published_at' => $version->published_at?->toIso8601String(),
            'schema' => $version->schema,
        ])->withHeaders($headers);
    }

    /**
     * المرشحون بترتيب الأولوية. مع المؤشر الحي (بوابة مفتوحة + مؤشر للقناة): نسخ **تطبيق المؤشر** حتى رقم النسخة الحيّة
     * (سقف، لا أعلى منها) — فالتراجع يعني أن ما بعد النسخة الحيّة لا يُخدَم أبداً، ويبقى انتقاء الأعلى المتوافق مع جيل الجهاز
     * ضمن هذا السقف (AD-02). بدونه: السلوك المؤقت القديم حرفياً (أحدث نشر عبر تطبيقات المستأجر).
     *
     * @return \Illuminate\Support\Collection<int, BuilderPublishedExperienceVersion>
     */
    private function candidates(int $limit)
    {
        $query = BuilderPublishedExperienceVersion::query();

        if (BuilderLivePointerService::enabled() && $this->storefront->isEstablished()) {
            $pointer = $this->pointers->current($this->storefront->salesChannelId());
            $live = $pointer === null ? null : BuilderPublishedExperienceVersion::query()->whereKey($pointer->live_version_id)->first();
            if ($live !== null) {
                return $query
                    ->where('builder_app_id', $live->builder_app_id)
                    ->where('version', '<=', $live->version)
                    ->orderByDesc('version')
                    ->limit($limit)
                    ->get();
            }
        }

        return $query->orderByDesc('published_at')->orderByDesc('created_at')->limit($limit)->get();
    }

    /** مقارنة `If-None-Match` (قائمة، `*`، وبادئة ضعيفة `W/`) بقيمتنا القوية. */
    private function etagMatches(?string $header, string $etag): bool
    {
        if ($header === null || trim($header) === '') {
            return false;
        }
        if (trim($header) === '*') {
            return true;
        }
        foreach (explode(',', $header) as $candidate) {
            $candidate = trim($candidate);
            if (str_starts_with($candidate, 'W/')) {
                $candidate = substr($candidate, 2);
            }
            if ($candidate === $etag) {
                return true;
            }
        }

        return false;
    }
}
