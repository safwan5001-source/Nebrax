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

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'search' => ['sometimes', 'nullable', 'string', 'max:120'],
            'category_id' => ['sometimes', 'nullable', 'uuid'],
            'type' => ['sometimes', 'nullable', 'in:good,service'],
            'is_active' => ['sometimes', 'nullable', 'boolean'],
            'stock_state' => ['sometimes', 'nullable', 'in:tracked,not_tracked,out,low'],
            'sale_price_gte' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'sale_price_lte' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'sale_price_eq' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'purchase_price_gte' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'purchase_price_lte' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'purchase_price_eq' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'sort' => ['sometimes', 'nullable', 'string', 'max:40'],
            'per_page' => ['sometimes', 'nullable', 'integer', 'min:10', 'max:100'],
            'page' => ['sometimes', 'nullable', 'integer', 'min:1'],
        ]);

        // التحميل المسبق للتصنيف والعلامة وقالب الوحدات يمنع N+1، بينما
        // الفلترة/الفرز/التقسيم تبقى في SQL كي لا يُنزّل المتصفح الكتالوج كله.
        $query = Product::with(['productCategory', 'productBrand', 'unitTemplate.units']);

        if (filled($filters['search'] ?? null)) {
            $needle = addcslashes(trim((string) $filters['search']), '%_\\');
            $like = "%{$needle}%";
            $query->where(function ($search) use ($like): void {
                $search
                    ->where('name', 'like', $like)
                    ->orWhere('name_en', 'like', $like)
                    ->orWhere('sku', 'like', $like)
                    ->orWhere('barcode', 'like', $like)
                    ->orWhere('category', 'like', $like)
                    ->orWhere('brand', 'like', $like)
                    ->orWhereHas('productCategory', fn ($category) => $category->where('name', 'like', $like))
                    ->orWhereHas('productBrand', fn ($brand) => $brand->where('name', 'like', $like));
            });
        }

        if (filled($filters['category_id'] ?? null)) {
            $query->where('category_id', $filters['category_id']);
        }
        if (filled($filters['type'] ?? null)) {
            $query->where('type', $filters['type']);
        }
        if (array_key_exists('is_active', $filters) && $filters['is_active'] !== null && $filters['is_active'] !== '') {
            $query->where('is_active', $request->boolean('is_active'));
        }

        if (filled($filters['stock_state'] ?? null)) {
            match ($filters['stock_state']) {
                'tracked' => $query->where('track_inventory', true),
                'not_tracked' => $query->where('track_inventory', false),
                'out' => $query->where('track_inventory', true)->where('quantity_on_hand', '<=', 0),
                'low' => $query
                    ->where('track_inventory', true)
                    ->where('quantity_on_hand', '>', 0)
                    ->where('reorder_level', '>', 0)
                    ->whereColumn('quantity_on_hand', '<=', 'reorder_level'),
                default => null,
            };
        }

        foreach (['sale_price', 'purchase_price'] as $column) {
            foreach (['gte' => '>=', 'lte' => '<=', 'eq' => '='] as $suffix => $operator) {
                $key = "{$column}_{$suffix}";
                if (filled($filters[$key] ?? null)) {
                    $query->where($column, $operator, $this->moneyFilterToMinor((string) $filters[$key]));
                }
            }
        }

        $paginated = isset($filters['per_page']);
        $sort = (string) ($filters['sort'] ?? '');
        $direction = str_starts_with($sort, '-') ? 'desc' : 'asc';
        $sortKey = ltrim($sort, '-');
        $allowedSorts = [
            'name' => 'name',
            'sku' => 'sku',
            'sale_price' => 'sale_price',
            'purchase_price' => 'purchase_price',
            'quantity_on_hand' => 'quantity_on_hand',
            'created_at' => 'created_at',
        ];

        if ($sort !== '' && isset($allowedSorts[$sortKey])) {
            $query->orderBy($allowedSorts[$sortKey], $direction)->orderByDesc('id');
        } elseif ($paginated) {
            // صفحة المنتجات تاريخياً تبدأ بالاسم؛ نبقي ذلك هو افتراض Data Explorer.
            $query->orderBy('name')->orderByDesc('id');
        } else {
            // توافق خلفي مع كل مستهلك قديم لـ GET /products بلا pagination.
            $query->latest();
        }

        if ($paginated) {
            return ProductResource::collection(
                $query->paginate((int) $filters['per_page'])->withQueryString()
            )->response();
        }

        return ProductResource::collection($query->get())->response();
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

    private function moneyFilterToMinor(string $value): int
    {
        $normalized = trim($value);
        [$whole, $fraction] = array_pad(explode('.', $normalized, 2), 2, '');
        $fraction = substr(str_pad(preg_replace('/\D/', '', $fraction) ?? '', 2, '0'), 0, 2);

        return ((int) $whole * 100) + (int) $fraction;
    }
}
