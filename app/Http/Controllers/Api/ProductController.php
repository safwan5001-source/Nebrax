<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\ImportProductsRequest;
use App\Http\Requests\StoreProductBarcodeRequest;
use App\Http\Requests\StoreProductMediaRequest;
use App\Http\Requests\StoreProductRequest;
use App\Http\Requests\UpdateProductRequest;
use App\Http\Resources\ProductActivityResource;
use App\Http\Resources\ProductBarcodeResource;
use App\Http\Resources\ProductMediaResource;
use App\Http\Resources\ProductResource;
use App\Models\Product;
use App\Models\ProductBarcode;
use App\Models\ProductMedia;
use App\Models\Account;
use App\Models\Brand;
use App\Models\Partner;
use App\Models\ProductCategory;
use App\Models\UnitTemplate;
use App\Services\Accounting\InventoryService;
use App\Services\DocumentCenter\DocumentStorageService;
use App\Services\ProductImportService;
use App\Services\ProductLifecycleService;
use App\Support\PosSettings;
use App\Support\Settings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use RuntimeException;

class ProductController extends ApiController
{
    public function __construct(
        protected InventoryService $inventory,
        protected DocumentStorageService $documentStorage,
        protected ProductImportService $imports,
        protected ProductLifecycleService $lifecycle,
    ) {}

    /**
     * تحقق مراجع المنتج: المورّد طرف ضمن المستأجر، وحسابا المبيعات/التكلفة
     * حسابان ورقيان (غير تجميعيين) من النوع الصحيح — يمنع ترحيل الإيراد لحساب نقدية مثلاً.
     */
    private function assertProductRefs(array $data): ?UnitTemplate
    {
        $this->assertTenantOwned(Partner::class, $data['supplier_id'] ?? null, 'المورّد');
        $this->assertTenantOwned(ProductCategory::class, $data['category_id'] ?? null, 'التصنيف');
        $this->assertTenantOwned(Brand::class, $data['brand_id'] ?? null, 'العلامة التجارية');
        $this->assertTenantOwned(UnitTemplate::class, $data['unit_template_id'] ?? null, 'قالب الوحدات');

        $template = ! empty($data['unit_template_id'])
            ? UnitTemplate::find($data['unit_template_id'])
            : null;

        foreach ([['sales_account_id', 'revenue', 'حساب المبيعات'], ['cogs_account_id', 'expense', 'حساب التكلفة']] as [$key, $type, $label]) {
            if (! empty($data[$key])) {
                $ok = Account::whereKey($data[$key])->where('type', $type)->where('is_group', false)->exists();
                if (! $ok) {
                    abort(422, "{$label} يجب أن يكون حساباً ورقياً من النوع الصحيح.");
                }
            }
        }

        return $template;
    }

    /** قالب CSV ثابت لفتح الاستيراد في Excel أو أي محرر جداول. */
    public function importTemplate()
    {
        return response()->streamDownload(function (): void {
            echo $this->imports->template();
        }, 'nebrax-products-import-template.csv', [
            'Content-Type' => 'text/csv; charset=UTF-8',
        ]);
    }

    /** معاينة غير مغيرة للبيانات؛ لا تكتب شيئاً في الكتالوج. */
    public function importPreview(ImportProductsRequest $request): JsonResponse
    {
        return response()->json([
            'data' => $this->imports->preview($request->file('file'), $request->string('mode')->toString()),
        ]);
    }

    /** يكرر التحقق ثم ينشئ أو يحدّث الكتالوج في معاملة واحدة. */
    public function importApply(ImportProductsRequest $request): JsonResponse
    {
        return response()->json([
            'data' => $this->imports->apply($request->file('file'), $request->string('mode')->toString()),
        ]);
    }

    public function index(): JsonResponse
    {
        // التحميل المسبق للتصنيف والعلامة: المورد يقرأ اسميهما لكل صفّ، وبلا
        // هذا السطر يصير استعلامان لكل منتج (N+1) في أكثر قائمة تُفتح.
        return ProductResource::collection(
            Product::with(['productCategory', 'productBrand', 'unitTemplate.units'])->latest()->get()
        )->response();
    }

