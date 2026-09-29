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
 * CUST-H1-1 — أساس ثابت النسخ (list/create/read/save/rename/delete). لا
 * نشر ولا جدولة هنا — تلك لاحقة (CUST-H1-3/CUST-H1-4). مرجعها المعماري:
 * `docs/plans/store/CUST-H1-ARCH-1-THEME-VERSION-PERSISTENCE-SCHEDULING.md`
 * §7 (الحالة A)، §9، §10، §19، §20، §25.
 *
 * المستأجر من `TenantContext` فقط. `{id}` محدِّد صفّ. أجنبي/مفقود → null
 * (404 في المتحكّم). ترتيب الأقفال دائماً Storefront ← head ← Version.
 */
final class StorefrontPresentationVersionService
{
    public function __construct(
        private readonly StorefrontPresentationNormalizer $normalizer,
    ) {}

    /** @return list<array<string, mixed>>|null */
    public function listForCurrentTenant(string $storefrontId): ?array
    {
        $storefront = $this->ownedStorefront($storefrontId);
        if ($storefront === null) {
            return null;
        }

        $head = StorefrontPresentation::query()->where('storefront_id', $storefront->id)->first();

        $versions = StorefrontPresentationVersion::query()
            ->where('storefront_id', $storefront->id)
            ->orderBy('created_at')
            ->orderBy('id')
            ->get();

        return $versions->map(fn (StorefrontPresentationVersion $v) => $this->summarize($v, $head))->all();
    }

    /**
     * @return array<string, mixed>|null
     *
     * @throws SourceVersionNotFoundException
     * @throws ForwardSchemaVersionException
     */
    public function createForCurrentTenant(string $storefrontId, string $name, ?string $sourceVersionId): ?array
    {
        try {
            return $this->attemptCreate($storefrontId, $name, $sourceVersionId);
        } catch (QueryException $e) {
            if (! $this->isUniqueViolation($e)) {
                throw $e;
            }

            // معاملة أخرى أنشأت الرأس بالتزامن — أُعيد المحاولة على معاملة
            // جديدة نظيفة (لا نكمل داخل معاملة Postgres مُجهَضة).
            return $this->attemptCreate($storefrontId, $name, $sourceVersionId);
        }
    }

    /** @return array<string, mixed>|null */
    public function showForCurrentTenant(string $storefrontId, string $versionId): ?array
    {
        $storefront = $this->ownedStorefront($storefrontId);
        if ($storefront === null) {
            return null;
        }

        $version = $this->findOwnedVersion($storefront, $versionId);
        if ($version === null) {
            return null;
        }

        $this->assertSupportedSchema((int) $version->schema_version);

        $head = StorefrontPresentation::query()->where('storefront_id', $storefront->id)->first();

        return $this->detail($version, $head);
    }

    /**
     * @param  array<string, mixed>  $config
     * @return array<string, mixed>|null
     */
    public function saveForCurrentTenant(string $storefrontId, string $versionId, array $config, int $expectedRevision): ?array
    {
        return DB::transaction(function () use ($storefrontId, $versionId, $config, $expectedRevision) {
            $storefront = $this->lockOwnedStorefront($storefrontId);
            if ($storefront === null) {
                return null;
            }

            $head = StorefrontPresentation::query()
                ->where('storefront_id', $storefront->id)
                ->lockForUpdate()
                ->first();

            $version = $this->lockOwnedVersion($storefront, $versionId);
            if ($version === null) {
                return null;
            }

            if ($head !== null && $head->active_version_id === $version->id) {
                throw new ActiveVersionImmutableException;
            }

            if ((int) $version->revision !== $expectedRevision) {
                throw new StaleVersionRevisionException;
            }

            $this->assertSupportedSchema((int) $version->schema_version);
            $this->assertIncomingConfigNotForward($config);

            // يُطبَّع دائماً تحت الإصدار الحالي — لا يُمرَّر وسم النسخة
            // القديم هنا مطلقاً كي لا تُستحضَر دلالات غياب v1 (تراجع
            // أقسام مُحذوفة فعلياً) على مستند حالي يُحفَظ الآن (§11).
            $normalized = $this->normalizer->normalize($config, StorefrontPresentationNormalizer::VERSION);
            $this->assertStoredSize($normalized);

            $newRevision = (int) $version->revision + 1;

            $version->forceFill([
                'config' => $normalized,
                'schema_version' => StorefrontPresentationNormalizer::VERSION,
                'revision' => $newRevision,
            ])->save();

            // CUST-H1-1: إن كانت النسخة المحفوظة هي نسخة العمل المتوافقة
            // ذاتها، يجب مزامنة حقول المسودة على الرأس أيضاً في نفس
            // المعاملة — وإلا رأى عميل قديم (GET/نشر) مستنداً قديماً رغم
            // نجاح الحفظ عبر واجهة النسخ الجديدة. المستند ووسم المخطط زوجٌ
            // ذرّي واحد على الجهتين معاً (§14).
            if ($head !== null && $head->compatibility_working_version_id === $version->id) {
                $head->forceFill([
                    'draft_config' => $normalized,
                    'draft_schema_version' => StorefrontPresentationNormalizer::VERSION,
                    'draft_revision' => $newRevision,
                    'schema_version' => StorefrontPresentationNormalizer::VERSION,
                ])->save();
            }

            return $this->detail($version->fresh(), $head);
        });
    }

