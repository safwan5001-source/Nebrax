<?php

namespace App\Services\AppBuilder;

use App\Models\BuilderApp;
use App\Models\BuilderLivePointer;
use App\Models\BuilderLivePointerEvent;
use App\Models\BuilderPublishedExperienceVersion;
use App\Models\SalesChannel;
use App\Services\Commerce\MobileSalesChannelResolver;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  سلطة تحريك المؤشر الحي الوحيدة — AD-06 / S05c
 * ═══════════════════════════════════════════════════════════════
 *
 * المؤشر (`builder_live_pointers`) يحدد **أي نسخة منشورة هي الحيّة** لقناة الجوال. لا يُنشئ نسخة ولا يعدّلها (النسخ ثابتة):
 * الترقية والتراجع كلاهما **إعادة توجيه** للمؤشر + صف تدقيق ثابت — لا نسخ ولا كتابة محاسبية.
 *
 * - **ترتيب الأقفال:** صفّ التطبيق الهدف ← صفّ المؤشر. لا يقفل أي مسار آخر المؤشر ثم التطبيق.
 *   التراجع الافتراضي يقرأ هدفه بلا قفل ثم يمرّر `expectedCurrentVersionId` فيتحقق منه بعد القفل (409 إن تحرّك).
 * - **التحقق:** النسخة تخص المستأجر الحالي (نطاق تلقائي) وتصلح للرندر على جيل Runtime معروف واحد على الأقل، وإلا 422.
 * - **idempotent:** ترقية النسخة الحيّة نفسها لا تُنتج حدثاً.
 * - **القناة:** قناة الجوال النشطة المعتمدة للمستأجر (`MobileSalesChannelResolver::canonicalForTenant`) — لا يُقبل معرّف قناة من العميل.
 */
final class BuilderLivePointerService
{
    public function __construct(
        private readonly MobileSalesChannelResolver $channels,
        private readonly TenantContext $tenant,
        private readonly AppSchemaParser $parser,
        private readonly CompatibilityResolver $resolver,
        private readonly RuntimeGenerations $generations,
    ) {}

    /** هل تعمل ميزة المؤشر الحي (بوابة نشر، مغلقة افتراضياً). */
    public static function enabled(): bool
    {
        return (bool) config('app_builder.live_pointer_enabled', false);
    }

    /** قناة الجوال المعتمدة للمستأجر الحالي، أو null. */
    public function channel(): ?SalesChannel
    {
        $tenantId = $this->tenant->id();

        return $tenantId === null ? null : $this->channels->canonicalForTenant($tenantId);
    }

    /** المؤشر الحالي للقناة، أو null (لا مؤشر ⇒ السلوك المؤقت القديم). */
    public function current(string $salesChannelId): ?BuilderLivePointer
    {
        return BuilderLivePointer::query()->where('sales_channel_id', $salesChannelId)->first();
    }

    /**
     * @throws RuntimeException لا قناة جوال، أو النسخة لا تصلح للرندر على أي جيل معروف.
     * @throws LivePointerConflictException المؤشر تحرّك عمّا توقّعه المستدعي.
     */
    public function promote(
        BuilderPublishedExperienceVersion $version,
        ?string $actorId,
        ?string $reason = null,
        string $action = BuilderLivePointerEvent::ACTION_PROMOTE,
        ?string $expectedCurrentVersionId = null,
    ): BuilderLivePointer {
        return $this->perform($version, $actorId, $reason, $action, $expectedCurrentVersionId, createOnly: false)[0];
    }

    /**
     * إنشاء مؤشر **فقط إن لم يوجد** (للهجرة): يفحص الغياب تحت أقفال الكتابة نفسها (التطبيق ثم المؤشر)، فإن أنشأه كاتب آخر بين التخطيط والتنفيذ
     * (ترقية مدير مثلاً) **يتخطّى ولا يحدّث** — فلا تُمحى ترقية متعمَّدة.
     *
     * @return bool هل أُنشئ المؤشر فعلاً (false = كان موجوداً فتُرك كما هو).
     *
     * @throws RuntimeException لا قناة جوال، أو النسخة لا تصلح للرندر.
     */
    public function createIfAbsent(BuilderPublishedExperienceVersion $version, ?string $actorId, ?string $reason = null): bool
    {
        return $this->perform($version, $actorId, $reason, BuilderLivePointerEvent::ACTION_PROMOTE, null, createOnly: true)[1];
    }

