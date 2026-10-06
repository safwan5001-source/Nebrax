<?php

namespace App\Services\Commerce;

use App\Models\StorefrontMedia;
use App\Models\StorefrontMediaDerivative;
use App\Models\StorefrontPublishedMedia;
use App\Services\R2StorageService;
use App\Tenancy\TenantContext;
use Throwable;

/**
 * CUST-HV V2c — المصالِح (V0 §7.9): ينظّف ما لا يشير إليه شيء، في وحداتٍ محدودة،
 * idempotent، **ضمن مستأجرٍ واحدٍ معلَن** (كأداة R2 اليدوية القائمة — لا عبور
 * مستأجرين). لا يعتمد عليه أي ضمانٍ في المسار الحرج: بوابة المرجع المنشور
 * والنشر القرائي (V2c) صحيحتان مع أو بدون تشغيله؛ هو استرجاعُ مساحةٍ فقط.
 * البيئة الإنتاجية بلا `schedule:run` — فهو أمرٌ يدوي/تشغيلي (`storefront-media:reconcile`).
 *
 * ما يفعله:
 *  1. **تطهير الأصول المحذوفة** بعد `purge_after` (افتراضياً 30 يوماً): يحذف ملفات
 *     R2 (الأصل والسلّم والمشتقّات) ثم صفوف المشتقّات ثم يضع الأصل `purged` ويفرغ
 *     `variants`. فشل حذف أي ملفٍ يترك الأصل `deleted` لإعادة المحاولة (لا ملف يتيم
 *     بصفٍّ مفقود).
 *  2. **إزالة مشتقّاتٍ يتيمة:** استخدامٌ (`usage_key`) لم يعد يشير إليه أي مرجعٍ في
 *     مسودةٍ/نسخةٍ/منشور، وأقدم من فترة السماح (افتراضياً 24 ساعة — فلا يُزال إطارٌ
 *     يُحرَّر الآن ولم يُحفَظ بعد).
 *
 * ما **لا** يفعله: لا قائمة R2 ولا مسح بادئات (`R2StorageService` بلا listing عمداً)؛
 * فالأجسام اليتيمة بلا صفٍّ (انقطاعٌ بين الكتابة وتحديث الصف) لا يطالها — ومفاتيح
 * المشتقّات حتميّة فإعادة المحاولة تكتب فوقها، فلا يتراكم صنفٌ منها عملياً.
 */
class StorefrontMediaReconciler
{
    public function __construct(
        private readonly R2StorageService $r2,
        private readonly TenantContext $tenant,
        private readonly StorefrontMediaReferenceScanner $scanner,
    ) {}

    /**
     * @return array{purged_assets:int, failed_assets:int, orphan_usages:int, deleted_files:int, dry_run:bool}
     */
    public function run(string $tenantId, int $limit = 200, bool $dryRun = false): array
    {
        $previous = $this->tenant->id();
        $this->tenant->set($tenantId);

        try {
            $stats = ['purged_assets' => 0, 'failed_assets' => 0, 'orphan_usages' => 0, 'deleted_files' => 0, 'dry_run' => $dryRun];

            $this->purgeDeletedAssets($limit, $dryRun, $stats);
            $this->removeOrphanDerivatives($limit, $dryRun, $stats);

            return $stats;
        } finally {
            if ($previous === null) {
                $this->tenant->forget();
            } else {
                $this->tenant->set($previous);
            }
        }
    }

    /** @param array<string,mixed> $stats */
    private function purgeDeletedAssets(int $limit, bool $dryRun, array &$stats): void
    {
        $due = StorefrontMedia::query()
            ->where('state', StorefrontMedia::STATE_DELETED)
            ->where('purge_after', '<=', now())
            ->orderBy('purge_after')
            ->limit($limit)
            ->get();

        foreach ($due as $media) {
            $derivatives = StorefrontMediaDerivative::query()->where('media_id', $media->id)->get();
            $files = array_values(array_unique(array_filter([
                $media->storage_key,
                ...array_map(static fn (array $v): string => (string) $v['file'], $media->variantList()),
                ...$derivatives->pluck('storage_key')->all(),
            ])));

            if ($dryRun) {
                $stats['purged_assets']++;
                $stats['deleted_files'] += count($files);

                continue;
            }

            if (! $this->deleteFiles($media->id, $files, $stats)) {
                $stats['failed_assets']++;

                continue; // يبقى `deleted` — المحاولة التالية تكمل ما تبقّى.
            }

            StorefrontMediaDerivative::query()->where('media_id', $media->id)->delete();
            StorefrontPublishedMedia::query()->where('media_id', $media->id)->delete();
            $media->forceFill(['state' => StorefrontMedia::STATE_PURGED, 'variants' => null])->save();
            $stats['purged_assets']++;
        }
    }

    /** @param array<string,mixed> $stats */
    private function removeOrphanDerivatives(int $limit, bool $dryRun, array &$stats): void
    {
        $grace = now()->subHours((int) config('storefront_media.derivative_orphan_grace_hours', 24));

        $candidates = StorefrontMediaDerivative::query()
            ->where('created_at', '<=', $grace)
            ->whereIn('state', [StorefrontMediaDerivative::STATE_READY, StorefrontMediaDerivative::STATE_FAILED])
            ->orderBy('created_at')
            ->limit($limit * 8)
            ->get()
            ->groupBy(fn (StorefrontMediaDerivative $d): string => $d->media_id.'|'.$d->usage_key);

        if ($candidates->isEmpty()) {
            return;
        }

        $live = $this->scanner->liveUsageKeys();
        $handled = 0;

        foreach ($candidates as $group) {
            /** @var StorefrontMediaDerivative $first */
            $first = $group->first();
            if (isset($live[$first->media_id][$first->usage_key])) {
                continue;
            }
            if ($handled >= $limit) {
                break;
            }
            $handled++;

            if ($dryRun) {
                $stats['orphan_usages']++;
                $stats['deleted_files'] += $group->count();

                continue;
            }

            if ($this->deleteFiles($first->media_id, $group->pluck('storage_key')->all(), $stats)) {
                StorefrontMediaDerivative::query()->whereKey($group->pluck('id')->all())->delete();
                $stats['orphan_usages']++;
            }
        }
    }

    /**
     * @param  list<string>  $files
     * @param  array<string,mixed>  $stats
     */
    private function deleteFiles(string $mediaId, array $files, array &$stats): bool
    {
        foreach ($files as $file) {
            try {
                $this->r2->delete(StorefrontMedia::R2_DOMAIN, $mediaId, $file);
                $stats['deleted_files']++;
            } catch (Throwable $e) {
                report($e);

                return false;
            }
        }

        return true;
    }
}
