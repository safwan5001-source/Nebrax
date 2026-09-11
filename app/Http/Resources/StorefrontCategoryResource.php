<?php

namespace App\Http\Resources;

use App\Models\ProductCategory;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Public storefront catalog — تمثيل تصنيف للقراءة العامة المجهولة. لا حراسة
 * نشر على مستوى التصنيف نفسه (بنية تصفّح مشتركة)؛ حراسة النشر تبقى على
 * مستوى المنتج فقط.
 *
 * `$childDepth` يتحكم بعمق تعشيش الأبناء (٢ لقائمة الجذور، ١ لتفاصيل تصنيف
 * واحد) — يتناقص مع كل مستوى فيتوقف عند صفر، فلا حاجة لتحميل الشجرة كاملةً.
 */
class StorefrontCategoryResource extends JsonResource
{
    /**
     * @param  array<int, ProductCategory>  $ancestors  من الجذر إلى الأب المباشر
     */
    public function __construct(
        ProductCategory $resource,
        private readonly int $childDepth = 0,
        private readonly array $ancestors = [],
    ) {
        parent::__construct($resource);
    }

    public function toArray(Request $request): array
    {
        return [
            'id' => $this->resource->id,
            'name' => $this->resource->name,
            'description' => $this->resource->description,
            'color' => $this->resource->color,
            'parent_id' => $this->resource->parent_id,
            'children' => $this->when(
                $this->childDepth > 0 && $this->resource->relationLoaded('children'),
                fn () => $this->resource->children
                    ->where('is_active', true)
                    ->values()
                    ->map(fn (ProductCategory $child) => (new self($child, $this->childDepth - 1))->toArray($request))
                    ->all(),
            ),
            'ancestors' => $this->when(
                $this->ancestors !== [],
                fn () => collect($this->ancestors)->map(fn (ProductCategory $ancestor) => [
                    'id' => $ancestor->id,
                    'name' => $ancestor->name,
                ])->all(),
            ),
        ];
    }
}
