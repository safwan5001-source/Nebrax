<?php

namespace App\Services\Commerce;

use App\Models\Storefront;
use App\Models\StorefrontPresentation;
use App\Models\StorefrontPresentationVersion;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * STORE-BACKEND-1 — قراءة/حفظ مسودة المظهر ونشرها.
 *
 * المستأجر من `TenantContext` فقط. `{id}` محدِّد صفّ. أجنبي/مفقود → null
 * (404 في المتحكّم). حفظ المسودة لا يمسّ المنشورة. النشر نسخة داخل الصف
 * تحت `lockForUpdate`.
 *
 * CUST-H1-1: الواجهة والاستجابة القديمتان محفوظتان حرفياً — الإضافة
 * الوحيدة داخلياً هي التزامن الذرّي مع نسخة العمل المتوافقة
 * (`compatibility_working_version_id`) والتشويك (fork) قبل تعديل نسخة
 * منشورة نشطة؛ أنظر `applyDraftSave()`.
 */
final class StorefrontPresentationService
{
    public function __construct(
        private readonly StorefrontPresentationNormalizer $normalizer,
        private readonly StorefrontPresentationVersionBackfillService $backfill,
    ) {}

    /**
     * @return array{
     *     storefront_id: string,
     *     schema_version: int,
     *     draft: array<string, mixed>,
     *     draft_revision: int,
     *     published: ?array<string, mixed>,
     *     published_revision: ?int,
     *     published_at: ?string
     * }|null
     */
    public function showForCurrentTenant(string $storefrontId): ?array
    {
        $storefront = $this->ownedStorefront($storefrontId);
        if ($storefront === null) {
            return null;
        }

        $row = StorefrontPresentation::query()
            ->where('storefront_id', $storefront->id)
            ->first();

        // فشل آمن قبل أي تطبيع: مخطط مخزَّن أحدث من الإصدار الحالي (مثلاً
        // بعد تراجع نشر بعد ترقية) يجب أن يُرفض صراحة لا أن يُستبدل بافتراضي
        // "AWJ Modern" صامتاً — القائمة الصريحة في المعمارية تشمل "legacy
        // GET/PUT mapping".
        if ($row !== null) {
            $this->assertSupportedLegacySchema($row);
        }

        // لا رأس بعد → افتراضات افتراضية بلا كتابة (سلوك STORE-BACKEND-1
        // الأصلي، محفوظ حرفياً). رأسٌ قائم → نضمن نسخة العمل المتوافقة تحت
        // قفل في كل مرة (لا فقط أول مرة): `ensureCompatibilityWorkingVersion`
        // نفسها حارس تحوّل/عبور يصالح النسخة مع الرأس لو انجرفت بفعل كاتبٍ
        // قديم أثناء نافذة نشر متدرّج قصيرة بعد هذه الهجرة (§7).
        if ($row !== null) {
            $row = DB::transaction(function () use ($storefront) {
                $locked = StorefrontPresentation::query()
                    ->where('storefront_id', $storefront->id)
                    ->lockForUpdate()
                    ->first();

                if ($locked !== null) {
                    // إعادة الفحص بعد القفل: الفحص أعلاه غير مقفول، فقد
                    // يلتزم كاتبٌ أحدث مخططاً أماميّاً بين تلك القراءة وهذا
                    // القفل. القفل هو مصدر الحقيقة، لا القراءة السابقة له.
                    $this->assertSupportedLegacySchema($locked);
                    $this->backfill->ensureCompatibilityWorkingVersion($locked);
                }

                return $locked;
            });
        }

        return $this->present($storefront, $row);
    }

