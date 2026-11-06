<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\ApproveFuelDeliveryRequest;
use App\Http\Requests\RecordFuelDeliveryCostRequest;
use App\Http\Requests\StoreFuelDeliveryAttachmentsRequest;
use App\Http\Requests\StoreFuelDeliveryRequest;
use App\Http\Requests\StoreFuelSupplierInvoiceMatchRequest;
use App\Http\Requests\StoreFuelSupplierInvoiceRequest;
use App\Http\Resources\FuelDeliveryResource;
use App\Http\Resources\FuelSupplierInvoiceMatchResource;
use App\Http\Resources\FuelSupplierInvoiceResource;
use App\Models\FuelDelivery;
use App\Models\FuelDeliveryAttachment;
use App\Models\FuelSupplierInvoice;
use App\Models\Partner;
use App\Services\AttachmentStorage;
use App\Services\FuelDeliveryAttachmentService;
use App\Services\FuelDeliveryCostChangedException;
use App\Services\FuelDeliveryDocumentBuilder;
use App\Services\FuelSupplyReceivingService;
use App\Support\FuelCostVisibility;
use App\Support\FuelDeliveryCostAuthority;
use App\Support\SpreadsheetWriter;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

class FuelSupplyReceivingController extends ApiController
{
    use AuthorizesFuelStationScope;

    public function __construct(
        private FuelSupplyReceivingService $service,
        private FuelDeliveryAttachmentService $attachments,
        private FuelDeliveryDocumentBuilder $documents,
        private AttachmentStorage $storage,
    ) {}

    /** نطاق الاستلامات المتاح للمستخدم (فرع/مخزن/محطة) — مصدر وحيد للقائمة والتفاصيل والمرفقات والتصدير. */
    private function scopedDeliveries(Request $request): Builder
    {
        return $this->restrictToAccessibleStations($this->scopeToAccessibleWarehouses($this->scopeToActiveBranch(FuelDelivery::query(), $request), ['warehouse_id']));
    }

    /**
     * FUEL-B5.1: بحث وتصفية الاستلامات (للقائمة والكشف والتصدير معاً): المحطة، الحالة، المورد، الفترة بتاريخ الاستلام، ونص حر على
     * رقم سند التسليم ومرجع الشراء واسم المورد. المحارف الخاصة في النص لا تتجاوز نطاق المستخدم أصلاً (النطاق يُطبَّق قبلها).
     *
     * @return array<string, mixed> وصف المرشحات المطبَّقة (للترويسة فقط)
     */
    private function applyFilters(Builder $query, Request $request): array
    {
        $f = $request->validate([
            'station_id' => ['nullable', 'uuid'], 'status' => ['nullable', 'in:draft,approved'], 'supplier_id' => ['nullable', 'uuid'],
            'from' => ['nullable', 'date'], 'to' => ['nullable', 'date', 'after_or_equal:from'], 'q' => ['nullable', 'string', 'max:100'],
            'cost' => ['nullable', 'in:missing,recorded'],
        ]);
        $applied = [];
        if (! empty($f['station_id'])) {
            $query->where('fuel_station_id', $f['station_id']);
            $applied['station_id'] = $f['station_id'];
        }
        if (! empty($f['status'])) {
            $query->where('status', $f['status']);
            $applied['status'] = $f['status'];
        }
        if (! empty($f['supplier_id'])) {
            $query->where('supplier_id', $f['supplier_id']);
            $applied['supplier_id'] = $f['supplier_id'];
        }
        if (! empty($f['from'])) {
            $query->where('received_at', '>=', \Carbon\Carbon::parse($f['from'])->startOfDay());
            $applied['from'] = $f['from'];
        }
        if (! empty($f['to'])) {
            $query->where('received_at', '<=', \Carbon\Carbon::parse($f['to'])->endOfDay());
            $applied['to'] = $f['to'];
        }
        if (! empty($f['cost'])) {
            // حالة التكلفة (مسجَّلة/ناقصة) ليست مبلغاً: لا تكشف قيمة، ومفيدة لموظف المحطة لمعرفة ما ينتظر المالية.
            $f['cost'] === 'missing' ? $query->whereNull('received_total_cost_minor') : $query->whereNotNull('received_total_cost_minor');
            $applied['cost'] = $f['cost'];
        }
        if (! empty($f['q'])) {
            $needle = '%'.mb_strtolower(trim($f['q'])).'%';
            $query->where(fn (Builder $q) => $q
                ->whereRaw('LOWER(delivery_note_number) LIKE ?', [$needle])
                ->orWhereRaw('LOWER(purchase_reference) LIKE ?', [$needle])
                ->orWhereHas('supplier', fn (Builder $s) => $s->whereRaw('LOWER(name) LIKE ?', [$needle])));
            $applied['q'] = trim($f['q']);
        }

        return $applied;
    }

