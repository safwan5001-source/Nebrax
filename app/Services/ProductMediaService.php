<?php

namespace App\Services;

use App\Models\Product;
use App\Models\ProductMedia;
use App\Models\ProductOptionValue;
use App\Models\ProductVariant;
use App\Services\DocumentCenter\DocumentStorageService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  ProductMediaService — التخزين الفعلي لوسائط قيمة الخيار/المتغيّر (VAR-MEDIA-1)
 * ═══════════════════════════════════════════════════════════════
 *  يوازي منطق `ProductController::storeMedia()`/`destroyMedia()` القائم
 *  حرفياً (نفس `DocumentStorageService`، نفس مسار التخزين، نفس نمط الحذف
 *  بعد الالتزام) لكن للنطاقين الجديدين. مسار المنتج القائم **لم يُمسّ** —
 *  هذا الصنف إضافةٌ موازية لا إعادة كتابة.
 *
 *  **سقف الثمان صورٍ لكل نطاقٍ على حدة**، لا مُجمَّعاً مع صور المنتج ولا مع
 *  نطاقاتٍ أخرى: القيمة القائمة (٨) خاصة بمعرض المنتج المشترك وحده منذ
 *  إنشائها؛ تكرارها لكل نطاقٍ جديدٍ مستقل هو التفسير الأصغر توافقاً رجعياً —
 *  معرض المنتج القائم يبقى ٨ بلا أي تغيير، والنطاقان الجديدان يبدآن بنفس
 *  الرقم المعتمَد بدل اختلاق حدٍّ جديد.
 */
class ProductMediaService
{
    private const MAX_PER_SCOPE = 8;

    public function __construct(private readonly DocumentStorageService $documentStorage) {}

    /**
     * مستوى المنتج المشترك — يوازي `ProductController::storeMedia()` منطقاً
     * (نفس السقف والمسار)؛ موجودةٌ هنا أيضاً كمرجعٍ اختباريٍّ واحد، لا لتغيير
     * مسار التحكّم القائم الذي يبقى بمنطقه المضمَّن كما هو.
     *
     * @param  list<UploadedFile>  $files
     */
    public function attachToProduct(Product $product, array $files, ?string $uploadedBy): array
    {
        return $this->store($product, $files, $uploadedBy, [
            'countQuery' => fn () => ProductMedia::where('product_id', $product->id)
                ->whereNull('product_option_value_id')->whereNull('product_variant_id'),
        ]);
    }

    /** @param  list<UploadedFile>  $files */
    public function attachToOptionValue(Product $product, ProductOptionValue $value, array $files, ?string $uploadedBy): array
    {
        if ($value->option?->product_id !== $product->id) {
            throw new RuntimeException('قيمة الخيار المحدَّدة لا تخصّ هذا المنتج.');
        }

        return $this->store($product, $files, $uploadedBy, [
            'product_option_value_id' => $value->id,
            'countQuery' => fn () => ProductMedia::where('product_option_value_id', $value->id),
        ]);
    }

    /** @param  list<UploadedFile>  $files */
    public function attachToVariant(Product $product, ProductVariant $variant, array $files, ?string $uploadedBy): array
    {
        if ($variant->product_id !== $product->id) {
            throw new RuntimeException('المتغيّر المحدَّد لا يتبع هذا المنتج.');
        }

        return $this->store($product, $files, $uploadedBy, [
            'product_variant_id' => $variant->id,
            'countQuery' => fn () => ProductMedia::where('product_variant_id', $variant->id),
        ]);
    }

    /** @param  list<UploadedFile>  $files */
    private function store(Product $product, array $files, ?string $uploadedBy, array $scope): array
    {
        $countQuery = $scope['countQuery'];
        unset($scope['countQuery']);

        if ($countQuery()->count() + count($files) > self::MAX_PER_SCOPE) {
            throw new RuntimeException('الحد الأقصى للوسائط في هذا النطاق هو '.self::MAX_PER_SCOPE.' صور. احذف صورة قبل الرفع.');
        }

        $start = (int) ($countQuery()->max('sort_order') ?? -1) + 1;
        $created = [];

        foreach (array_values($files) as $offset => $file) {
            $extension = strtolower($file->getClientOriginalExtension() ?: $file->extension() ?: 'bin');
            $path = "product-media/{$product->tenant_id}/{$product->id}/".Str::uuid().".{$extension}";
            $profile = $this->documentStorage->profile();
            $stream = fopen($file->getRealPath(), 'rb');
            try {
                try {
                    $this->documentStorage->put($profile, $path, $stream);
                } catch (RuntimeException $exception) {
                    throw new RuntimeException('تعذّر حفظ الصورة. تحقق من إعداد تخزين الملفات الدائم ثم أعد المحاولة.');
                }

                // خارج try/catch التخزين عمداً: فشل هوية `ProductMedia::booted()`
                // (قيمة خيارٍ/متغيّرٍ لا تخصّ هذا المنتج، أو تعارض مستأجر) يجب أن
                // يظهر برسالته الحقيقية، لا يُموَّه برسالة عطل تخزينٍ مضلِّلة.
                $created[] = ProductMedia::create(array_merge([
                    'product_id' => $product->id,
                    'disk' => 'document',
                    'path' => $path,
                    'original_name' => $file->getClientOriginalName(),
                    'mime_type' => $file->getMimeType(),
                    'size' => $file->getSize(),
                    'sort_order' => $start + $offset,
                    'uploaded_by' => $uploadedBy,
                ], $scope));
            } finally {
                if (is_resource($stream)) {
                    fclose($stream);
                }
            }
        }

        return $created;
    }

    public function delete(ProductMedia $media): void
    {
        $disk = $media->disk;
        $path = $media->path;

        if ($disk === 'document') {
            try {
                $this->documentStorage->delete($this->documentStorage->profile(), $path);
            } catch (RuntimeException $exception) {
                throw new RuntimeException('تعذّر حذف ملف الوسيط من التخزين الدائم. أعد المحاولة.');
            }
        } else {
            Storage::disk($disk)->delete($path);
        }

        $media->delete();
    }

    /**
     * ينظّف كل وسائط نطاقٍ (قيمة خيار أو متغيّر) — صفوفاً داخل معاملة
     * المستدعي، وملفاتٍ فعلية بعد الالتزام، بنفس نمط
     * `ProductLifecycleService::delete()` حرفياً. يُستعمل عند حذفٍ حقيقي
     * لمتغيّرٍ/قيمةٍ حتى لا يبقى وسيطٌ يتيم.
     *
     * @return list<array{disk: string, path: string}> ليُحذَف بعد الالتزام
     */
    public function collectAndQueueDeletion(HasMany|Builder $mediaRelation): array
    {
        $files = $mediaRelation->get(['disk', 'path'])->map(fn ($m) => ['disk' => $m->disk, 'path' => $m->path])->all();
        $mediaRelation->delete();

        return $files;
    }

    /** @param  list<array{disk: string, path: string}>  $files */
    public function deleteFiles(array $files): void
    {
        foreach ($files as $item) {
            if ($item['disk'] === 'document') {
                try {
                    $this->documentStorage->delete($this->documentStorage->profile(), $item['path']);
                } catch (RuntimeException $exception) {
                    report($exception);
                }

                continue;
            }

            Storage::disk($item['disk'])->delete($item['path']);
        }
    }
}