    /**
     * @param  array<string, mixed>  $config
     * @return array{
     *     storefront_id: string,
     *     schema_version: int,
     *     draft: array<string, mixed>,
     *     draft_revision: int,
     *     published: ?array<string, mixed>,
     *     published_revision: ?int,
     *     published_at: ?string
     * }|null
     */
    public function saveDraftForCurrentTenant(string $storefrontId, array $config, int $expectedRevision): ?array
    {
        // فشل آمن على الوثيقة الواردة **قبل** التطبيع: `normalize()` بلا
        // `$storedSchemaVersion` (كما هنا) لا يرفض إصداراً معلَناً أحدث من
        // الحالي — يطبّعه بصمت. يجب رفضه صراحةً هنا هو نفسه فحص
        // `assertIncomingConfigNotForward` في مسار حفظ النسخة الدقيقة.
        $this->assertIncomingConfigNotForward($config);

        $normalized = $this->normalizer->normalize($config);
        $this->assertStoredSize($normalized);

        try {
            return DB::transaction(function () use ($storefrontId, $normalized, $expectedRevision) {
                $storefront = $this->lockOwnedStorefront($storefrontId);
                if ($storefront === null) {
                    return null;
                }

                $row = StorefrontPresentation::query()
                    ->where('storefront_id', $storefront->id)
                    ->orderBy('id')
                    ->lockForUpdate()
                    ->first();

                return $this->applyDraftSave($storefront, $row, $normalized, $expectedRevision);
            });
        } catch (QueryException $e) {
            if (! $this->isUniqueViolation($e)) {
                throw $e;
            }

            return $this->retryDraftSaveAfterConflict($storefrontId, $normalized, $expectedRevision);
        }
    }

    /**
     * @return array{
     *     storefront_id: string,
     *     schema_version: int,
     *     draft: array<string, mixed>,
     *     draft_revision: int,
     *     published: ?array<string, mixed>,
     *     published_revision: ?int,
     *     published_at: ?string
     * }|null
     */
    public function publishForCurrentTenant(string $storefrontId, ?int $expectedRevision): ?array
    {
        return DB::transaction(function () use ($storefrontId, $expectedRevision) {
            $storefront = $this->lockOwnedStorefront($storefrontId);
            if ($storefront === null) {
                return null;
            }

            $row = StorefrontPresentation::query()
                ->where('storefront_id', $storefront->id)
                ->orderBy('id')
                ->lockForUpdate()
                ->first();

            if ($row === null || (int) $row->draft_revision === 0) {
                throw new NothingToPublishException;
            }

            if ($row->tenant_id !== $storefront->tenant_id) {
                return null;
            }

            if ($expectedRevision !== null && $expectedRevision !== (int) $row->draft_revision) {
                throw new StaleDraftRevisionException;
            }

            // فشل آمن قبل التطبيع: راجع تعليق GET أعلاه — النشر القديم
            // مذكور صراحةً ضمن مسارات "immediate Publish" المشمولة بقاعدة
            // الفشل الآمن.
            $this->assertSupportedLegacySchema($row);

            // CUST-H1-1: نسخة العمل المتوافقة قد تكون انفصلت عن النسخة
            // النشطة (تشويك سابق عبر legacy PUT)، أو لم تُنشأ بعد أصلاً (رأسٌ
            // أنشأه كاتبٌ قديم بعد هذه الهجرة مباشرة، فبقي مؤشره فارغاً حتى
            // أول قراءة/حفظ عبر هذا الالتزام). النشر القديم ينشر مستند نسخة
            // العمل الحالية فعلياً (`draft_config` المتزامن معها) — فيجب أن
            // تصبح هي النسخة النشطة الآن، وإلا بقيت نسخة قديمة مُعلَنة
            // "منشورة" رغم أن محتواها لم يعد يطابق اللقطة العامة. `ensureCompatibilityWorkingVersion`
            // تُنشئها إن غابت، وتُصالحها مع الرأس إن انجرفت (حارس التحوّل/
            // العبور) — فتُعيد قيمة **مضمونة غير فارغة** أبداً؛ معاملة المؤشر
            // الفارغ كـ"مُرقّى بالفعل" (كما كانت الشيفرة السابقة تفعل) كانت
            // تُسقط نشراً حقيقياً ينبغي أن يُثبِّت النسخة النشطة الأولى.
            //
            // تُقفَل وتُفحَص وسمها **قبل** أي تطبيع: وسم الرأس وحده لا يكفي —
            // نسخة كُتبت بإصدارٍ أحدث عبر واجهة النسخ الجديدة قد تحمل وسماً
            // أحدث من وسم الرأس نفسه (سيناريو تراجع نشر).
            $compat = $this->backfill->ensureCompatibilityWorkingVersion($row);

            if ((int) $compat->schema_version > StorefrontPresentationNormalizer::VERSION) {
                throw new ForwardSchemaVersionException;
            }

            $normalized = $this->normalizer->normalize(
                $row->draft_config ?? null,
                $this->effectiveSchemaTag($row->draft_config ?? [], (int) $row->draft_schema_version),
            );
            $this->assertStoredSize($normalized);

            $published = is_array($row->published_config) ? $row->published_config : null;
            $contentUnchanged = $row->published_revision !== null
                && (int) $row->draft_revision === (int) $row->published_revision
                && $this->sameDocument($published, $normalized);
            // نشر قديم أثناء نافذة نشر متدرّج قد يحدّث published_config دون
            // أن يعرف active_version_id إطلاقاً — فحص "لا تغيير" وحده غير
            // كافٍ؛ يجب أن يكون المؤشر مُرقّىً بالفعل أيضاً، وإلا بقيت نسخة
            // قديمة مُعلَنة "منشورة" رغم تطابق المحتوى ظاهرياً.
            $pointerAlreadyPromoted = $row->active_version_id === $compat->id;

            if ($contentUnchanged && $pointerAlreadyPromoted) {
                return $this->present($storefront, $row);
            }

            if ($contentUnchanged) {
                // المحتوى بلا تغيير فعلاً — رقِّ المؤشر فقط، بلا إعادة كتابة
                // published_at/published_revision لغياب تغيّر حقيقي في اللقطة.
                $row->forceFill(['active_version_id' => $compat->id])->save();

                $compat->forceFill([
                    'config' => $normalized,
                    'schema_version' => StorefrontPresentationNormalizer::VERSION,
                    'last_published_at' => $row->published_at,
                ])->save();

                return $this->present($storefront, $row->fresh());
            }

            $row->forceFill([
                'draft_config' => $normalized,
                'draft_schema_version' => StorefrontPresentationNormalizer::VERSION,
                'published_config' => $normalized,
                'published_schema_version' => StorefrontPresentationNormalizer::VERSION,
                'published_revision' => (int) $row->draft_revision,
                'published_at' => now(),
                'schema_version' => StorefrontPresentationNormalizer::VERSION,
                'active_version_id' => $compat->id,
            ])->save();

            $compat->forceFill([
                'config' => $normalized,
                'schema_version' => StorefrontPresentationNormalizer::VERSION,
                'last_published_at' => now(),
            ])->save();

            return $this->present($storefront, $row->fresh());
        });
    }