    public function deliveries(Request $request)
    {
        $query = $this->scopedDeliveries($request)->with(['station', 'tank', 'fuelProduct', 'warehouse', 'supplier'])->withCount('attachments');
        $this->applyFilters($query, $request);
        $perPage = max(1, min(100, (int) $request->query('per_page', 50)));

        return FuelDeliveryResource::collection($query->latest('received_at')->latest('id')->paginate($perPage));
    }

    public function showDelivery(Request $request, string $id)
    {
        $delivery = $this->scopedDeliveries($request)->with(['station', 'tank', 'fuelProduct', 'warehouse', 'supplier', 'beforePhysicalReading', 'afterPhysicalReading', 'beforeAtgReading', 'afterAtgReading', 'attachments'])->withCount('attachments')->findOrFail($id);
        return new FuelDeliveryResource($delivery);
    }

    public function storeDelivery(StoreFuelDeliveryRequest $request)
    {
        $this->accessibleStation($request->validated()['fuel_station_id']);
        // FUEL-B5.1: التكلفة المُرسَلة عند الإنشاء كتابةُ تكلفة — تحتاج السلطة المالية نفسها؛ موظف المحطة ينشئ بلا تكلفة (NULL).
        if (($request->validated()['received_total_cost_minor'] ?? null) !== null && ! FuelDeliveryCostAuthority::canRecord($request->user())) {
            abort(403, 'تسجيل تكلفة الاستلام يتطلب صلاحية مالية؛ أنشئ الاستلام بلا تكلفة.');
        }

        return $this->domain(fn () => new FuelDeliveryResource($this->service->createDelivery(
            $request->validated() + ['created_by' => $request->user()->id],
        )));
    }

    public function approveDelivery(ApproveFuelDeliveryRequest $request, string $id)
    {
        $delivery = $this->scopedDeliveries($request)->findOrFail($id);
        $this->accessibleStation($delivery->fuel_station_id);
        $expected = $request->validated()['expected_total_cost_minor'] ?? null;
        if ($expected !== null && ! FuelCostVisibility::canSeeCost($request->user())) {
            abort(403, 'لا تملك صلاحية رؤية تكلفة الاستلام.'); // وإلا صارت المطابقة قناة استدلال على التكلفة.
        }

        return $this->domain(function () use ($delivery, $request, $expected) {
            try {
                return new FuelDeliveryResource($this->service->approveDelivery($delivery, $request->user()->id, $expected));
            } catch (FuelDeliveryCostChangedException $e) {
                // استجابة لا استثناء: HttpException يرث RuntimeException فكان domain() يحوّله إلى 422.
                return response()->json(['message' => $e->getMessage(), 'reason' => 'cost_changed'], 409);
            }
        });
    }

    /** FUEL-B5.1: تسجيل/تصحيح التكلفة قبل الاعتماد. المسار يشترط `products.view_cost` + الصلاحية المالية (middleware) وهنا إعادة تحقق دفاعية. */
    public function recordCost(RecordFuelDeliveryCostRequest $request, string $id)
    {
        if (! FuelDeliveryCostAuthority::canRecord($request->user())) {
            abort(403, 'تسجيل تكلفة الاستلام يتطلب صلاحية مالية.');
        }
        $delivery = $this->scopedDeliveries($request)->findOrFail($id);
        $this->accessibleStation($delivery->fuel_station_id);

        return $this->domain(fn () => new FuelDeliveryResource($this->service->recordCost($delivery, (int) $request->validated()['received_total_cost_minor'], $request->user())));
    }

    // ───────────── FUEL-B5.1: مرفقات سند المورد ─────────────

    public function indexAttachments(Request $request, string $id)
    {
        $delivery = $this->scopedDeliveries($request)->findOrFail($id);
        $this->accessibleStation($delivery->fuel_station_id);

        return response()->json(['data' => $delivery->attachments()->get()->map(fn (FuelDeliveryAttachment $a) => $this->attachmentView($a))->values()->all()]);
    }