    /** @return array{0: BuilderLivePointer, 1: bool} المؤشر، وهل كتبت العملية شيئاً (مؤشراً جديداً أو تحريكاً). */
    private function perform(
        BuilderPublishedExperienceVersion $version,
        ?string $actorId,
        ?string $reason,
        string $action,
        ?string $expectedCurrentVersionId,
        bool $createOnly,
    ): array {
        $channel = $this->channel();
        if ($channel === null) {
            throw new RuntimeException('لا توجد قناة جوال نشطة لهذا المستأجر.');
        }

        return DB::transaction(function () use ($version, $actorId, $reason, $action, $expectedCurrentVersionId, $createOnly, $channel): array {
            // 1) قفل التطبيق الهدف، ثم إعادة قراءة النسخة بعد القفل.
            $lockedApp = BuilderApp::query()->whereKey($version->builder_app_id)->lockForUpdate()->firstOrFail();
            if ($lockedApp->isArchived()) {
                throw new RuntimeException('التطبيق مؤرشف ولا يمكن جعل نسخة منه حيّة.');
            }
            $target = BuilderPublishedExperienceVersion::query()->whereKey($version->id)->firstOrFail();

            $this->assertRenderable($target);

            // 2) قفل المؤشر (أو إنشاؤه كسولاً دون سباق).
            $pointer = BuilderLivePointer::query()->where('sales_channel_id', $channel->id)->lockForUpdate()->first();
            $fromId = $pointer?->live_version_id;

            if ($createOnly && $pointer !== null) {
                return [$pointer, false]; // موجود: لا يُمسّ.
            }

            if ($expectedCurrentVersionId !== null && $fromId !== $expectedCurrentVersionId) {
                throw new LivePointerConflictException('pointer_changed', 'تغيّرت النسخة الحيّة أثناء العملية. أعد التحميل وحاول مجدداً.');
            }

            if ($pointer === null) {
                $now = now();
                $inserted = DB::table('builder_live_pointers')->insertOrIgnore([
                    'id' => (string) Str::orderedUuid(),
                    'tenant_id' => $channel->tenant_id,
                    'sales_channel_id' => $channel->id,
                    'builder_app_id' => $target->builder_app_id,
                    'live_version_id' => $target->id,
                    'updated_by' => $actorId,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
                $pointer = BuilderLivePointer::query()->where('sales_channel_id', $channel->id)->lockForUpdate()->firstOrFail();
                if ($inserted === 0) {
                    if ($createOnly) {
                        return [$pointer, false]; // خسرنا سباق الإنشاء: كاتب آخر أنشأه، فلا نحدّثه.
                    }
                    // خسرنا سباق الإنشاء: المؤشر موجود الآن، فنحدّثه كما لو كان قائماً.
                    $fromId = $pointer->live_version_id;
                }
            }

            if ($pointer->live_version_id === $target->id && $fromId === $target->id) {
                return [$pointer, false]; // idempotent: لا حدث.
            }

            if ($pointer->live_version_id !== $target->id) {
                $pointer->forceFill([
                    'builder_app_id' => $target->builder_app_id,
                    'live_version_id' => $target->id,
                    'updated_by' => $actorId,
                ])->save();
            }

            BuilderLivePointerEvent::create([
                'sales_channel_id' => $channel->id,
                'action' => $action,
                'from_version_id' => $fromId,
                'to_version_id' => $target->id,
                'actor_id' => $actorId,
                'reason' => $reason,
            ]);

            return [$pointer->refresh(), true];
        });
    }

    /**
     * تراجع: إعادة توجيه المؤشر إلى `$targetVersionId` الصريح، أو إلى النسخة التي كانت حيّة قبل الحالية (آخر حدث).
     *
     * @throws RuntimeException لا قناة أو النسخة غير صالحة.
     * @throws LivePointerConflictException لا نسخة سابقة صالحة، أو المؤشر تحرّك.
     */
    public function rollback(?string $targetVersionId, ?string $actorId, ?string $reason = null): BuilderLivePointer
    {
        $channel = $this->channel();
        if ($channel === null) {
            throw new RuntimeException('لا توجد قناة جوال نشطة لهذا المستأجر.');
        }
        $pointer = $this->current($channel->id);
        if ($pointer === null) {
            throw new LivePointerConflictException('no_rollback_target', 'لا توجد نسخة حيّة لتتراجع عنها.');
        }

        $target = null;
        if ($targetVersionId !== null) {
            $target = BuilderPublishedExperienceVersion::query()->whereKey($targetVersionId)->first();
        } else {
            $last = BuilderLivePointerEvent::query()
                ->where('sales_channel_id', $channel->id)
                ->whereNotNull('from_version_id')
                ->orderByDesc('created_at')->orderByDesc('id')
                ->first();
            $target = $last?->from_version_id === null
                ? null
                : BuilderPublishedExperienceVersion::query()->whereKey($last->from_version_id)->first();
        }

        if ($target === null) {
            throw new LivePointerConflictException('no_rollback_target', 'لا توجد نسخة سابقة صالحة للتراجع إليها.');
        }
        if ($target->id === $pointer->live_version_id) {
            throw new LivePointerConflictException('no_rollback_target', 'هذه هي النسخة الحيّة بالفعل.');
        }

        return $this->promote($target, $actorId, $reason, BuilderLivePointerEvent::ACTION_ROLLBACK, $pointer->live_version_id);
    }

    /** نسخة تصلح للنشر الحيّ: تحليل بنيوي سليم وتُرندَر على جيل Runtime معروف واحد على الأقل. */
    private function assertRenderable(BuilderPublishedExperienceVersion $version): void
    {
        $schema = $version->schema;
        if (! is_array($schema)) {
            throw new RuntimeException('مخطط النسخة تالف ولا يمكن جعلها حيّة.');
        }
        try {
            $this->parser->validate($schema);
        } catch (SchemaFormatException) {
            throw new RuntimeException('مخطط النسخة غير صالح ولا يمكن جعلها حيّة.');
        }
        if ($this->generations->lowestRendering($schema, $this->resolver) === null) {
            throw new RuntimeException('هذه النسخة لا يرندرها أي إصدار معروف من تطبيق الجوال ولا يمكن جعلها حيّة.');
        }
    }
}