    /** @return array<string, mixed>|null */
    public function renameForCurrentTenant(string $storefrontId, string $versionId, string $name, int $expectedRevision): ?array
    {
        return DB::transaction(function () use ($storefrontId, $versionId, $name, $expectedRevision) {
            $storefront = $this->lockOwnedStorefront($storefrontId);
            if ($storefront === null) {
                return null;
            }

            $head = StorefrontPresentation::query()
                ->where('storefront_id', $storefront->id)
                ->lockForUpdate()
                ->first();

            $version = $this->lockOwnedVersion($storefront, $versionId);
            if ($version === null) {
                return null;
            }

            if ((int) $version->revision !== $expectedRevision) {
                throw new StaleVersionRevisionException;
            }

            // فشل آمن قبل أي كتابة: راجع `saveForCurrentTenant()` — نظيرها
            // هنا غائبٌ سابقاً، فكانت إعادة تسمية نسخة بمخطط أمامي (بعد
            // تراجع نشرٍ عقب ترقية) تُثبَّت بصمت، ثم يُطبَّع `detail()`
            // اللاحق مستندها المخزَّن صامتاً إلى افتراضي AWJ Modern بدل رفض
            // الطلب بـ409 — نفس دلالة الفشل الآمن على القراءة/الحفظ/التكرار.
            $this->assertSupportedSchema((int) $version->schema_version);

            $newRevision = (int) $version->revision + 1;

            $version->forceFill([
                'name' => $name,
                'revision' => $newRevision,
            ])->save();

            // CUST-H1-1: رمز التزامن على الرأس (`draft_revision`) يجب أن
            // يبقى مرآةً لمراجعة نسخة العمل المتوافقة حتى عند إعادة تسمية
            // بلا تعديل مستند — وإلا حسب مسار PUT القديم مراجعة قديمة
            // فتقبل حفظاً كان يجب رفضه (409)، أو يُصادف رقماً يطابق ما
            // أرجعته إعادة التسمية دون أن يكون قد تقدّم فعلياً.
            if ($head !== null && $head->compatibility_working_version_id === $version->id) {
                $head->forceFill(['draft_revision' => $newRevision])->save();
            }

            return $this->detail($version->fresh(), $head);
        });
    }

