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
     * `$limit` يحدّ ما **يُفحَص** لكل نوعٍ في التشغيل (مكتوباً أو فاشلاً) فيبقى العمل محدوداً حتى مع تخزينٍ
     * متدهور (Codex P2 على #1277)؛ و`next` مؤشّر المتابعة (آخر معرّفٍ فُحص) حين بقي ما لم يُفحَص، يُمرَّر
     * إلى التشغيل التالي في `$after` فيتجاوز البادئة الفاشلة بدل إعادتها. `null` = اكتمل النوع.
     *
     * @param  array{assets?:?string, derivatives?:?string}  $after
     * @return array{assets:int, derivatives:int, failed:int, dry_run:bool, next:array{assets:?string, derivatives:?string}}
     */
    public function run(string $tenantId, int $limit = 200, bool $dryRun = false, array $after = []): array
    {
        $previous = $this->tenant->id();
        $this->tenant->set($tenantId);

        try {
            $stats = ['assets' => 0, 'derivatives' => 0, 'failed' => 0, 'dry_run' => $dryRun, 'next' => ['assets' => null, 'derivatives' => null]];

            $assetQuery = StorefrontMedia::query()
                ->where('state', StorefrontMedia::STATE_ACTIVE)
                ->where('variants_state', StorefrontMedia::VARIANTS_READY)
                ->whereNull('region_luminance');
            $this->eachCandidate($assetQuery, $limit, $after['assets'] ?? null, $stats, 'assets', function (StorefrontMedia $media) use ($dryRun): bool {
                $evidence = $this->assetEvidence($media);
                if ($evidence !== null && ! $dryRun) {
                    $media->forceFill(['region_luminance' => $evidence])->save();
                }

                return $evidence !== null;
            });

            $derivativeQuery = StorefrontMediaDerivative::query()
                ->where('state', StorefrontMediaDerivative::STATE_READY)
                ->whereNull('region_luminance');
            $this->eachCandidate($derivativeQuery, $limit, $after['derivatives'] ?? null, $stats, 'derivatives', function (StorefrontMediaDerivative $row) use ($dryRun): bool {
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
     * يمرّ على المرشّحين بمؤشّر `id`: صفوفٌ تعذّر قياسها نهائياً (ملف مفقود/تالف) لا تحجب ما بعدها لأن التشغيل
     * التالي يبدأ بعد آخر ما فُحص (`next`)، و`$limit` يحدّ المفحوص فيبقى العمل محدوداً. الفاشل يُعدّ في `failed`.
     *
     * @param  \Illuminate\Database\Eloquent\Builder<\Illuminate\Database\Eloquent\Model>  $query
     * @param  array{assets:int, derivatives:int, failed:int, dry_run:bool, next:array{assets:?string, derivatives:?string}}  $stats
     * @param  callable(\Illuminate\Database\Eloquent\Model): bool  $measure  true = قيس
     */
    private function eachCandidate($query, int $limit, ?string $after, array &$stats, string $counter, callable $measure): void
    {
        $rows = (clone $query)
            ->when($after !== null && $after !== '', static fn ($q) => $q->where('id', '>', $after))
            ->orderBy('id')
            ->limit($limit + 1) // الصفّ الزائد يكشف أن هناك ما بعد الدفعة دون عدٍّ إضافي
            ->get();

        $examined = 0;
        foreach ($rows as $row) {
            if ($examined >= $limit) {
                return; // بقي ما لم يُفحَص: `next` يشير إلى آخر مفحوص
            }
            $examined++;
            $stats['next'][$counter] = $row->id;
            if ($measure($row)) {
                $stats[$counter]++;
            } else {
                $stats['failed']++;
            }
        }
        $stats['next'][$counter] = null; // استُنفد النوع
    }

    /**
     * اتحاد قياس **كل** ملفات السلّم المُقدَّمة (كل درجة، WebP وJPEG): كل ملفٍّ يحمل تشوّه ترميزه هو
     * (Codex P1 على #1277)، والمولِّد يفعل الشيء نفسه عند الرفع.
     *
     * @return array<string,mixed>|null
     */
    private function assetEvidence(StorefrontMedia $media): ?array
    {
        $union = null;
        foreach ($media->variantList() as $variant) {
            if (($variant['kind'] ?? null) !== StorefrontMediaVariantGenerator::KIND_WIDTH) {
                continue;
            }
            $one = $this->scanFile($media->id, (string) $variant['file'], 'frame');
            if ($one === null) {
                return null; // أحد الملفات تعذّر قياسه: لا ندّعي دليلاً ناقصاً.
            }
            $union = $union === null ? $one : StorefrontMediaPixelEvidence::union($union, $one);
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
}
