<?php

namespace App\Services\AppBuilder;

use App\Models\BuilderApp;
use App\Models\BuilderPublishedExperienceVersion;
use App\Models\Tenant;
use App\Tenancy\TenantContext;

/**
 * ═══════════════════════════════════════════════════════════════
 *  تخطيط هجرة المؤشرات الحيّة — AD-06 (قراءة فقط)
 * ═══════════════════════════════════════════════════════════════
 *
 * يحسب لكل مستأجر **ما كان سيُكتب** لو رُحِّلت مؤشراته: المؤشر = النسخة التي يخدمها `GET commerce/v1/experience` حالياً
 * في السلوك المؤقت (أحدث نشر عبر تطبيقات المستأجر غير المؤرشفة)، بشرط أن يرندرها جيل Runtime معروف. **لا يكتب شيئاً أبداً** —
 * الكتابة الفعلية في الأمر وحده، وبعد موافقة صريحة منفصلة (`--apply` + بوابة المؤشر مفتوحة).
 *
 * الحالات (`status`): `would_create` · `already_pointed` · `no_mobile_channel` · `no_published_versions` · `not_renderable`.
 * `notes` معلومات لا تمنع: `multiple_apps` (قد يختلف انتقاء الأجهزة الأقدم: المؤشر يثبّت تطبيقاً واحداً بينما القديم قد يمرّ
 * بنسخ تطبيق آخر عند عدم توافق الأحدث).
 */
final class LivePointerBackfillPlanner
{
    public function __construct(
        private readonly TenantContext $tenantContext,
        private readonly BuilderLivePointerService $pointers,
        private readonly AppSchemaParser $parser,
        private readonly CompatibilityResolver $resolver,
        private readonly RuntimeGenerations $generations,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function plan(Tenant $tenant): array
    {
        $this->tenantContext->set($tenant->id);
        try {
            $base = ['tenant_id' => $tenant->id, 'tenant' => $tenant->name, 'status' => null, 'notes' => []];

            $channel = $this->pointers->channel();
            if ($channel === null) {
                return ['status' => 'no_mobile_channel'] + $base;
            }
            $base['channel_id'] = $channel->id;

            if ($this->pointers->current($channel->id) !== null) {
                return ['status' => 'already_pointed'] + $base;
            }

            $latest = BuilderPublishedExperienceVersion::query()
                ->whereHas('app', fn ($app) => $app->whereNull('archived_at'))
                ->orderByDesc('published_at')
                ->orderByDesc('created_at')
                ->first();
            if ($latest === null) {
                return ['status' => 'no_published_versions'] + $base;
            }

            $base['app_id'] = $latest->builder_app_id;
            $base['version_id'] = $latest->id;
            $base['version'] = $latest->version;
            $base['published_at'] = $latest->published_at?->toIso8601String();
            if (BuilderApp::query()->whereNull('archived_at')->whereHas('publishedVersions')->count() > 1) {
                $base['notes'][] = 'multiple_apps';
            }

            if (! $this->renderable($latest)) {
                return ['status' => 'not_renderable'] + $base;
            }

            return ['status' => 'would_create'] + $base;
        } finally {
            $this->tenantContext->forget();
        }
    }

    private function renderable(BuilderPublishedExperienceVersion $version): bool
    {
        $schema = $version->schema;
        if (! is_array($schema)) {
            return false;
        }
        try {
            $this->parser->validate($schema);
        } catch (SchemaFormatException) {
            return false;
        }

        return $this->generations->lowestRendering($schema, $this->resolver) !== null;
    }
}
