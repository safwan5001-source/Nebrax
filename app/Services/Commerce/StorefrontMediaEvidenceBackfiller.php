<?php

namespace App\Services\Commerce;

use App\Models\StorefrontMedia;
use App\Models\StorefrontMediaDerivative;
use App\Services\R2StorageService;
use App\Tenancy\TenantContext;
use Intervention\Image\Interfaces\ImageManagerInterface;
use Throwable;

/**
 * CUST-HV V6b-1 — يُكمل دليل البكسل للأصول والمشتقّات التي سبقت هذه المرحلة (`region_luminance` فارغ).
 * **ضمن مستأجرٍ واحدٍ معلَن** كأداة المصالِح (لا عبور مستأجرين)، محدود الدفعة، idempotent، يدوي
 * (`storefront-media:backfill-evidence`) — والنشر يبقى قراءةً فقط: لا يولّد ولا يحسب بكسلاً من R2.
 *
 * يقيس **الملفات المُقدَّمة فعلاً**: للأصل أعرض درجةٍ في السلّم بصيغتَيها (WebP وJPEG) ويأخذ اتحاد حدودهما؛
 * وللمشتقّ ملفَّه هو. الملف المُقدَّم يحمل رنين ترميزه فعلاً، والهامش في {@see StorefrontMediaPixelEvidence::bounds}
 * يُضاف فوقه (أكثر تحفظاً لا أقل). ما تعذّر قياسه (ملفٌ مفقود أو غير قابل للفك) يبقى فارغاً ويُعدّ فاشلاً،
 * فيظل غير قابلٍ للإثبات (fail-closed) بدل أن يُخمَّن.
 */
class StorefrontMediaEvidenceBackfiller
{
    public function __construct(
        private readonly R2StorageService $r2,
        private readonly TenantContext $tenant,
        private readonly ImageManagerInterface $images,
    ) {}

    /**
     * @return array{assets:int, derivatives:int, failed:int, dry_run:bool}
     */
    public function run(string $tenantId, int $limit = 200, bool $dryRun = false): array
    {
        $previous = $this->tenant->id();
        $this->tenant->set($tenantId);

        try {
            $stats = ['assets' => 0, 'derivatives' => 0, 'failed' => 0, 'dry_run' => $dryRun];

            $assets = StorefrontMedia::query()
                ->where('state', StorefrontMedia::STATE_ACTIVE)
                ->where('variants_state', StorefrontMedia::VARIANTS_READY)
                ->whereNull('region_luminance')
                ->orderBy('created_at')
                ->limit($limit)
                ->get();
            foreach ($assets as $media) {
                $evidence = $this->assetEvidence($media);
                if ($evidence === null) {
                    $stats['failed']++;

                    continue;
                }
                if (! $dryRun) {
                    $media->forceFill(['region_luminance' => $evidence])->save();
                }
                $stats['assets']++;
            }

            $derivatives = StorefrontMediaDerivative::query()
                ->where('state', StorefrontMediaDerivative::STATE_READY)
                ->whereNull('region_luminance')
                ->orderBy('created_at')
                ->limit($limit)
                ->get();
            foreach ($derivatives as $row) {
                $evidence = $this->scanFile($row->media_id, (string) $row->storage_key, 'transform');
                if ($evidence === null) {
                    $stats['failed']++;

                    continue;
                }
                if (! $dryRun) {
                    $row->forceFill(['region_luminance' => $evidence])->save();
                }
                $stats['derivatives']++;
            }

            return $stats;
        } finally {
            if ($previous === null) {
                $this->tenant->forget();
            } else {
                $this->tenant->set($previous);
            }
        }
    }

    /** @return array<string,mixed>|null */
    private function assetEvidence(StorefrontMedia $media): ?array
    {
        $widest = 0;
        foreach ($media->variantList() as $variant) {
            if (($variant['kind'] ?? null) === StorefrontMediaVariantGenerator::KIND_WIDTH) {
                $widest = max($widest, (int) $variant['width']);
            }
        }
        if ($widest === 0) {
            return null;
        }

        $union = null;
        foreach ($media->variantList() as $variant) {
            if (($variant['kind'] ?? null) !== StorefrontMediaVariantGenerator::KIND_WIDTH || (int) $variant['width'] !== $widest) {
                continue;
            }
            $one = $this->scanFile($media->id, (string) $variant['file'], 'frame');
            if ($one === null) {
                return null; // أحد الملفين تعذّر قياسه: لا ندّعي دليلاً ناقصاً.
            }
            $union = $union === null ? $one : $this->union($union, $one);
        }

        return $union;
    }

    /** @return array<string,mixed>|null */
    private function scanFile(string $mediaId, string $file, string $basis): ?array
    {
        if ($file === '') {
            return null;
        }
        try {
            $bytes = $this->r2->get(StorefrontMedia::R2_DOMAIN, $mediaId, $file);

            return StorefrontMediaPixelEvidence::scan($this->images->decodeBinary((string) $bytes), $basis);
        } catch (Throwable) {
            return null;
        }
    }

    /**
     * اتحاد قياسَين: أدنى الأدنيات وأقصى الأقصيات، والشفافية إن وُجدت في أيٍّ منهما.
     *
     * @param  array<string,mixed>  $a
     * @param  array<string,mixed>  $b
     * @return array<string,mixed>
     */
    private function union(array $a, array $b): array
    {
        $a['min'] = [min($a['min'][0], $b['min'][0]), min($a['min'][1], $b['min'][1]), min($a['min'][2], $b['min'][2])];
        $a['max'] = [max($a['max'][0], $b['max'][0]), max($a['max'][1], $b['max'][1]), max($a['max'][2], $b['max'][2])];
        $a['alpha'] = $a['alpha'] || $b['alpha'];

        return $a;
    }
}