    /**
     * CUST-H1-3 — نشر فوري لنسخة محدَّدة تماماً. مرجعها المعماري:
     * `docs/plans/store/CUST-H1-ARCH-1-...md` §11. ترتيب الأقفال Storefront
     * ← head ← Version كبقية الخدمة. لا حذف للنسخة السابقة النشِطة — تبقى
     * كما هي وتُشتقّ حالتها "مسودة" تلقائياً بمجرّد تحرّك المؤشر عنها.
     *
     * @return array<string, mixed>|null null = المتجر أو النسخة أجنبي/مفقود (404).
     *
     * @throws StaleVersionRevisionException رقم مراجعة النسخة الهدف لا يطابق المقفول.
     * @throws StalePublicationHeadException حالة رأس النشر التي راجعها التاجر لم تعد الحالية.
     * @throws VersionLifecycleConflictException الهدف مجدولٌ حالياً — يجب إلغاء الجدولة أولاً.
     * @throws ForwardSchemaVersionException مخطط الهدف أحدث مما يدعمه الخادم الحالي.
     * @throws PresentationDocumentTooLargeException المستند المطبَّع أكبر من الحد المسموح.
     */
    public function publishForCurrentTenant(
        string $storefrontId,
        string $versionId,
        int $expectedRevision,
        ?int $expectedPublishedRevision,
        ?string $expectedActiveVersionId,
    ): ?array {
        return DB::transaction(function () use (
            $storefrontId,
            $versionId,
            $expectedRevision,
            $expectedPublishedRevision,
            $expectedActiveVersionId,
        ) {
            $storefront = $this->lockOwnedStorefront($storefrontId);
            if ($storefront === null) {
                return null;
            }

            $head = StorefrontPresentation::query()
                ->where('storefront_id', $storefront->id)
                ->lockForUpdate()
                ->first();

            $version = $this->lockOwnedVersion($storefront, $versionId);
            if ($version === null) {
                return null;
            }

            if ((int) $version->revision !== $expectedRevision) {
                throw new StaleVersionRevisionException;
            }

            $currentPublishedRevision = ($head !== null && $head->published_revision !== null)
                ? (int) $head->published_revision
                : null;
            $currentActiveVersionId = $head?->active_version_id;

            if (
                $currentPublishedRevision !== $expectedPublishedRevision
                || $currentActiveVersionId !== $expectedActiveVersionId
            ) {
                throw new StalePublicationHeadException;
            }

            // النشر الفوري (Publish Now) لا يُلغي جدولةً ضمنياً أبداً — التاجر
            // يجب أن يُلغيها صراحةً أولاً من مدير النسخ (خارج نطاق CUST-H1-3).
            if ($head !== null && $head->scheduled_version_id === $version->id) {
                throw new VersionLifecycleConflictException(
                    'هذه النسخة مجدولة للنشر لاحقاً. ألغِ الجدولة أولاً قبل النشر الفوري.'
                );
            }

            // فشل آمن قبل أي تطبيع — راجع نظائرها في save/rename/create أعلاه.
            $this->assertSupportedSchema((int) $version->schema_version);

            $normalized = $this->normalizer->normalize($version->config, (int) $version->schema_version);
            $this->assertStoredSize($normalized);

            // بنية Version لا تعرف كاتباً قديماً يتجاوز هذا المسار (خلافاً
            // للرأس المتوافق) — عمود `schema_version` يعكس المستند المخزَّن
            // دوماً. ترقية/تطبيع الهدف يُثبَّت ذرّياً هنا سواء تغيّر المستند
            // أو لا، دون زيادة مراجعة النسخة (هذا ليس تعديل تاجر، §11 خطوة 11).
            if (
                (int) $version->schema_version !== StorefrontPresentationNormalizer::VERSION
                || ! $this->sameDocument($version->config, $normalized)
            ) {
                $version->forceFill([
                    'config' => $normalized,
                    'schema_version' => StorefrontPresentationNormalizer::VERSION,
                ])->save();
            }

            $alreadyActive = $currentActiveVersionId === $version->id;
            $publishedUnchanged = $head !== null
                && is_array($head->published_config)
                && $this->sameDocument($head->published_config, $normalized);

            if ($alreadyActive && $publishedUnchanged) {
                // نشر مثالي غير مؤثّر (idempotent no-op): لا إعادة كتابة
                // published_at/published_revision بلا تغيّر حقيقي في اللقطة
                // العامة (§11 "Publishing the already-active unchanged version").
                return $this->detail($version->fresh(), $head);
            }

            if ($head === null) {
                // بنيوياً غير قابل للحدوث: أي Version موجودة تعني أن رأسها
                // أُنشئ معها بالفعل (راجع `attemptCreate()`/الهجرة §7 الحالة A) —
                // لا مسار حذفٍ للرأس وحده مستقلاً عن المتجر في هذه الخدمة.
                throw new RuntimeException('رأس عرض المتجر غير موجود لنسخة قائمة — حالة غير متّسقة.');
            }

            $newPublishedRevision = ($head->published_revision !== null ? (int) $head->published_revision : 0) + 1;

            $head->forceFill([
                'published_config' => $normalized,
                'published_schema_version' => StorefrontPresentationNormalizer::VERSION,
                'published_revision' => $newPublishedRevision,
                'published_at' => now(),
                'active_version_id' => $version->id,
            ])->save();

            $version->forceFill(['last_published_at' => now()])->save();

            return $this->detail($version->fresh(), $head->fresh());
        });
    }

    /**
     * @return bool|null null = المتجر أو النسخة أجنبي/مفقود (404).
     *
     * @throws VersionLifecycleConflictException
     */
    public function deleteForCurrentTenant(string $storefrontId, string $versionId): ?bool
    {
        return DB::transaction(function () use ($storefrontId, $versionId) {
            $storefront = $this->lockOwnedStorefront($storefrontId);
            if ($storefront === null) {
                return null;
            }

            $head = StorefrontPresentation::query()
                ->where('storefront_id', $storefront->id)
                ->lockForUpdate()
                ->first();

            $version = $this->lockOwnedVersion($storefront, $versionId);
            if ($version === null) {
                return null;
            }

            if ($head !== null) {
                if ($head->active_version_id === $version->id) {
                    throw new VersionLifecycleConflictException('لا يمكن حذف النسخة المنشورة حالياً.');
                }
                if ($head->scheduled_version_id === $version->id) {
                    throw new VersionLifecycleConflictException('ألغِ الجدولة أولاً قبل حذف هذه النسخة.');
                }
                if ($head->compatibility_working_version_id === $version->id) {
                    throw new VersionLifecycleConflictException(
                        'هذه النسخة هي نسخة العمل الحالية للواجهة القديمة ولا يمكن حذفها الآن.'
                    );
                }
            }

            $version->delete();

            return true;
        });
    }

