<?php

namespace App\Http\Resources;

use App\Models\ProductCategory;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Route;

/**
 * Public storefront catalog — تمثيل تصنيف للقراءة العامة المجهولة. الحراسة
 * نفسها في الاستعلامات (COM-CATALOG-2: `CommerceCategoryListing.is_published`
 * على القناة المحلولة) — هذا المورد مجرّد إسقاط بيانات بلا منطق بوابة خاص به.
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
        $image = $this->publicImage($request);

        return [
            'id' => $this->resource->id,
            'name' => $this->resource->name,
            'description' => $this->resource->description,
            'color' => $this->resource->color,
            'parent_id' => $this->resource->parent_id,
            'image' => $image,
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

    /**
     * The category path is a public storefront route, never the private
     * `image_path`. Commerce/mobile consumers keep the existing projection;
     * only the store/v1 contract gains this additive field.
     *
     * @return array{url:string,alt:string}|null
     */
    private function publicImage(Request $request): ?array
    {
        if (! $this->resource->image_path || ! str_starts_with((string) $request->route()?->getName(), 'storefront.v1.')) {
            return null;
        }

        $route = str_contains((string) $request->route()?->getName(), '.legacy.')
            ? 'storefront.v1.legacy.media.category.show'
            : 'storefront.v1.media.category.show';

        $parameters = ['id' => $this->resource->id];
        if (str_contains($route, '.legacy.')) {
            $parameters['tenantSlug'] = (string) $request->route('tenantSlug');
        }

        return [
            'url' => Route::has($route)
                ? route($route, $parameters, false)
                : '/store/v1/media/categories/'.$this->resource->id,
            'alt' => $this->resource->name,
        ];
    }
}
