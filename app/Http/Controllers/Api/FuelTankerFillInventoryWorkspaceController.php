<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\FuelTankerFillResource;
use App\Models\FuelTankerFill;
use App\Services\FuelTankerFillInventoryActivityReader;
use App\Services\FuelTankerFillInventoryPostingService;
use App\Services\FuelTankerFillInventoryReadiness;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * TANKER-PR6B-5 — مساحة عمل الدمج المخزني لسندات التعبئة (قراءة فقط): قائمة بتبويبات (بانتظار الترحيل · مرحَّلة · معكوسة · تحتاج انتباهاً) وتفاصيل سند واحد بحقائق الترحيل والعكس وسجل المحاولات
 * والإجراءات المتاحة **من الخادم** (لا زر لإجراء لا يملكه المستخدم). **حالة السند ونتيجة المحاولة منفصلتان** في الحمولة (`inventory_status` مقابل `last_attempt`).
 *
 * خلف البوابات الثلاث نفسها للترحيل (PR-1 وPR-4 وبوابة الترحيل) ⇒ 404 موحَّد مغلقاً؛ `fuel.tanker.fill.inventory.view` + قدرة `fuel_stations.core`؛ نطاق المحطة/الفرع كسندات PR-4 و404 موحَّد.
 * المبالغ ومعرّفات القيود والحركات لـ`products.view_cost` فقط، ومعرّفات الحسابات واسمها لـ`accounts.view` فقط (شرطان مستقلان). **لا مسار يصل جلسة PIN.**
 */
class FuelTankerFillInventoryWorkspaceController extends ApiController
{
    use AuthorizesFuelStationScope;

    private const PER_PAGE = 20;
    private const MAX_PER_PAGE = 100;

    public function __construct(private FuelTankerFillInventoryActivityReader $activity, private FuelTankerFillInventoryReadiness $readiness) {}

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'tab' => ['nullable', 'in:' . implode(',', FuelTankerFillInventoryActivityReader::TABS)],
            'station_id' => ['nullable', 'uuid'],
            'q' => ['nullable', 'string', 'max:64'],
            'page' => ['nullable', 'integer', 'min:1'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:' . self::MAX_PER_PAGE],
        ]);
        $tab = $filters['tab'] ?? 'pending';
        if (! empty($filters['station_id'])) {
            $this->accessibleStation($filters['station_id']);
        }

        // نطاق المستخدم (محطات/فرع) + مرشّح المحطة؛ الأعداد بلا مرشّح البحث `q` (ثابتة عبر التبويبات).
        $scoped = function () use ($request, $filters) {
            $query = FuelTankerFill::query();
            if (! empty($filters['station_id'])) {
                $query->where('fuel_station_id', $filters['station_id']);
            }
            $this->restrictToAccessibleStations($query);

            return $this->scopeToActiveBranch($query, $request);
        };

        $query = $this->activity->applyTab($scoped(), $tab)->with(['owner', 'tanker'])->orderByDesc('recorded_at')->orderByDesc('id');
        $q = trim((string) ($filters['q'] ?? ''));
        if ($q !== '') {
            $voucher = FuelTankerFill::normalizeVoucher($q);
            $query->where(fn ($w) => $w->where('number', 'like', '%' . str_replace(['%', '_'], ['\%', '\_'], $q) . '%')->orWhere('voucher_key', $voucher['key'] ?? '__invalid__'));
        }
        $page = $query->paginate((int) ($filters['per_page'] ?? self::PER_PAGE));
        $fills = collect($page->items());

        $canSeeCost = $request->user()->hasPermission('products.view_cost');
        $summaries = $this->activity->summaries($fills, $canSeeCost);
        $readiness = $tab === 'pending' && $fills->isNotEmpty()
            ? $this->readiness->evaluate($fills, false, null, $this->accessibleStationIds())['items']
            : [];

        return response()->json([
            'data' => $fills->map(fn (FuelTankerFill $fill) => array_merge(
                (new FuelTankerFillResource($fill))->resolve($request),
                ['inventory' => $summaries[$fill->id] ?? null, 'readiness' => $readiness[$fill->id] ?? null],
            ))->all(),
            'meta' => [
                'tab' => $tab, 'page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage(),
                'counts' => $this->activity->counts($scoped),
                'posting_enabled' => FuelTankerFillInventoryPostingService::enabled(),
            ],
        ]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $fill = $this->scopeToActiveBranch(FuelTankerFill::query()->with(['owner', 'tanker']), $request)->findOrFail($id);
        $this->accessibleStation($fill->fuel_station_id);

        $detail = $this->activity->detail($fill, $request->user());
        $readiness = $fill->status === FuelTankerFill::STATUS_RECORDED && $fill->inventory_status === FuelTankerFill::INVENTORY_PENDING_INTEGRATION
            ? ($this->readiness->evaluate(collect([$fill]), false, null, $this->accessibleStationIds())['items'][$fill->id] ?? null)
            : null;

        return response()->json(['data' => array_merge(
            (new FuelTankerFillResource($fill))->resolve($request),
            [
                'inventory' => ['status' => $fill->inventory_status] + $detail,
                'readiness' => $readiness,
                'actions' => $this->activity->actions($fill, $request->user(), $detail['posting'] !== null),
            ],
        ), 'meta' => ['posting_enabled' => FuelTankerFillInventoryPostingService::enabled()]]);
    }
}