    /**
     * @return array<string, mixed>|null
     *
     * @throws SourceVersionNotFoundException
     * @throws ForwardSchemaVersionException
     */
    private function attemptCreate(string $storefrontId, string $name, ?string $sourceVersionId): ?array
    {
        return DB::transaction(function () use ($storefrontId, $name, $sourceVersionId) {
            $storefront = $this->lockOwnedStorefront($storefrontId);
            if ($storefront === null) {
                return null;
            }

            $head = StorefrontPresentation::query()
                ->where('storefront_id', $storefront->id)
                ->lockForUpdate()
                ->first();

            if ($head === null) {
                // إدراج كسول أول — عرضة لسباق فريد؛ الاستثناء يتسرّب عمداً
                // خارج DB::transaction() ليُلتقَط في createForCurrentTenant()
                // بعد أن يُنهي Laravel تراجع المعاملة تلقائياً (نمط
                // STORE-BACKEND-1، لا نكمل داخل معاملة Postgres مُجهَضة).
                StorefrontPresentation::create([
                    'storefront_id' => $storefront->id,
                    'tenant_id' => $storefront->tenant_id,
                    'schema_version' => StorefrontPresentationNormalizer::VERSION,
                    'draft_schema_version' => StorefrontPresentationNormalizer::VERSION,
                    'draft_config' => $this->normalizer->defaultConfig(),
                    'draft_revision' => 0,
                ]);

                $head = StorefrontPresentation::query()
                    ->where('storefront_id', $storefront->id)
                    ->lockForUpdate()
                    ->first();
            }

            [$sourceConfig, $sourceSchemaVersion] = $this->resolveSourceConfig($storefront, $head, $sourceVersionId);

            if ($sourceSchemaVersion > StorefrontPresentationNormalizer::VERSION) {
                throw new ForwardSchemaVersionException;
            }

            $normalized = $this->normalizer->normalize($sourceConfig, $sourceSchemaVersion);
            $this->assertStoredSize($normalized);

            $version = StorefrontPresentationVersion::create([
                'tenant_id' => $storefront->tenant_id,
                'storefront_id' => $storefront->id,
                'name' => $name,
                'schema_version' => StorefrontPresentationNormalizer::VERSION,
                'config' => $normalized,
                'revision' => 1,
            ]);

            return $this->detail($version, $head);
        });
    }

    /**
     * @return array{0: array<string, mixed>, 1: int}
     *
     * @throws SourceVersionNotFoundException
     */
    private function resolveSourceConfig(Storefront $storefront, StorefrontPresentation $lockedHead, ?string $sourceVersionId): array
    {
        if ($sourceVersionId !== null) {
            $source = $this->findOwnedVersion($storefront, $sourceVersionId);
            if ($source === null) {
                throw new SourceVersionNotFoundException;
            }

            return [$source->config ?? [], (int) $source->schema_version];
        }

        if ($lockedHead->active_version_id !== null) {
            $active = StorefrontPresentationVersion::query()->whereKey($lockedHead->active_version_id)->first();
            if ($active !== null) {
                return [$active->config ?? [], (int) $active->schema_version];
            }
        }

        // لا نستدعي `ensureCompatibilityWorkingVersion` هنا: تلك تُنشئ
        // وتُثبِّت نسخة عمل متوافقة *دائمة* للواجهة القديمة (مطلوبة هناك
        // صراحةً)، بينما إنشاء نسخة جديدة بلا مصدر يحتاج فقط **قيمة** مصدر
        // افتراضية بلا أثر جانبي — استدعاؤها هنا كان يُنشئ نسخة إضافية غير
        // مطلوبة (نسخة عمل + النسخة المطلوبة فعلياً معاً).
        if ($lockedHead->compatibility_working_version_id !== null) {
            $compat = StorefrontPresentationVersion::query()->whereKey($lockedHead->compatibility_working_version_id)->first();
            if ($compat !== null) {
                return [$compat->config ?? [], (int) $compat->schema_version];
            }
        }

        // وسم الرأس المضمَّن هو مصدر الحقيقة لا عمود `draft_schema_version`
        // وحده — كاتبٌ قديم أنشأ هذا الرأس بعد هذه الهجرة مباشرة قد لا
        // يعرف هذا العمود إطلاقاً فيتركه عند الافتراض (1) رغم أن محتواه v2
        // فعلياً (راجع `StorefrontPresentationNormalizer::effectiveSchemaTag()`).
        $draftConfig = $lockedHead->draft_config ?? $this->normalizer->defaultConfig();

        return [
            $draftConfig,
            StorefrontPresentationNormalizer::effectiveSchemaTag($draftConfig, (int) $lockedHead->draft_schema_version),
        ];
    }