    public function storeAttachments(StoreFuelDeliveryAttachmentsRequest $request, string $id)
    {
        $delivery = $this->scopedDeliveries($request)->findOrFail($id);
        $this->accessibleStation($delivery->fuel_station_id);
        $rows = $this->attachments->add($delivery, $request->file('attachments', []), $request->user());

        return response()->json(['data' => array_map(fn (FuelDeliveryAttachment $a) => $this->attachmentView($a), $rows)], 201);
    }

    public function downloadAttachment(Request $request, string $id, string $attachmentId): StreamedResponse
    {
        $delivery = $this->scopedDeliveries($request)->findOrFail($id);
        $this->accessibleStation($delivery->fuel_station_id);
        $attachment = $delivery->attachments()->whereKey($attachmentId)->firstOrFail();

        return $this->storage->download($attachment->disk, $attachment->path, $attachment->original_name, $attachment->mime_type);
    }

    public function destroyAttachment(Request $request, string $id, string $attachmentId)
    {
        $delivery = $this->scopedDeliveries($request)->findOrFail($id);
        $this->accessibleStation($delivery->fuel_station_id);
        $attachment = $delivery->attachments()->whereKey($attachmentId)->firstOrFail();
        $this->domain(fn () => $this->attachments->delete($delivery, $attachment));

        return response()->noContent();
    }

    /** @return array<string, mixed> */
    private function attachmentView(FuelDeliveryAttachment $a): array
    {
        return [
            'id' => $a->id, 'name' => $a->original_name, 'mime_type' => $a->mime_type, 'size' => (int) $a->size,
            'uploaded_by' => $a->uploaded_by, 'created_at' => $a->created_at?->toISOString(),
        ];
    }

    // ───────────── FUEL-B5.1: سند الاستلام والكشف (PDF يُرسم في المتصفح من هذه الحمولة + Excel من الخادم) ─────────────

    /** النسخة المطلوبة. المالية تُرفض 403 لغير المخوّل في الخادم؛ الافتراضية تشغيلية بلا أي مبلغ. */
    private function requestedFinancial(Request $request): bool
    {
        $variant = $request->query('variant', 'operational');
        if (! in_array($variant, ['operational', 'financial'], true)) {
            abort(422, 'نسخة غير معروفة.');
        }
        if ($variant === 'financial' && ! FuelCostVisibility::canSeeCost($request->user())) {
            abort(403, 'النسخة المالية تتطلب صلاحية عرض التكلفة.');
        }

        return $variant === 'financial';
    }

    public function document(Request $request, string $id)
    {
        $financial = $this->requestedFinancial($request);
        $delivery = $this->scopedDeliveries($request)->findOrFail($id);
        $this->accessibleStation($delivery->fuel_station_id);

        return response()->json(['data' => $this->documents->document($delivery, $financial, $request->user())]);
    }

    public function report(Request $request)
    {
        [$payload] = $this->reportPayload($request);

        return response()->json(['data' => $payload]);
    }

    public function exportReport(Request $request)
    {
        [$payload, $financial] = $this->reportPayload($request);
        $headers = ['المرجع', 'تاريخ الاستلام', 'الحالة', 'رقم سند المورد', 'المحطة', 'المورد', 'المنتج', 'الخزان', 'الكمية المرسلة (لتر)', 'الكمية المستلمة (لتر)', 'فرق النقل (لتر)'];
        $types = [SpreadsheetWriter::TYPE_TEXT, SpreadsheetWriter::TYPE_TEXT, SpreadsheetWriter::TYPE_TEXT, SpreadsheetWriter::TYPE_TEXT, SpreadsheetWriter::TYPE_TEXT, SpreadsheetWriter::TYPE_TEXT, SpreadsheetWriter::TYPE_TEXT, SpreadsheetWriter::TYPE_TEXT, SpreadsheetWriter::TYPE_NUMBER, SpreadsheetWriter::TYPE_NUMBER, SpreadsheetWriter::TYPE_NUMBER];
        if ($financial) {
            $headers[] = 'التكلفة الإجمالية';
            $types[] = SpreadsheetWriter::TYPE_NUMBER;
        }
        $rows = array_map(function (array $r) use ($financial) {
            $row = [$r['reference'], $r['received_at'], $r['status'], $r['delivery_note_number'], $r['station'], $r['supplier'], $r['product'], $r['tank'], $r['dispatched_liters'], $r['received_liters'], $r['transit_variance_liters']];
            if ($financial) {
                $row[] = $r['total_cost_minor'] === null ? null : $this->minorToMajor($r['total_cost_minor']);
            }

            return $row;
        }, $payload['rows']);
        $totals = $payload['totals'];
        $rows[] = ['', '', '', '', '', '', '', 'الإجمالي ('.$totals['count'].')', $totals['dispatched_liters'], $totals['received_liters'], $totals['transit_variance_liters'], ...($financial ? [$this->minorToMajor($totals['total_cost_minor'])] : [])];

        return $this->xlsx($headers, $rows, $types, 'FuelReceipts', 'fuel-receipts-'.($financial ? 'financial' : 'operational').'-'.now()->format('Ymd-His'));
    }

