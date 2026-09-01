<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\PublicInvoiceResource;
use App\Models\Invoice;
use App\Support\PublicApiResponse;
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
}
