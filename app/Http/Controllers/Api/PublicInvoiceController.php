<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\PublicStoreInvoiceRequest;
use App\Http\Resources\PublicInvoiceResource;
use App\Models\Branch;
use App\Models\Invoice;
use App\Models\Partner;
use App\Models\Product;
use App\Models\Warehouse;
use App\Services\Accounting\InvoiceService;
use App\Support\PublicApiResponse;
use App\Tenancy\BranchContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Public API — فواتير المبيعات للقراءة فقط.
 *
 * يستعلم نموذج `Invoice` المعزول بالمستأجر مباشرةً. النطاق **على مستوى المستأجر**
 * (كل الفروع): عميل الـ API اعتماد مستأجر لا فرع، فلا تُطبَّق تصفية فرع. تُعرَض كل
 * الحالات التي يملكها المستأجر (draft/posted/cancelled) مع حقل `status`، مطابقةً
 * لدلالات القراءة الداخلية. **لا** تُكشف اعتمادات/توقيعات ZATCA ولا داخليات القيد.
 * لا كتابة ولا ترحيل ولا سداد ولا إرسال ZATCA.
 */
class PublicInvoiceController extends PublicApiController
{
    private const SORTS = [
        'invoice_date' => 'invoice_date',
        'number'       => 'number',
        'total'        => 'total',
        'created_at'   => 'created_at',
    ];

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'search'         => ['sometimes', 'nullable', 'string', 'max:120'],
            'status'         => ['sometimes', 'nullable', 'in:draft,posted,cancelled'],
            'payment_status' => ['sometimes', 'nullable', 'in:unpaid,partial,paid'],
            'partner_id'     => ['sometimes', 'nullable', 'uuid'],
            'date_from'      => ['sometimes', 'nullable', 'date'],
            'date_to'        => ['sometimes', 'nullable', 'date', 'after_or_equal:date_from'],
            'sort'           => ['sometimes', 'nullable', 'string', 'max:40'],
            'page'           => ['sometimes', 'nullable', 'integer', 'min:1'],
            'per_page'       => ['sometimes', 'nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $query = Invoice::query()->with('partner');

        if (filled($filters['search'] ?? null)) {
            $like = $this->likeTerm((string) $filters['search']);
            $query->where(fn ($q) => $q
                ->where('number', 'like', $like)
                ->orWhereHas('partner', fn ($p) => $p->where('name', 'like', $like)));
        }

        foreach (['status', 'payment_status', 'partner_id'] as $key) {
            if (filled($filters[$key] ?? null)) {
                $query->where($key, $filters[$key]);
            }
        }

        if (filled($filters['date_from'] ?? null)) {
            $query->whereDate('invoice_date', '>=', $filters['date_from']);
        }
        if (filled($filters['date_to'] ?? null)) {
            $query->whereDate('invoice_date', '<=', $filters['date_to']);
        }

        $this->applySort($query, $filters['sort'] ?? null, self::SORTS, '-invoice_date');

        return PublicApiResponse::paginated($request, $query->paginate($this->perPage($request)), PublicInvoiceResource::class);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        // معزول بالمستأجر: معرّف مستأجر آخر = «غير موجود». التفاصيل تحمّل السطور.
        $invoice = Invoice::with(['partner', 'lines'])->findOrFail($id);

        return PublicApiResponse::resource($request, (new PublicInvoiceResource($invoice))->withLines());
    }