    private function findOwnedVersion(Storefront $storefront, string $versionId): ?StorefrontPresentationVersion
    {
        $version = StorefrontPresentationVersion::query()->whereKey($versionId)->first();

        return $this->matchesStorefront($version, $storefront) ? $version : null;
    }

    private function lockOwnedVersion(Storefront $storefront, string $versionId): ?StorefrontPresentationVersion
    {
        $version = StorefrontPresentationVersion::query()->whereKey($versionId)->lockForUpdate()->first();

        return $this->matchesStorefront($version, $storefront) ? $version : null;
    }

    private function matchesStorefront(?StorefrontPresentationVersion $version, Storefront $storefront): bool
    {
        return $version !== null
            && $version->storefront_id === $storefront->id
            && $version->tenant_id === $storefront->tenant_id;
    }

    /** @return array<string, mixed> */
    private function summarize(StorefrontPresentationVersion $version, ?StorefrontPresentation $head): array
    {
        return [
            'id' => $version->id,
            'storefront_id' => $version->storefront_id,
            'name' => $version->name,
            'state' => $this->deriveState($version, $head),
            'schema_version' => (int) $version->schema_version,
            'revision' => (int) $version->revision,
            'scheduled_for' => $version->scheduled_for?->toJSON(),
            'last_published_at' => $version->last_published_at?->toJSON(),
            'created_at' => $version->created_at?->toJSON(),
            'updated_at' => $version->updated_at?->toJSON(),
            // CUST-H1-3: حالة رأس النشر (`published_revision`) التي يجب على
            // التاجر مراجعتها قبل النشر الفوري — نفس قيمة الرأس على كل صفوف
            // هذا المتجر، وليست مراجعة النسخة نفسها (`revision`). النسخة
            // النشِطة تُعرف من `state === 'published'` في نفس القائمة، فلا
            // حاجة لتسريب `active_version_id` الخام كحقل منفصل.
            'published_revision' => ($head !== null && $head->published_revision !== null)
                ? (int) $head->published_revision
                : null,
        ];
    }

    /** @return array<string, mixed> */
    private function detail(StorefrontPresentationVersion $version, ?StorefrontPresentation $head): array
    {
        return array_merge($this->summarize($version, $head), [
            'config' => $this->normalizer->normalize($version->config, (int) $version->schema_version),
        ]);
    }

    private function deriveState(StorefrontPresentationVersion $version, ?StorefrontPresentation $head): string
    {
        if ($head !== null && $head->active_version_id !== null && $head->active_version_id === $version->id) {
            return 'published';
        }

        if (
            $head !== null
            && $head->scheduled_version_id !== null
            && $head->scheduled_version_id === $version->id
            && $version->scheduled_for !== null
        ) {
            return 'scheduled';
        }

        return 'draft';
    }

    private function assertSupportedSchema(int $schemaVersion): void
    {
        if ($schemaVersion > StorefrontPresentationNormalizer::VERSION) {
            throw new ForwardSchemaVersionException;
        }
    }

    /** @param  array<string, mixed>  $config */
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

    /** @param  array<string, mixed>  $config */
    private function assertStoredSize(array $config): void
    {
        if ($this->normalizer->encodedSize($config) > StorefrontPresentationNormalizer::MAX_DOCUMENT_BYTES) {
            throw new PresentationDocumentTooLargeException;
        }
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

    private function isUniqueViolation(QueryException $e): bool
    {
        $sqlState = $e->errorInfo[0] ?? null;
        $driverCode = $e->errorInfo[1] ?? null;

        return $sqlState === '23505' || $driverCode === 19 || str_contains(strtolower($e->getMessage()), 'unique');
    }

    /** @param  array<string, mixed>  $right */
    private function sameDocument(?array $left, array $right): bool
    {
        if ($left === null) {
            return false;
        }

        return json_encode($left, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
            === json_encode($right, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }
}