    public function store(StoreProductRequest $request): JsonResponse
    {
        $data = $request->validated();
        $template = $this->assertProductRefs($data);
        if ($template !== null) {
            $data['unit'] = $template->base_unit;
        }

        // ذرّية: إنشاء المنتج وقيد الرصيد الافتتاحي معاملة واحدة —
        // فشل القيد يُرجع المنتج كله (لا منتج يتيم بلا قيده).
        $userId = $request->user()?->id;
        $product = $this->domain(fn () => DB::transaction(function () use ($data, $userId) {
            // SKU هو كود الصنف الداخلي: إن لم يُحدده المستخدم يولّد الخادم الرقم
            // التالي تحت القفل نفسه، فلا تتصادم عمليات الإنشاء المتزامنة.
            if (blank($data['sku'] ?? null)) {
                $prefix = (string) Settings::get('numbering', 'product_prefix');
                $data['sku'] = Product::nextDocumentNumber($prefix !== '' ? $prefix : 'SKU');
            }

            $product = Product::create($data); // initial_quantity ليست عموداً — يحرسها fillable

            // رصيد افتتاحي (قيد مدين 1140 / دائن 3130) عند تحديد كمية ابتدائية لمنتج متتبَّع.
            $this->inventory->recordOpeningStock($product, (int) ($data['initial_quantity'] ?? 0));
            $this->lifecycle->create($product, $userId);

            return $product;
        }));

        return (new ProductResource($product->fresh()))->response()->setStatusCode(201);
    }

    public function show(string $id): JsonResponse
    {
        return (new ProductResource(Product::findOrFail($id)))->response();
    }

    public function update(UpdateProductRequest $request, string $id): JsonResponse
    {
        $product = Product::findOrFail($id);
        $data = $request->validated();
        $template = $this->assertProductRefs($data);
        if ($template !== null) {
            $data['unit'] = $template->base_unit;
        }
        $product = $this->domain(fn () => $this->lifecycle->update($product, $data, $request->user()?->id));

        return (new ProductResource($product))->response();
    }

    /** باركودات بديلة بالوحدة التي يبيعها أو يشتريها الجهاز عند المسح. */
    public function indexBarcodes(string $id): JsonResponse
    {
        $product = Product::findOrFail($id);

        return ProductBarcodeResource::collection($product->alternateBarcodes()->latest()->get())->response();
    }

    public function storeBarcode(StoreProductBarcodeRequest $request, string $id): JsonResponse
    {
        $product = Product::with('unitTemplate.units')->findOrFail($id);
        $data = $request->validated();
        $code = trim($data['code']);

        if ($code === '') {
            abort(422, 'الباركود لا يمكن أن يكون فارغاً.');
        }

        // الباركود الأساسي التاريخي والباركودات البديلة يعيشان في موضعين؛
        // نتحقق من كليهما كي يبقى كود المسح فريداً داخل المؤسسة.
        $primaryTaken = Product::withTrashed()->where('barcode', $code)->exists();
        $alternateTaken = ProductBarcode::where('code', $code)->exists();
        if ($primaryTaken || $alternateTaken) {
            abort(422, 'الباركود مستخدم بالفعل في منتج آخر أو كوحدة أخرى.');
        }

        $unitName = trim((string) ($data['unit_name'] ?? $product->unit));
        $units = $product->unitTemplate
            ? collect([$product->unitTemplate->base_unit])
                ->concat($product->unitTemplate->units->pluck('name'))
                ->all()
            : [$product->unit];
        if ($unitName === '' || ! in_array($unitName, $units, true)) {
            abort(422, 'وحدة الباركود يجب أن تكون وحدة الأساس أو وحدة بديلة معرّفة في قالب المنتج.');
        }

        $barcode = $product->alternateBarcodes()->create([
            'code' => $code,
            'unit_name' => $unitName,
            'default_quantity' => (int) ($data['default_quantity'] ?? 1),
            'label' => isset($data['label']) ? trim((string) $data['label']) ?: null : null,
            'created_by' => $request->user()?->id,
        ]);

        return (new ProductBarcodeResource($barcode))->response()->setStatusCode(201);
    }

    public function destroyBarcode(string $id, string $barcodeId): JsonResponse
    {
        $product = Product::findOrFail($id);
        $product->alternateBarcodes()->whereKey($barcodeId)->firstOrFail()->delete();

        return response()->json(['message' => 'تم حذف الباركود البديل.']);
    }

    public function indexMedia(string $id): JsonResponse
    {
        $product = Product::findOrFail($id);

        return ProductMediaResource::collection($product->media()->orderBy('sort_order')->latest()->get())->response();
    }