    /**
     * لقطة منشورة فقط — لا يقرأ `draft_config`.
     *
     * @return array<string, mixed>|null
     */
    public function publishedSnapshotForStorefront(string $storefrontId): ?array
    {
        $row = StorefrontPresentation::query()
            ->where('storefront_id', $storefrontId)
            ->whereNotNull('published_config')
            ->first(['published_config', 'schema_version', 'published_schema_version']);

        if ($row === null || ! is_array($row->published_config)) {
            return null;
        }

        // CUST-H1-1: `published_schema_version` هو الوسم الصحيح — الشريك
        // الذري لـ`published_config` (§12). العمود القديم المشترك
        // `schema_version` قد يتقدّم الآن بفعل حفظ المسودة وحده (عبر
        // الواجهة القديمة أو نسخة العمل المتوافقة عبر واجهة النسخ) دون أن
        // تتغيّر اللقطة المنشورة إطلاقاً — استعماله هنا كان سيُعيد تفسير
        // لقطة v1 منشورة بدلالات v2 لمجرّد أن المسودة أُعيد حفظها.
        //
        // ولأن هذا مسار القراءة العامة (بلا قفل ولا معاملة عمداً — لا انضمام
        // إضافي ولا تغيير في دلالة الذاكرة المؤقتة، حسب المعمارية)، لا يمكنه
        // تبنّي حارس التحوّل/العبور القفليّ نفسه المستعمل على الجانب الخاص
        // بالمسودة. بدلاً منه: الوثيقة المخزَّنة تحمل وسمها الحقيقي داخلها —
        // `normalize()` تكتب `'version' => VERSION` الجاري وقت أي حفظ، قديماً
        // كان الكاتب أو جديداً، فيبقى صحيحاً حتى لو تخلَّف عمود
        // `published_schema_version` المنفصل عن كاتبٍ قديم لا يعرفه (راجع
        // `effectivePublishedSchemaTag()`).
        return $this->normalizer->normalize(
            $row->published_config,
            $this->effectiveSchemaTag($row->published_config, $row->published_schema_version ?? $row->schema_version),
        );
    }

