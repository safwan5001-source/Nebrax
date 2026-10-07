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

            $assetQuery = StorefrontMedia::query()
                ->where('state', StorefrontMedia::STATE_ACTIVE)
                ->where('variants_state', StorefrontMedia::VARIANTS_READY)
                ->whereNull('region_luminance');
            $this->eachCandidate($assetQuery, $limit, $stats, 'assets', function (StorefrontMedia $media) use ($dryRun): bool {
                $evidence = $this->assetEvidence($media);
                if ($evidence !== null && ! $dryRun) {
                    $media->forceFill(['region_luminance' => $evidence])->save();
                }

                return $evidence !== null;
            });

            $derivativeQuery = StorefrontMediaDerivative::query()
                ->where('state', StorefrontMediaDerivative::STATE_READY)
                ->whereNull('region_luminance');
            $this->eachCandidate($derivativeQuery, $limit, $stats, 'derivatives', function (StorefrontMediaDerivative $row) use ($dryRun): bool {
                $evidence = $this->scanFile($row->media_id, (string) $row->storage_key, 'transform');
                if ($evidence !== null && ! $dryRun) {
                    $row->forceFill(['region_luminance' => $evidence])->save();
                }

                return $evidence !== null;
            });

            return $stats;
        } finally {
            if ($previous === null) {
                $this->tenant->forget();
            } else {
                $this->tenant->set($previous);
            }
        }
    }

    /**
     * يمرّ على المرشّحين بمؤشّر `id` (لا بـ`limit` على نفس الصفوف): `$limit` يحدّ **ما يُكتَب** لا ما يُفحَص،
     * فصفوفٌ تعذّر قياسها نهائياً (ملف مفقود/تالف) لا تحجب ما بعدها فلا يتعطّل الإكمال أبداً (Codex P2 على #1277).
     * الفاشل يُعاد محاولته في كل تشغيل بلا حالة محفوظة ويُعدّ في `failed`.
     *
     * @param  \Illuminate\Database\Eloquent\Builder<\Illuminate\Database\Eloquent\Model>  $query
     * @param  array{assets:int, derivatives:int, failed:int, dry_run:bool}  $stats
     * @param  callable(\Illuminate\Database\Eloquent\Model): bool  $measure  true = قيس
     */
    private function eachCandidate($query, int $limit, array &$stats, string $counter, callable $measure): void
    {
        $last = null;
        while ($stats[$counter] < $limit) {
            $batch = (clone $query)
                ->when($last !== null, static fn ($q) => $q->where('id', '>', $last))
                ->orderBy('id')
                ->limit(50)
                ->get();
            if ($batch->isEmpty()) {
                return;
            }
            foreach ($batch as $row) {
                $last = $row->id;
                if ($measure($row)) {
                    $stats[$counter]++;
                } else {
                    $stats['failed']++;
                }
                if ($stats[$counter] >= $limit) {
                    return;
                }
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
