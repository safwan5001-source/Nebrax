<?php

namespace App\Services\Commerce;

use App\Models\StorefrontPresentation;
use App\Models\StorefrontPresentationVersion;
use Illuminate\Support\Facades\DB;

/**
 * CUST-HV V2a — أين يُشار إلى أصلٍ من مكتبة وسائط المُخصِّص؟
 *
 * الوثيقة تخزّن `MediaRef` فقط (معرّف + معاملات) — V0 §7.8. هذا الماسح لا
 * يفترض أي موضعٍ بعينه: يمشي على كل مصفوفةٍ في JSON ويلتقط أي كائنٍ يحمل
 * المفتاح `mediaId`، فيعمل تلقائياً لأي حقلٍ تضيفه شرائح V4–V9 بلا تعديل هنا.
 * والمرشَّح النصّي المسبق (`LIKE` على معرّف UUID العشوائي) يحصر فكّ JSON على
 * الصفوف الحاملة له فقط؛ الإيجابيات الكاذبة غير ضارّة (يُتحقَّق بالمشي).
 *
 * المصادر الثلاثة تغطي ما يلزم للمنع من الحذف: كل نسخة (مسودة/مجدولة/منشورة
 * معاً — الحالة تُشتقّ من مؤشرات الرأس لا من عمود) + مسودة الرأس المتوافقة +
 * منشور الرأس المتوافق.
 *
 * يعمل ضمن المستأجر النشط حصراً (النماذج ترث `TenantScope`).
 */
final class StorefrontMediaReferenceScanner
{
    public const CONTAINER_VERSION = 'version';
    public const CONTAINER_HEAD_DRAFT = 'head_draft';
    public const CONTAINER_HEAD_PUBLISHED = 'head_published';

    /**
     * @param  list<string>  $mediaIds
     * @return array<string, list<array{container:string,id:string,storefront_id:string,path:string}>>
     */
    public function referencesFor(array $mediaIds): array
    {
        $wanted = array_values(array_unique(array_filter($mediaIds, static fn ($id): bool => is_string($id) && $id !== '')));
        $found = array_fill_keys($wanted, []);
        if ($wanted === []) {
            return $found;
        }

        foreach ($this->containers($wanted) as $container) {
            foreach ($this->walk($container['config']) as [$id, $path]) {
                if (isset($found[$id])) {
                    $found[$id][] = [
                        'container' => $container['container'],
                        'id' => $container['id'],
                        'storefront_id' => $container['storefront_id'],
                        'path' => $path,
                    ];
                }
            }
        }

        return $found;
    }

    /**
     * كل معرّفات الوسائط المشار إليها في أي وثيقة للمستأجر (لمرشّح «غير مستخدمة»).
     *
     * @return array<string, true>
     */
    public function allReferencedIds(): array
    {
        $ids = [];
        foreach ($this->containers(null) as $container) {
            foreach ($this->walk($container['config']) as [$id]) {
                $ids[$id] = true;
            }
        }

        return $ids;
    }

    /**
     * كل مرجع `mediaId` داخل وثيقة واحدة، كمسارات بنقاط — تستعمله بوابة النشر
     * لاحقاً (V2c) على الوثيقة المُطبَّعة نفسها.
     *
     * @param  array<mixed>  $config
     * @return list<array{0:string,1:string}> [mediaId, path]
     */
    public function extract(array $config): array
    {
        return $this->walk($config);
    }

    /**
     * كل `MediaRef` كاملاً (العقدة نفسها لا المعرّف وحده) داخل وثيقة واحدة —
     * بوابة النشر تحتاج الحقول المجاورة (`alt`, `decorative`, `crop`…).
     *
     * @param  array<mixed>  $config
     * @return list<array{path:string,ref:array<string,mixed>}>
     */
    public function extractRefs(array $config): array
    {
        return $this->walkNodes($config);
    }