    public function exportDelivery(Request $request, string $id)
    {
        $financial = $this->requestedFinancial($request);
        $delivery = $this->scopedDeliveries($request)->findOrFail($id);
        $this->accessibleStation($delivery->fuel_station_id);
        $doc = $this->documents->document($delivery, $financial, $request->user());

        $pairs = [
            ['المرجع', $doc['reference']], ['الحالة', $doc['status']], ['رقم سند المورد', $doc['delivery_note_number']], ['مرجع الشراء', $doc['purchase_reference']],
            ['الشركة', $doc['company']['name']], ['المحطة', $doc['station']['name'] ?? null], ['المورد', $doc['supplier']['name'] ?? null],
            ['المنتج', $doc['product']['name'] ?? null], ['الخزان', $doc['tank']['code'] ?? null], ['المستودع', $doc['warehouse']['name'] ?? null],
            ['الصهريج', $doc['tanker_identifier']], ['السائق', $doc['driver_name']],
            ['الكمية المرسلة (لتر)', $doc['quantities']['dispatched_liters']], ['الكمية المستلمة (لتر)', $doc['quantities']['received_liters']],
            ['فرق النقل (لتر)', $doc['quantities']['transit_variance_liters']], ['فرق النقل %', $doc['quantities']['transit_variance_percent']],
            ['قراءة قبل (فيزيائية)', $doc['readings']['before_physical']['liters'] ?? null], ['قراءة بعد (فيزيائية)', $doc['readings']['after_physical']['liters'] ?? null],
            ['قراءة قبل (ATG)', $doc['readings']['before_atg']['liters'] ?? null], ['قراءة بعد (ATG)', $doc['readings']['after_atg']['liters'] ?? null],
            ['تاريخ الاستلام', $doc['received_at']], ['المستلِم', $doc['received_by']], ['المعتمِد', $doc['approved_by']], ['تاريخ الاعتماد', $doc['approved_at']], ['ملاحظات', $doc['notes']],
        ];
        if ($financial) {
            $pairs[] = ['التكلفة الإجمالية', $doc['cost']['total_minor'] === null ? null : $this->minorToMajor($doc['cost']['total_minor'])];
            $pairs[] = ['متوسط تكلفة اللتر', $doc['cost']['per_liter']];
            $pairs[] = ['سجّل التكلفة', $doc['cost']['recorded_by']];
        }

        return $this->xlsx(['البند', 'القيمة'], $pairs, [SpreadsheetWriter::TYPE_TEXT, SpreadsheetWriter::TYPE_TEXT], 'FuelReceipt', 'fuel-receipt-'.$doc['reference'].'-'.($financial ? 'financial' : 'operational'));
    }

    /** @return array{0: array<string, mixed>, 1: bool} */
    private function reportPayload(Request $request): array
    {
        $financial = $this->requestedFinancial($request);
        $query = $this->scopedDeliveries($request);
        $applied = $this->applyFilters($query, $request);
        $limit = FuelDeliveryDocumentBuilder::REPORT_ROW_LIMIT;
        $rows = $query->with(['station', 'tank', 'fuelProduct.product', 'supplier'])->latest('received_at')->latest('id')->limit($limit + 1)->get();
        $truncated = $rows->count() > $limit;

        return [$this->documents->report($rows->take($limit), $financial, $request->user(), $applied, $truncated), $financial];
    }

    private function minorToMajor(int $minor): string
    {
        return intdiv($minor, 100).'.'.str_pad((string) ($minor % 100), 2, '0', STR_PAD_LEFT);
    }