    /**
     * إنشاء **مسودّة** فاتورة مبيعات (PR-5) — تمرّ حصرًا بمسار الإنشاء القانوني
     * `InvoiceService::create()` (لا `post()`)، فالنتيجة `draft`: بلا قيد يومية،
     * بلا تكلفة بضاعة، بلا إرسال/إبلاغ ZATCA. **الخادم يحسب الإجماليات من السطور**
     * فلا يقبل العميل إجماليًا مرجعيًا. كل مرجع (العميل/المنتج/المستودع/الفرع) يجب
     * أن يخصّ مستأجر العميل المصادَق، وإلا 422 لا يكشف وجود مرجع مستأجر آخر.
     *
     * الفرع (§14): عميل الـ API اعتماد مستأجر (`CompanyWide`) لا فرع. الفرع يُشتقّ
     * من قيمةٍ في الجسم مُتحقَّق ملكيّتها، وإلا الفرع الرئيسي للمستأجر — **لا** من
     * ترويسة `X-Branch-Id` ولا فرعٍ عشوائي.
     */
    public function store(PublicStoreInvoiceRequest $request, InvoiceService $invoices): JsonResponse
    {
        $input = $request->validated();

        // عزل المستأجر لكل مرجع (حقن معرّف مستأجر آخر ⇒ 422 «غير موجود»).
        $this->assertTenantOwned(Partner::class, $input['partner_id'], 'العميل');
        $this->assertActiveWarehouse($input['warehouse_id'] ?? null);
        $this->assertTenantOwnedAll(Product::class, array_column($input['items'], 'product_id'), 'المنتج');

        $branchId = $this->resolveBranch($input['branch_id'] ?? null);

        $data = [
            'partner_id'   => $input['partner_id'],
            'branch_id'    => $branchId,
            'warehouse_id' => $input['warehouse_id'] ?? null,
            'invoice_date' => $input['invoice_date'] ?? null,
            'due_date'     => $input['due_date'] ?? null,
            'payment_type' => $input['payment_type'] ?? null,
            'notes'        => $input['notes'] ?? null,
            'created_by'   => null, // عميل API لا مستخدم بشري
        ];

        // خريطة العقد العام (وحدات صغرى) → مدخلات الخدمة. الخادم يحسب الإجماليات.
        $items = array_map(static fn (array $line): array => [
            'product_id'  => $line['product_id'] ?? null,
            'description' => $line['description'] ?? null,
            'quantity'    => $line['quantity'],
            'unit'        => $line['unit'] ?? null,
            'unit_price'  => $line['unit_price_minor'],
            'tax_rate'    => $line['tax_rate'] ?? null,
            'discount'    => $line['discount_minor'] ?? 0,
        ], $input['items']);

        // وسم الفرع متّسق للسطور والترقيم داخل المعاملة، ثم يُستعاد السياق.
        $invoice = $this->domainWrite(function () use ($invoices, $data, $items, $branchId) {
            $context = app(BranchContext::class);
            $previous = $context->id();
            $context->set($branchId);
            try {
                return $invoices->create($data, $items);
            } finally {
                $context->set($previous);
            }
        });

        // **تمثيل إنشاء محدود الحجم** (بلا سطور): استجابة الإنشاء تُخزَّن لإعادة
        // تشغيل idempotency، وحدّها 64KB؛ فاتورةٌ بمئتَي سطرٍ بأوصافٍ طويلة قد
        // تتجاوزه فيُحرَّر المفتاح وتتكرّر الفاتورة عند إعادة المحاولة. الرأس وحده
        // مضمونُ الحجم فيبقى كلُّ إنشاءٍ قابلاً لإعادة التشغيل. للسطور: GET /invoices/{id}.
        return PublicApiResponse::resource($request, new PublicInvoiceResource($invoice))->setStatusCode(201);
    }

    /**
     * الفرع للمسودّة: قيمة الجسم المُتحقَّق ملكيّتها إن وُجدت، وإلا الفرع الرئيسي
     * للمستأجر. لا يُقرأ من ترويسة ولا يُختار فرعٌ عشوائي.
     */
    private function resolveBranch(?string $branchId): ?string
    {
        if ($branchId !== null) {
            $this->assertTenantOwned(Branch::class, $branchId, 'الفرع');

            return $branchId;
        }

        return Branch::main()?->id;
    }

    /**
     * المستودع (إن حُدِّد) يجب أن يخصّ المستأجر **ونشطًا** — كالمسار الداخلي: مسودّةٌ
     * بمستودعٍ موقوف لا تُرحَّل لاحقًا. المعرّف غير المرئي (مستأجر آخر) أو الموقوف
     * ⇒ 422 برسالةٍ واحدة لا تكشف وجود مستودع مستأجر آخر.
     */
    private function assertActiveWarehouse(?string $warehouseId): void
    {
        if ($warehouseId === null) {
            return;
        }

        if (! Warehouse::whereKey($warehouseId)->where('is_active', true)->exists()) {
            abort(422, 'المستودع غير موجود أو غير نشط.');
        }
    }
}