    /**
     * الوسم الفعلي لمستند مخزَّن (مسودة أو منشور على حدّ سواء) — يفوّض إلى
     * `StorefrontPresentationNormalizer::effectiveSchemaTag()` المشتركة، التي
     * تستعملها أيضاً خدمة الهجرة/التصالح والنسخ الجديدة، فلا يبقى منطق
     * أولوية الوسم المضمَّن مكرَّراً في أكثر من مكان.
     *
     * @param  array<string, mixed>  $config
     */
    private function effectiveSchemaTag(array $config, ?int $columnFallback): int
    {
        return StorefrontPresentationNormalizer::effectiveSchemaTag($config, $columnFallback);
    }

    /**
     * @param  array<string, mixed>  $normalized
     * @return array{
     *     storefront_id: string,
     *     schema_version: int,
     *     draft: array<string, mixed>,
     *     draft_revision: int,
     *     published: ?array<string, mixed>,
     *     published_revision: ?int,
     *     published_at: ?string
     * }
     */
    private function applyDraftSave(
        Storefront $storefront,
        ?StorefrontPresentation $row,
        array $normalized,
        int $expectedRevision,
    ): array {
        $current = $row === null ? 0 : (int) $row->draft_revision;
        if ($expectedRevision !== $current) {
            throw new StaleDraftRevisionException;
        }

        if ($row === null) {
            // رأسٌ لأول مرة على الإطلاق: يُنشأ الرأس **ونسخة عمل متوافقة**
            // معاً في نفس المعاملة — بلا هذه النسخة يبقى `active_version_id`
            // فارغاً للأبد بعد أول نشر قديم لاحق (لا نسخة لتترقّى)، وواجهة
            // النسخ الجديدة تُظهر تصميماً حياً بلا أي نسخة تمثّله. الاسم
            // الافتراضي نفسه المستعمَل في هجرة الحالة D.
            $row = StorefrontPresentation::create([
                'storefront_id' => $storefront->id,
                'schema_version' => StorefrontPresentationNormalizer::VERSION,
                'draft_schema_version' => StorefrontPresentationNormalizer::VERSION,
                'draft_config' => $normalized,
                'draft_revision' => 1,
            ]);

            $version = StorefrontPresentationVersion::create([
                'tenant_id' => $row->tenant_id,
                'storefront_id' => $storefront->id,
                'name' => StorefrontPresentationVersionBackfillService::DEFAULT_MIGRATION_NAME,
                'schema_version' => StorefrontPresentationNormalizer::VERSION,
                'config' => $normalized,
                'revision' => 1,
            ]);

            $row->forceFill(['compatibility_working_version_id' => $version->id])->save();

            return $this->present($storefront, $row->fresh());
        }

        if ($row->tenant_id !== $storefront->tenant_id) {
            throw new RuntimeException('المتجر غير موجود لهذا المستأجر.');
        }

        // CUST-H1-1 §14/§15/§21: رأسٌ قائم — نقفل/نضمن نسخة العمل المتوافقة،
        // نرفض فشلاً آمناً مخططاً أحدث، ونُشوّك (fork) قبل التعديل إن كانت
        // نسخة العمل هي ذاتها المنشورة النشطة حالياً (لا تعديل مباشر على
        // نسخة منشورة أبداً).
        $compat = $this->lockCompatibilityWorkingVersion($row);

        if ((int) $compat->schema_version > StorefrontPresentationNormalizer::VERSION) {
            throw new ForwardSchemaVersionException;
        }

        if ($row->active_version_id !== null && $row->active_version_id === $compat->id) {
            $compat = $this->forkCompatibilityVersion($row, $compat);
        }

        $newRevision = $current + 1;

        $row->forceFill([
            'draft_config' => $normalized,
            'draft_revision' => $newRevision,
            'schema_version' => StorefrontPresentationNormalizer::VERSION,
            'draft_schema_version' => StorefrontPresentationNormalizer::VERSION,
        ])->save();

        $compat->forceFill([
            'config' => $normalized,
            'schema_version' => StorefrontPresentationNormalizer::VERSION,
            'revision' => $newRevision,
        ])->save();

        return $this->present($storefront, $row->fresh());
    }

