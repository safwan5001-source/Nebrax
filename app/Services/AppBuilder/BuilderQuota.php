<?php

namespace App\Services\AppBuilder;

use App\Models\BuilderApp;
use App\Models\BuilderPublishedExperienceVersion;
use App\Models\PreviewExchangeReference;
use App\Models\PreviewSession;
use App\Models\Tenant;
use App\Support\PlanGate;
use App\Tenancy\TenantContext;

/**
 * حدود كمية صانع التطبيقات (DRF-07 / S02c) عبر `PlanGate` — «السياسة تُضبط ولا تُفرض» (قاعدة 6):
 *  - الحدّ = تجاوز المستأجر (`plan_limits`) ثم افتراضي الخطة (سخيّ)؛ `null` = بلا حدّ.
 *  - تُستدعى **داخل معاملة الإنشاء بعد قفل الصف المسؤول** (المستأجر للتطبيقات، التطبيق للنسخ والمعاينة) فلا يتجاوز طلبان
 *    متزامنان الحدّ معاً. ترتيب الأقفال: لا يقفل أي مسار صانع التطبيقات صفّ المستأجر ثم التطبيق معاً.
 *  - العدّ عبر نماذج مقيَّدة بالمستأجر (`TenantScope`) — لا استعلام يتجاوز العزل.
 *
 * تتبع الجلسات النشطة = جلسات غير مبطَلة وغير منتهية + مراجع تبادل غير مستهلكة وغير منتهية (تتحوّل إلى جلسات جهاز).
 */
final class BuilderQuota
{
    public const APPS = 'builder_apps';

    public const VERSIONS = 'builder_versions_per_app';

    public const PREVIEWS = 'builder_active_previews';

    /** قبل إنشاء تطبيق: يُستدعى بعد `lockTenantRow()` داخل معاملة الإنشاء. */
    public function assertCanCreateApp(): void
    {
        $limit = $this->limit(self::APPS);
        if ($limit === null) {
            return;
        }
        $current = BuilderApp::query()->count();
        $this->guard(self::APPS, $limit, $current, "بلغتَ الحدّ الأقصى لعدد التطبيقات في خطتك ({$limit}). احذف تطبيقاً أو رقِّ خطتك.");
    }

    /** قفل صفّ المستأجر لتسلسل إنشاء التطبيقات (داخل معاملة). */
    public function lockTenantRow(): void
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId !== null) {
            Tenant::query()->whereKey($tenantId)->lockForUpdate()->first();
        }
    }

    /** قبل نشر نسخة: يُستدعى بعد قفل صفّ التطبيق داخل معاملة النشر. */
    public function assertCanPublish(BuilderApp $lockedApp): void
    {
        $limit = $this->limit(self::VERSIONS);
        if ($limit === null) {
            return;
        }
        $current = BuilderPublishedExperienceVersion::query()->where('builder_app_id', $lockedApp->id)->count();
        $this->guard(self::VERSIONS, $limit, $current, "بلغ هذا التطبيق الحدّ الأقصى لعدد النسخ المنشورة في خطتك ({$limit}).");
    }

    /** قبل إصدار جلسة/مرجع معاينة: بعد قفل صفّ التطبيق داخل معاملة الإصدار. */
    public function assertCanIssuePreview(BuilderApp $lockedApp): void
    {
        $limit = $this->limit(self::PREVIEWS);
        if ($limit === null) {
            return;
        }
        $now = now();
        $sessions = PreviewSession::query()
            ->where('builder_app_id', $lockedApp->id)
            ->whereNull('revoked_at')
            ->where('expires_at', '>', $now)
            ->count();
        $references = PreviewExchangeReference::query()
            ->where('builder_app_id', $lockedApp->id)
            ->whereNull('consumed_at')
            ->where('expires_at', '>', $now)
            ->count();
        $this->guard(self::PREVIEWS, $limit, $sessions + $references, "بلغ هذا التطبيق الحدّ الأقصى لجلسات المعاينة النشطة ({$limit}). انتظر انتهاء بعضها أو أبطِلها.");
    }

    private function limit(string $key): ?int
    {
        $tenantId = app(TenantContext::class)->id();
        $tenant = $tenantId === null ? null : Tenant::find($tenantId);

        return $tenant === null ? null : PlanGate::limit($tenant, $key);
    }

    private function guard(string $resource, int $limit, int $current, string $message): void
    {
        if ($current >= $limit) {
            throw new PlanLimitExceededException($resource, $limit, $current, $message);
        }
    }
}
