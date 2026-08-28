<?php

namespace App\Http\Controllers\Api;

use App\Http\Middleware\EnsureApplicationOperationActive;
use App\Http\Requests\StoreReturnRequest;
use App\Http\Resources\ReturnResource;
use App\Models\Partner;
use App\Models\Product;
use App\Models\ReturnDocument;
use App\Services\Accounting\ReturnService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ReturnController extends ApiController
{
    public function __construct(protected ReturnService $returns) {}

    /**
     * قائمة المرتجعات، مع تصفية اختيارية بالنوع (`?type=sales|purchase`).
     * بلا نوع تُعاد كلها — توافق رجعي كامل.
     */
    public function index(Request $request): JsonResponse
    {
        $type = $request->query('type');

        $query = ReturnDocument::with('lines')->latest();
        if (in_array($type, ['sales', 'purchase'], true)) {
            $query->where('type', $type);
        } elseif ($request->attributes->get(EnsureApplicationOperationActive::hiddenPurchaseAttribute('return'))) {
            $query->where('type', '!=', 'purchase');
        }

        return ReturnResource::collection(
            $this->scopeToActiveBranch($query, $request)->get()
        )->response();
    }

    public function store(StoreReturnRequest $request): JsonResponse
    {
        // إصلاح خلل إسناد: كان `created_by` يبقى NULL دائماً على هذا المسار العام،
        // فيفقد كل مرتجع مؤسسته الفعلية (المستخدم مصدرٌ خادمي هنا كما في POS::checkout
        // — لا يقبل من العميل، ولا يتحقق منه StoreReturnRequest أصلاً).
        $data = $request->validated() + ['created_by' => $request->user()?->id];

        Partner::findOrFail($data['partner_id']); // عزل الطرف
        $this->assertWarehouseAllowed($data['warehouse_id'] ?? null, $this->activeBranchId());
        $this->assertTenantOwnedAll(Product::class, array_column($data['items'], 'product_id'), 'المنتج');

        $return = $this->domain(fn () => $this->returns->create($data, $data['items']));

        return (new ReturnResource($return->load('lines')))->response()->setStatusCode(201);
    }

    public function show(string $id): JsonResponse
    {
        return (new ReturnResource(ReturnDocument::with('lines')->findOrFail($id)))->response();
    }

    public function post(Request $request, string $id): JsonResponse
    {
        $return = ReturnDocument::findOrFail($id);
        $this->assertWarehouseAllowed($return->warehouse_id, $return->branch_id);
        $posted = $this->domain(fn () => $this->returns->post($return));

        return (new ReturnResource($posted->load('lines')))->response();
    }
}