    public function storeMedia(StoreProductMediaRequest $request, string $id): JsonResponse
    {
        $product = Product::findOrFail($id);
        $files = $request->file('media', []);
        if ($product->media()->count() + count($files) > 8) {
            abort(422, 'الحد الأقصى لوسائط المنتج هو 8 صور. احذف صورة قبل الرفع.');
        }
        $start = (int) ($product->media()->max('sort_order') ?? -1) + 1;

        foreach ($files as $offset => $file) {
            $extension = strtolower($file->getClientOriginalExtension() ?: $file->extension() ?: 'bin');
            $path = "product-media/{$product->tenant_id}/{$product->id}/" . Str::uuid() . ".{$extension}";
            $profile = $this->documentStorage->profile();
            $stream = fopen($file->getRealPath(), 'rb');
            try {
                $this->documentStorage->put($profile, $path, $stream);
                $product->media()->create([
                    // "document" يعني تخزيناً دائماً خاصاً عبر S3/R2، لا قرص حاوية Render المؤقت.
                    'disk' => 'document',
                    'path' => $path,
                    'original_name' => $file->getClientOriginalName(),
                    'mime_type' => $file->getMimeType(),
                    'size' => $file->getSize(),
                    'sort_order' => $start + $offset,
                    'uploaded_by' => $request->user()?->id,
                ]);
            } catch (RuntimeException $exception) {
                // لا نسجل مرفقاً يشير إلى كائن لم يكتب؛ تبقى الرسالة قابلة للتشخيص دون كشف السر.
                abort(503, 'تعذّر حفظ صورة المنتج. تحقق من إعداد تخزين الملفات الدائم ثم أعد المحاولة.');
            } finally {
                if (is_resource($stream)) {
                    fclose($stream);
                }
            }
        }

        return ProductMediaResource::collection($product->media()->orderBy('sort_order')->get())
            ->response()->setStatusCode(201);
    }

    public function downloadMedia(string $id, string $mediaId)
    {
        $product = Product::findOrFail($id);
        $media = $product->media()->whereKey($mediaId)->firstOrFail();

        return $this->streamMedia($media);
    }

    /**
     * صورة بطاقة POS لا تُحمّل من مسار إدارة المنتجات: الكاشير يملك تنفيذ البيع
     * لا تصفح المخزون كله. نعيد التحقق من عقد الكتالوج (نشط + تصنيف مسموح)
     * قبل بث صورة خاصة، فلا يتحول الرابط إلى منفذ لتجاوز سياسة الكتالوج.
     */
    public function downloadPosMedia(string $id, string $mediaId)
    {
        $product = PosSettings::constrainProductsByCategory(
            Product::query()->where('is_active', true)
        )->findOrFail($id);
        $media = $product->media()
            ->whereKey($mediaId)
            ->where('mime_type', 'like', 'image/%')
            ->firstOrFail();

        return $this->streamMedia($media);
    }

    private function streamMedia(ProductMedia $media)
    {
        if ($media->disk === 'document') {
            try {
                $stream = $this->documentStorage->readStream($this->documentStorage->profile(), $media->path);
            } catch (RuntimeException $exception) {
                abort(404, 'ملف الوسيط غير موجود.');
            }

            return response()->streamDownload(function () use ($stream): void {
                fpassthru($stream);
                fclose($stream);
            }, $media->original_name, [
                'Content-Type' => $media->mime_type ?? 'application/octet-stream',
            ]);
        }

        // توافق قراءة فقط مع السجلات القديمة التي كتبت إلى القرص المحلي قبل هذا الإصلاح.
        $disk = Storage::disk($media->disk);
        if (! $disk->exists($media->path)) {
            abort(404, 'ملف الوسيط غير موجود.');
        }

        return $disk->download($media->path, $media->original_name, [
            'Content-Type' => $media->mime_type ?? 'application/octet-stream',
        ]);
    }

    public function destroyMedia(string $id, string $mediaId): JsonResponse
    {
        $product = Product::findOrFail($id);
        $media = $product->media()->whereKey($mediaId)->firstOrFail();
        $disk = $media->disk;
        $path = $media->path;
        if ($disk === 'document') {
            try {
                $this->documentStorage->delete($this->documentStorage->profile(), $path);
            } catch (RuntimeException $exception) {
                abort(503, 'تعذّر حذف ملف الوسيط من التخزين الدائم. أعد المحاولة.');
            }
        } else {
            Storage::disk($disk)->delete($path);
        }
        $media->delete();

        return response()->json(['message' => 'تم حذف الوسيط.']);
    }

    public function activity(string $id): JsonResponse
    {
        $product = Product::findOrFail($id);

        return ProductActivityResource::collection($this->lifecycle->activity($product))->response();
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $product = Product::findOrFail($id);
        $this->domain(fn () => $this->lifecycle->delete($product, $request->user()?->id));

        return response()->json(['message' => 'تم الحذف.']);
    }
}