    /**
     * @param  array<int, string>  $headers
     * @param  array<int, array<int, string|int|null>>  $rows
     * @param  array<int, string>  $types
     */
    private function xlsx(array $headers, array $rows, array $types, string $sheet, string $filename)
    {
        $path = tempnam(sys_get_temp_dir(), 'awj-fuel-receipt-');
        if ($path === false) {
            abort(500, 'تعذر تجهيز ملف التصدير المؤقت.');
        }
        try {
            SpreadsheetWriter::xlsx($path, $headers, $rows, $types, $sheet);
            $contents = file_get_contents($path);
            if ($contents === false) {
                abort(500, 'تعذر قراءة ملف التصدير.');
            }

            return response($contents, 200, [
                'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition' => 'attachment; filename="'.preg_replace('/[^A-Za-z0-9._-]/', '_', $filename).'.xlsx"',
                'Content-Length' => (string) strlen($contents),
                'X-Content-Type-Options' => 'nosniff',
                'Cache-Control' => 'no-store, private',
            ]);
        } finally {
            @unlink($path);
        }
    }

    /**
     * FUEL-B5: موردو الوقود المتاحون لاختيار المورد عند إنشاء استلام — قراءة فقط ومحدودة الحقول (معرّف/اسم/رمز، بلا رصيد أو ضريبة أو تواصل).
     * `GET /partners` يتطلب `partners.view` وهي ليست من صلاحيات موظف المحطة. الصلاحية = نفس صلاحية إنشاء الاستلام (القديم أو الدقيق).
     * `Partner` يخضع لعزل المستأجر والفرع النشط كما في إنشاء الاستلام نفسه (الذي يحلّ المورد بالطريقة نفسها).
     */
    public function suppliers(Request $request)
    {
        $filters = $request->validate(['q' => ['nullable', 'string', 'max:100']]);
        $query = Partner::query()->whereIn('type', ['supplier', 'both'])->where('is_active', true)->orderBy('name')->limit(100);
        if (! empty($filters['q'])) {
            $needle = '%' . mb_strtolower($filters['q']) . '%'; // بحث المستخدم نفسه: المحارف الخاصة لا تتجاوز نطاق المورّدين المصرَّح به أصلاً
            $query->where(fn ($q) => $q->whereRaw('LOWER(name) LIKE ?', [$needle])->orWhereRaw('LOWER(code) LIKE ?', [$needle]));
        }

        return response()->json(['data' => $query->get(['id', 'name', 'code'])->map(fn (Partner $p) => ['id' => $p->id, 'name' => $p->name, 'code' => $p->code])->values()->all()]);
    }

    public function invoices(Request $request)
    {
        $query = $this->restrictInvoicesToAccessibleStations(FuelSupplierInvoice::query())->with('lines')->latest('invoice_date');
        if ($request->filled('supplier_id')) {
            $query->where('supplier_id', $request->query('supplier_id'));
        }
        if ($request->filled('status')) {
            $query->where('status', $request->query('status'));
        }

        return FuelSupplierInvoiceResource::collection($query->paginate(50));
    }

    public function showInvoice(string $id)
    {
        return new FuelSupplierInvoiceResource($this->restrictInvoicesToAccessibleStations(FuelSupplierInvoice::query())->with(['lines', 'matches'])->findOrFail($id));
    }

    public function storeInvoice(StoreFuelSupplierInvoiceRequest $request)
    {
        return $this->domain(fn () => new FuelSupplierInvoiceResource($this->service->createSupplierInvoice(
            $request->validated() + ['created_by' => $request->user()->id],
        )));
    }

    public function matchInvoice(StoreFuelSupplierInvoiceMatchRequest $request, string $id)
    {
        // B1: الفاتورة نفسها ضمن نطاق المستخدم (404 موحّد) قبل أي أثر.
        $invoice = $this->restrictInvoicesToAccessibleStations(FuelSupplierInvoice::query())->findOrFail($id);
        // الاستلام المُطابَق يجب أن يقع في مخازن المستخدم (BranchScoped يحصره بالفرع النشط أصلاً).
        $this->restrictToAccessibleStations($this->scopeToAccessibleWarehouses(FuelDelivery::query(), ['warehouse_id']))->findOrFail($request->validated()['fuel_delivery_id']);
        return $this->domain(fn () => new FuelSupplierInvoiceMatchResource(
            $this->service->matchSupplierInvoiceLine($invoice, $request->validated(), $request->user()->id),
        ));
    }
}