    /**
     * يضمن وجود نسخة العمل المتوافقة **مقفولةً** ضمن معاملة مفتوحة
     * بالفعل من المستدعي (الرأس `$row` مقفول بالفعل بنفس المعاملة).
     * `ensureCompatibilityWorkingVersion()` تُعيدها مقفولةً ومُصالَحةً مع
     * الرأس بالفعل (حارس التحوّل/العبور) — لا قفل إضافي هنا.
     */
    private function lockCompatibilityWorkingVersion(StorefrontPresentation $row): StorefrontPresentationVersion
    {
        return $this->backfill->ensureCompatibilityWorkingVersion($row);
    }

    /**
     * يُشوّك نسخة عمل مسودة جديدة من النسخة المنشورة النشطة قبل تعديلها عبر
     * الواجهة القديمة — يحافظ على استمرارية المراجعة (§15): يبدأ الفرع
     * بمراجعة المسودة القديمة الحالية (حداً أدنى 1) بدل الصفر، فلا يرى عميل
     * قديم غير معدَّل تعارضاً وهمياً أو انعكاس مراجعة.
     */
    private function forkCompatibilityVersion(StorefrontPresentation $row, StorefrontPresentationVersion $active): StorefrontPresentationVersion
    {
        $fork = StorefrontPresentationVersion::create([
            'tenant_id' => $row->tenant_id,
            'storefront_id' => $row->storefront_id,
            'name' => $active->name,
            'schema_version' => $active->schema_version,
            'config' => $active->config,
            'revision' => max(1, (int) $row->draft_revision),
        ]);

        $row->forceFill(['compatibility_working_version_id' => $fork->id])->save();

        return $fork;
    }

    /**
     * @param  array<string, mixed>  $normalized
     * @return array{
     *     storefront_id: string,
     *     schema_version: int,
     *     draft: array<string, mixed>,
     *     draft_revision: int,
     *     published: ?array<string, mixed>,
     *     published_revision: ?int,
     *     published_at: ?string
     * }|null
     */
    private function retryDraftSaveAfterConflict(string $storefrontId, array $normalized, int $expectedRevision): ?array
    {
        return DB::transaction(function () use ($storefrontId, $normalized, $expectedRevision) {
            $storefront = $this->lockOwnedStorefront($storefrontId);
            if ($storefront === null) {
                return null;
            }

            $row = StorefrontPresentation::query()
                ->where('storefront_id', $storefront->id)
                ->orderBy('id')
                ->lockForUpdate()
                ->first();

            return $this->applyDraftSave($storefront, $row, $normalized, $expectedRevision);
        });
    }

