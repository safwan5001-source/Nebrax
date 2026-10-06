<?php

namespace App\Services;

use App\Models\Product;
use App\Models\ProductMedia;
use App\Models\ProductOptionValue;
use App\Models\ProductVariant;
use App\Services\DocumentCenter\DocumentStorageService;
use Aws\Exception\AwsException;
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
 *  هو سلطة التخزين الواحدة لمسارات وسائط المنتج الثلاثة (المشتركة/قيمة
 *  الخيار/المتغيّر): نفس `DocumentStorageService` وR2 ونمط الحذف بعد
 *  الالتزام. يبقى المتحكم طبقة HTTP رفيعة؛ لذلك تُكتب المشتقات بجانب الأصل
 *  ضمن العزل نفسه، ولا ينشأ مسار تخزين موازٍ أو عام.
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

    public function __construct(
        private readonly DocumentStorageService $documentStorage,
        private readonly R2StorageService $r2,
        private readonly ProductMediaDerivativeService $derivatives,
    ) {}

    /** AWJ-R2-4A: يبقى false افتراضياً — تراجعٌ فوريٌّ بمتغيّر بيئة بلا نشر كود. */
    private function r2Enabled(): bool
    {
        return (bool) config('product_media.r2.enabled', false);
    }

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
            $filename = Str::uuid().".{$extension}";
            $media = new ProductMedia(array_merge([
                'product_id' => $product->id,
                'original_name' => $file->getClientOriginalName(),
                'mime_type' => $file->getMimeType(),
                'size' => $file->getSize(),
                'sort_order' => $start + $offset,
                'uploaded_by' => $uploadedBy,
            ], $scope));
            $media->id = (string) Str::uuid();

            $storedDerivatives = [];
            try {
                [$media->disk, $media->path] = $this->storeOriginal($product, $filename, $file);
                $this->derivatives->generate($file, function (string $name, string $bytes, string $mimeType) use ($media, &$storedDerivatives): void {
                    $this->storeDerivative($media, $name, $bytes, $mimeType);
                    $storedDerivatives[] = $name;
                });
            } catch (\Throwable $exception) {
                if ($media->path !== null) {
                    $this->deleteStoredFilesBestEffort($media, $storedDerivatives, true);
                }

                throw new RuntimeException('تعذّر حفظ الصورة ومشتقاتها. تحقق من إعداد تخزين الملفات الدائم ثم أعد المحاولة.', previous: $exception);
            }

            // فشل هوية `ProductMedia::booted()` (قيمة خيارٍ/متغيّرٍ لا تخصّ
            // هذا المنتج، أو تعارض مستأجر) يجب أن يظهر برسالته الحقيقية، لا
            // يُموَّه برسالة عطل تخزينٍ مضلِّلة. لكن الأصل والمشتقات كُتبت
            // قبل المحاولة، لذا ننظفها بأفضل جهد ثم نرمي الاستثناء نفسه.
            try {
                $media->save();
            } catch (\Throwable $exception) {
                try {
                    $this->deleteStoredFilesBestEffort($media, $storedDerivatives, true);
                } catch (\Throwable $cleanupException) {
                    report($cleanupException);
                }

                throw $exception;
            }
            $created[] = $media;
        }

        return $created;
    }

    public function delete(ProductMedia $media): void
    {
        try {
            // Delete optional children first. If this fails, the original and
            // row remain intact; if original deletion later fails, the row
            // still safely falls back to the original.
            foreach ($this->derivativePaths($media) as $path) {
                $this->deleteStoredPath($media->disk, $media->product_id, $path, false);
            }
            $this->deleteStoredPath($media->disk, $media->product_id, $media->path, true);
        } catch (RuntimeException|AwsException $exception) {
            throw new RuntimeException('تعذّر حذف ملف الوسيط من التخزين الدائم. أعد المحاولة.', previous: $exception);
        }

        $media->delete();
    }

    public function derivativePath(ProductMedia $media, string $name): string
    {
        $format = ProductMediaDerivativeService::formatForMime($media->mime_type);
        ProductMediaDerivativeService::maxDimension($name);

        if ($media->disk === 'r2') {
            return "{$media->id}-{$name}.{$format['extension']}";
        }

        return dirname($media->path)."/derivatives/{$media->id}/{$name}.{$format['extension']}";
    }

    public function derivativeMimeType(ProductMedia $media): string
    {
        return ProductMediaDerivativeService::formatForMime($media->mime_type)['mime_type'];
    }

    public function derivativeDownloadName(ProductMedia $media, string $name): string
    {
        $format = ProductMediaDerivativeService::formatForMime($media->mime_type);
        $base = pathinfo($media->original_name, PATHINFO_FILENAME) ?: 'product-image';

        return "{$base}-{$name}.{$format['extension']}";
    }

    public function existingDerivativePath(ProductMedia $media, string $name): ?string
    {
        try {
            $path = $this->derivativePath($media, $name);
        } catch (RuntimeException) {
            // Rows created before derivatives (or a historical unsupported
            // image) retain their original through the documented fallback.
            return null;
        }

        if ($media->disk === 'r2') {
            return $this->r2->exists(ProductMedia::R2_DOMAIN, (string) $media->product_id, basename($path)) ? $path : null;
        }

        if ($media->disk === 'document') {
            return $this->documentStorage->exists($this->documentStorage->profile(), $path) ? $path : null;
        }

        return Storage::disk($media->disk)->exists($path) ? $path : null;
    }

    /**
     * ينظّف كل وسائط نطاقٍ (قيمة خيار أو متغيّر) — صفوفاً داخل معاملة
     * المستدعي، وملفاتٍ فعلية بعد الالتزام، بنفس نمط
     * `ProductLifecycleService::delete()` حرفياً. يُستعمل عند حذفٍ حقيقي
     * لمتغيّرٍ/قيمةٍ حتى لا يبقى وسيطٌ يتيم.
     *
     * @return list<array{id: string, disk: string, path: string, mime_type: ?string, product_id: string}> ليُحذَف بعد الالتزام
     */
    public function collectAndQueueDeletion(HasMany|Builder $mediaRelation): array
    {
        $files = $mediaRelation->get(['id', 'disk', 'path', 'mime_type', 'product_id'])
            ->map(fn ($m) => ['id' => $m->id, 'disk' => $m->disk, 'path' => $m->path, 'mime_type' => $m->mime_type, 'product_id' => $m->product_id])->all();
        $mediaRelation->delete();

        return $files;
    }

    /** @param  list<array{id: string, disk: string, path: string, mime_type: ?string, product_id: string}>  $files */
    public function deleteFiles(array $files): void
    {
        foreach ($files as $item) {
            try {
                $media = new ProductMedia($item);
                $media->id = $item['id'];
                foreach ($this->derivativePaths($media) as $path) {
                    $this->deleteStoredPath($item['disk'], $item['product_id'], $path, false);
                }
                $this->deleteStoredPath($item['disk'], $item['product_id'], $item['path'], false);
            } catch (RuntimeException|AwsException $exception) {
                report($exception);
            }
        }
    }

    /** @return array{0:string,1:string} disk, path */
    private function storeOriginal(Product $product, string $filename, UploadedFile $file): array
    {
        $disk = 'document';

        if ($this->r2Enabled()) {
            $bytes = file_get_contents($file->getRealPath());
            if ($bytes === false) {
                throw new RuntimeException('Uploaded product image is unavailable for storage.');
            }

            return ['r2', $this->r2->put(ProductMedia::R2_DOMAIN, (string) $product->id, $filename, $bytes, $file->getMimeType())];
        }

        $path = "product-media/{$product->tenant_id}/{$product->id}/{$filename}";
        $stream = fopen($file->getRealPath(), 'rb');
        if (! is_resource($stream)) {
            throw new RuntimeException('Uploaded product image is unavailable for storage.');
        }

        try {
            $this->documentStorage->put($this->documentStorage->profile(), $path, $stream);
        } finally {
            fclose($stream);
        }

        return [$disk, $path];
    }

    private function storeDerivative(ProductMedia $media, string $name, string $bytes, string $mimeType): void
    {
        $path = $this->derivativePath($media, $name);
        if ($media->disk === 'r2') {
            $this->r2->put(ProductMedia::R2_DOMAIN, (string) $media->product_id, basename($path), $bytes, $mimeType);

            return;
        }

        if ($media->disk === 'document') {
            $stream = fopen('php://temp', 'w+b');
            fwrite($stream, $bytes);
            rewind($stream);
            try {
                $this->documentStorage->put($this->documentStorage->profile(), $path, $stream);
            } finally {
                fclose($stream);
            }

            return;
        }

        Storage::disk($media->disk)->put($path, $bytes);
    }

    private function deleteStoredFilesBestEffort(ProductMedia $media, array $storedDerivatives, bool $includeOriginal): void
    {
        foreach ($storedDerivatives as $name) {
            try {
                $this->deleteStoredPath($media->disk, $media->product_id, $this->derivativePath($media, $name), false);
            } catch (RuntimeException|AwsException $exception) {
                report($exception);
            }
        }

        if ($includeOriginal) {
            try {
                $this->deleteStoredPath($media->disk, $media->product_id, $media->path, false);
            } catch (RuntimeException|AwsException $exception) {
                report($exception);
            }
        }
    }

    /** @return list<string> */
    private function derivativePaths(ProductMedia $media): array
    {
        try {
            return array_map(
                fn (string $name): string => $this->derivativePath($media, $name),
                ProductMediaDerivativeService::names(),
            );
        } catch (RuntimeException) {
            return [];
        }
    }

    private function deleteStoredPath(string $disk, string $productId, string $path, bool $required): void
    {
        if ($disk === 'r2') {
            $this->r2->delete(ProductMedia::R2_DOMAIN, $productId, basename($path));

            return;
        }

        if ($disk === 'document') {
            if ($required || $this->documentStorage->exists($this->documentStorage->profile(), $path)) {
                try {
                    $this->documentStorage->delete($this->documentStorage->profile(), $path);
                } catch (RuntimeException $exception) {
                    throw $exception;
                }
            }

            return;
        }

        if ($required || Storage::disk($disk)->exists($path)) {
            Storage::disk($disk)->delete($path);
        }
    }
}