    /**
     * هويّات الاستخدام (`usage_key`) الحيّة لكل وسيط في **كل** وثائق المستأجر
     * (مسودة/نسخ/منشور) — يعتمدها المصالِح لإزالة مشتقّاتٍ لم يعد يشير إليها شيء.
     * مرجعٌ بتحويلٍ غير صالح لا يحمي شيئاً (لا مفتاح له) فيُتجاوز.
     *
     * @return array<string, array<string,true>> mediaId ⇒ [usageKey ⇒ true]
     */
    public function liveUsageKeys(): array
    {
        $live = [];
        foreach ($this->containers(null) as $container) {
            foreach ($this->walkNodes($container['config']) as ['ref' => $ref]) {
                try {
                    $transform = StorefrontMediaTransform::fromInput([
                        'crop' => $ref['crop'] ?? null,
                        'rotate' => $ref['rotate'] ?? 0,
                        'focal' => $ref['focal'] ?? null,
                        'fit' => $ref['fit'] ?? 'cover',
                    ]);
                } catch (\InvalidArgumentException) {
                    continue;
                }
                if (! $transform->isDefault()) {
                    $live[$ref['mediaId']][$transform->usageKey($ref['mediaId'])] = true;
                }
            }
        }

        return $live;
    }

    /**
     * @param  list<string>|null  $needles  null = كل الصفوف
     * @return iterable<array{container:string,id:string,storefront_id:string,config:array<mixed>}>
     */
    private function containers(?array $needles): iterable
    {
        yield from $this->rows(StorefrontPresentationVersion::query(), 'config', self::CONTAINER_VERSION, $needles);
        yield from $this->rows(StorefrontPresentation::query(), 'draft_config', self::CONTAINER_HEAD_DRAFT, $needles);
        yield from $this->rows(StorefrontPresentation::query()->whereNotNull('published_config'), 'published_config', self::CONTAINER_HEAD_PUBLISHED, $needles);
    }

    /**
     * @param  \Illuminate\Database\Eloquent\Builder<\Illuminate\Database\Eloquent\Model>  $query
     * @param  list<string>|null  $needles
     * @return iterable<array{container:string,id:string,storefront_id:string,config:array<mixed>}>
     */
    private function rows($query, string $column, string $container, ?array $needles): iterable
    {
        if ($needles !== null) {
            // CAST: عمود JSON في PostgreSQL لا يقبل LIKE مباشرةً؛ SQLite يقبله.
            $query->where(function ($q) use ($column, $needles): void {
                foreach ($needles as $needle) {
                    $q->orWhereRaw('CAST('.DB::getQueryGrammar()->wrap($column).' AS TEXT) LIKE ?', ['%'.$needle.'%']);
                }
            });
        } else {
            $query->whereRaw('CAST('.DB::getQueryGrammar()->wrap($column).' AS TEXT) LIKE ?', ['%mediaId%']);
        }

        foreach ($query->cursor() as $model) {
            $config = $model->{$column};
            if (is_array($config)) {
                yield [
                    'container' => $container,
                    'id' => (string) $model->getKey(),
                    'storefront_id' => (string) $model->storefront_id,
                    'config' => $config,
                ];
            }
        }
    }

    /**
     * @param  array<mixed>  $node
     * @return list<array{path:string,ref:array<string,mixed>}>
     */
    private function walkNodes(array $node, string $path = ''): array
    {
        $hits = [];

        if (isset($node['mediaId']) && is_string($node['mediaId']) && $node['mediaId'] !== '') {
            $hits[] = ['path' => $path === '' ? '$' : $path, 'ref' => $node];
        }

        foreach ($node as $key => $value) {
            if (is_array($value)) {
                $child = $path === '' ? (string) $key : $path.'.'.$key;
                array_push($hits, ...$this->walkNodes($value, $child));
            }
        }

        return $hits;
    }

    /**
     * @param  array<mixed>  $node
     * @return list<array{0:string,1:string}>
     */
    private function walk(array $node, string $path = ''): array
    {
        $hits = [];

        if (isset($node['mediaId']) && is_string($node['mediaId']) && $node['mediaId'] !== '') {
            $hits[] = [$node['mediaId'], $path === '' ? '$' : $path];
        }

        foreach ($node as $key => $value) {
            if (is_array($value)) {
                $child = $path === '' ? (string) $key : $path.'.'.$key;
                array_push($hits, ...$this->walk($value, $child));
            }
        }

        return $hits;
    }
}