    private function ownedStorefront(string $storefrontId): ?Storefront
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا سياق مستأجر نشط.');
        }

        $storefront = Storefront::query()->find($storefrontId);
        if ($storefront === null || $storefront->tenant_id !== $tenantId) {
            return null;
        }

        return $storefront;
    }

    private function lockOwnedStorefront(string $storefrontId): ?Storefront
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا سياق مستأجر نشط.');
        }

        $storefront = Storefront::query()
            ->whereKey($storefrontId)
            ->lockForUpdate()
            ->first();

        if ($storefront === null || $storefront->tenant_id !== $tenantId) {
            return null;
        }

        return $storefront;
    }

    /**
     * @return array{
     *     storefront_id: string,
     *     schema_version: int,
     *     draft: array<string, mixed>,
     *     draft_revision: int,
     *     published: ?array<string, mixed>,
     *     published_revision: ?int,
     *     published_at: ?string
     * }
     */
    private function present(Storefront $storefront, ?StorefrontPresentation $row): array
    {
        $draft = $this->normalizer->defaultConfig();
        $draftRevision = 0;
        $published = null;
        $publishedRevision = null;
        $publishedAt = null;
        $schemaVersion = StorefrontPresentationNormalizer::VERSION;

        if ($row !== null) {
            $schemaVersion = StorefrontPresentationNormalizer::VERSION;
            // CUST-H1-1: وسمان منفصلان لا وسم مشترك — حفظ المسودة (عبر
            // الواجهة القديمة أو نسخة العمل المتوافقة عبر واجهة النسخ)
            // يقدّم `draft_schema_version` وحده؛ يجب ألا يغيّر تفسير
            // `published_config` القائم إطلاقاً (§12).
            $draft = $this->normalizer->normalize(
                $row->draft_config ?? null,
                $this->effectiveSchemaTag($row->draft_config ?? [], (int) $row->draft_schema_version),
            );
            $draftRevision = (int) $row->draft_revision;
            if (is_array($row->published_config)) {
                $published = $this->normalizer->normalize(
                    $row->published_config,
                    $this->effectiveSchemaTag($row->published_config, $row->published_schema_version ?? $row->schema_version),
                );
                $publishedRevision = $row->published_revision !== null ? (int) $row->published_revision : null;
                $publishedAt = $row->published_at?->toJSON();
            }
        }

        return [
            'storefront_id' => $storefront->id,
            'schema_version' => $schemaVersion,
            'draft' => $draft,
            'draft_revision' => $draftRevision,
            'published' => $published,
            'published_revision' => $publishedRevision,
            'published_at' => $publishedAt,
        ];
    }

    /** @param  array<string, mixed>  $config */
    private function assertStoredSize(array $config): void
    {
        if ($this->normalizer->encodedSize($config) > StorefrontPresentationNormalizer::MAX_DOCUMENT_BYTES) {
            throw new PresentationDocumentTooLargeException;
        }
    }

    /**
     * فشل آمن على وثيقة **واردة** قبل أي تطبيع: `normalize()` بلا
     * `$storedSchemaVersion` لا يرفض إصداراً معلَناً أحدث من الحالي وحده —
     * يتجاهله ويطبّع بصمت. يُستعمل في مسار الحفظ القديم فقط؛ النشر القديم
     * يقرأ مستنداً **مخزَّناً بالفعل** فيُفحص عبر `assertSupportedLegacySchema`.
     *
     * @param  array<string, mixed>  $config
     */
    private function assertIncomingConfigNotForward(array $config): void
    {
        if (
            isset($config['version'])
            && is_numeric($config['version'])
            && (int) $config['version'] > StorefrontPresentationNormalizer::VERSION
        ) {
            throw new ForwardSchemaVersionException;
        }
    }

    /**
     * فشل آمن على رأسٍ **مخزَّن بالفعل** قبل أي تطبيع: يحمي GET والنشر
     * القديمين من افتراض "AWJ Modern" الصامت حين يحمل الصفّ وسم مخطط أحدث
     * من الإصدار الحالي (مثلاً بعد تراجع نشرٍ عقب ترقية) — القائمة الصريحة
     * في المعمارية تشمل "legacy GET/PUT mapping" و"immediate Publish".
     */
    private function assertSupportedLegacySchema(StorefrontPresentation $row): void
    {
        if ((int) $row->draft_schema_version > StorefrontPresentationNormalizer::VERSION) {
            throw new ForwardSchemaVersionException;
        }

        if ($row->published_schema_version !== null && (int) $row->published_schema_version > StorefrontPresentationNormalizer::VERSION) {
            throw new ForwardSchemaVersionException;
        }

        // عمود قاعدة البيانات وحده لا يكفي على أيّ من الجانبين — قد يتخلَّف
        // عن كاتبٍ قديم لا يعرفه (مثلاً صفّ أُدرج مباشرة بإصدار تطبيق سابق
        // على CUST-H1-1 فحصل على قيمة `draft_schema_version` الافتراضية رغم
        // أن `draft_config` نفسه v2 فعلياً)، بينما الوثيقة المخزَّنة نفسها
        // تحمل وسمها الحقيقي دوماً.
        if (
            is_array($row->draft_config)
            && $this->effectiveSchemaTag($row->draft_config, null) > StorefrontPresentationNormalizer::VERSION
        ) {
            throw new ForwardSchemaVersionException;
        }

        if (
            is_array($row->published_config)
            && $this->effectiveSchemaTag($row->published_config, null) > StorefrontPresentationNormalizer::VERSION
        ) {
            throw new ForwardSchemaVersionException;
        }
    }

    private function sameDocument(?array $left, array $right): bool
    {
        if ($left === null) {
            return false;
        }

        return json_encode($left, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
            === json_encode($right, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    private function isUniqueViolation(QueryException $e): bool
    {
        $sqlState = $e->errorInfo[0] ?? null;
        $driverCode = $e->errorInfo[1] ?? null;

        return $sqlState === '23505' || $driverCode === 19 || str_contains(strtolower($e->getMessage()), 'unique');
    }
}
