<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreFuelTankerFillRequest;
use App\Http\Requests\VoidFuelTankerFillRequest;
use App\Http\Resources\FuelTankerFillResource;
use App\Models\FuelTankerFill;
use App\Services\FuelTankerFillService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * TANKER-PR4 — سندات تعبئة الصهاريج (إنشاء/استعلام/عرض/إلغاء). **تشغيلي فقط: لا مخزون ولا قيد ولا فاتورة ولا تحصيل.**
 *
 * - بوابة نشر منفصلة `fuel_stations.tanker_fills_enabled` (مغلقة افتراضياً ⇒ 404 موحَّد قبل أي صلاحية) فوق بوابة PR-1.
 * - صلاحيات دقيقة (`fuel.tanker.fill.view|record|void`) + قدرة `fuel_stations.core`؛ نطاق المحطة (فرع/مخزن/محطة مسنَدة) 404 موحَّد قبل أي أثر؛ العزل بالمستأجر من `BaseModel`.
 * - لا `tenant_id` من العميل. جلسة PIN لا تصل هذه المسارات (خارج `StationSessionBoundary`، فشل مغلق): لا واجهة تشغيلية لموظف المحطة قبل اكتمال التكامل.
 */
class FuelTankerFillController extends ApiController
{
    use AuthorizesFuelStationScope;

    private const PER_PAGE = 50;
    private const MAX_PER_PAGE = 100;

    public function __construct(private FuelTankerFillService $fills) {}

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'station_id' => ['nullable', 'uuid'],
            'shift_id' => ['nullable', 'uuid'],
            'owner_id' => ['nullable', 'uuid'],
            'tanker_id' => ['nullable', 'uuid'],
            'nozzle_id' => ['nullable', 'uuid'],
            'status' => ['nullable', 'in:' . implode(',', FuelTankerFill::STATUSES)],
            'voucher_number' => ['nullable', 'string', 'max:64'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:' . self::MAX_PER_PAGE],
        ]);

        $query = FuelTankerFill::query()->with(['owner', 'tanker'])->withCount('activeAttachments')->orderByDesc('recorded_at')->orderByDesc('id');
        foreach (['station_id' => 'fuel_station_id', 'shift_id' => 'fuel_shift_id', 'owner_id' => 'fuel_tanker_owner_id', 'tanker_id' => 'fuel_tanker_id', 'nozzle_id' => 'fuel_nozzle_id', 'status' => 'status'] as $param => $column) {
            if (! empty($filters[$param])) {
                $query->where($column, $filters[$param]);
            }
        }
        // `empty('0')` صحيحة في PHP والسند «0» صالح: يُفحص الغياب/الفراغ صراحةً.
        if (isset($filters['voucher_number']) && $filters['voucher_number'] !== '') {
            $voucher = FuelTankerFill::normalizeVoucher($filters['voucher_number']);
            $query->where('voucher_key', $voucher['key'] ?? '__invalid__');
        }
        if (! empty($filters['from'])) {
            $query->where('recorded_at', '>=', $this->instant($filters['from']));
        }
        if (! empty($filters['to'])) {
            $query->where('recorded_at', '<=', $this->instant($filters['to']));
        }

        // محطات المستخدم (فرع + مخزن + إسناد) — `FuelTankerFill` BranchScoped فرعاً فقط، فبلا هذا تظهر تعبئات محطة أخرى من الفرع نفسه.
        $this->restrictToAccessibleStations($query);

        return FuelTankerFillResource::collection(
            $this->scopeToActiveBranch($query, $request)->paginate((int) ($filters['per_page'] ?? self::PER_PAGE))
        )->response();
    }

    public function show(Request $request, string $id): JsonResponse
    {
        return (new FuelTankerFillResource($this->visibleFill($id, $request)->load(['owner', 'tanker'])->loadCount('activeAttachments')))->response();
    }

    public function store(StoreFuelTankerFillRequest $request): JsonResponse
    {
        $intent = $request->intent();
        // قبل الخدمة: محطة خارج فرع/مخزن/إسناد المستخدم (أو مستأجر آخر) = 404 موحّد بلا أي أثر.
        $this->accessibleStation($intent['fuel_station_id']);
        $result = $this->domain(fn () => $this->fills->record($intent, $request->user()));

        return (new FuelTankerFillResource($result['fill']->load(['owner', 'tanker'])))
            ->additional(['meta' => ['replayed' => $result['replayed']]])
            ->response()
            ->setStatusCode($result['replayed'] ? 200 : 201);
    }

    public function void(VoidFuelTankerFillRequest $request, string $id): JsonResponse
    {
        $fill = $this->visibleFill($id, $request);
        $voided = $this->domain(fn () => $this->fills->void($fill, $request->validated()['reason'], $request->user()));

        return (new FuelTankerFillResource($voided->load(['owner', 'tanker'])))->response();
    }

    /** لحظة بتوقيت التخزين (منطقة التطبيق) — مقارنة نصية صحيحة مع `recorded_at`. */
    private function instant(string $value): string
    {
        return \Carbon\CarbonImmutable::parse($value)->setTimezone((string) config('app.timezone'))->toDateTimeString();
    }

    private function visibleFill(string $id, Request $request): FuelTankerFill
    {
        $fill = $this->scopeToActiveBranch(FuelTankerFill::query(), $request)->findOrFail($id);
        $this->accessibleStation($fill->fuel_station_id);

        return $fill;
    }
}
