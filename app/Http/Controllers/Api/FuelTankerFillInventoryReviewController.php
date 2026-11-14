<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\FuelTankerFillResource;
use App\Models\FuelStation;
use App\Models\FuelTankerFill;
use App\Services\FuelInventoryLedgerReconciliation;
use App\Services\FuelTankerFillInventoryReadiness;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * TANKER-PR6A — مراجعة جاهزية السندات المعلّقة للدمج المخزني. **قراءة فقط**: لا ترحيل ولا خصم ولا قيد ولا كتابة من أي نوع، ولا مسار POST/PUT/DELETE هنا.
 *
 * - بوابتا النشر نفسهما (`tanker_management` + `tanker_fills`) ⇒ 404 موحَّد مغلقاً؛ صلاحية `fuel.tanker.fill.inventory.view` + قدرة `fuel_stations.core`؛ نطاق المحطة والفرع كسندات PR-4.
 * - الأعمدة المالية (قيمة مجمّع التكلفة) تظهر لمن يملك `products.view_cost` فقط؛ بدونها تغيب من الحمولة نفسها.
 * - السقف: أقدم {@see self::SCAN_LIMIT} سنداً معلّقاً تُقيَّم في الطلب الواحد (`meta.truncated` إن زادت)، فلا مسح غير محدود.
 */
class FuelTankerFillInventoryReviewController extends ApiController
{
    use AuthorizesFuelStationScope;

    private const SCAN_LIMIT = 500;
    private const PER_PAGE = 25;
    private const MAX_PER_PAGE = 100;

    public function __construct(private FuelTankerFillInventoryReadiness $readiness, private FuelInventoryLedgerReconciliation $reconciliation) {}

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'station_id' => ['nullable', 'uuid'],
            'readiness' => ['nullable', 'in:' . implode(',', [FuelTankerFillInventoryReadiness::READY, FuelTankerFillInventoryReadiness::NEEDS_REVIEW, FuelTankerFillInventoryReadiness::BLOCKED])],
            'overdue' => ['nullable', 'boolean'],
            'page' => ['nullable', 'integer', 'min:1'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:' . self::MAX_PER_PAGE],
        ]);

        $query = FuelTankerFill::query()
            ->where('status', FuelTankerFill::STATUS_RECORDED)->where('inventory_status', FuelTankerFill::INVENTORY_PENDING_INTEGRATION)
            ->with(['owner', 'tanker'])->orderBy('recorded_at')->orderBy('id');
        if (! empty($filters['station_id'])) {
            $this->accessibleStation($filters['station_id']);
            $query->where('fuel_station_id', $filters['station_id']);
        }
        $this->restrictToAccessibleStations($query);
        $fills = $this->scopeToActiveBranch($query, $request)->limit(self::SCAN_LIMIT + 1)->get();
        $truncated = $fills->count() > self::SCAN_LIMIT;
        $fills = $fills->take(self::SCAN_LIMIT);

        $result = $this->readiness->evaluate($fills, $request->user()->hasPermission('products.view_cost'), null, $this->accessibleStationIds());
        $summary = FuelTankerFillInventoryReadiness::summarize($result['items']);

        $rows = $fills->filter(function (FuelTankerFill $fill) use ($result, $filters) {
            $item = $result['items'][$fill->id];

            return (empty($filters['readiness']) || $item['readiness'] === $filters['readiness'])
                && (! array_key_exists('overdue', $filters) || $filters['overdue'] === null || (bool) $filters['overdue'] === $item['overdue']);
        })->values();

        $perPage = (int) ($filters['per_page'] ?? self::PER_PAGE);
        $page = (int) ($filters['page'] ?? 1);
        $slice = $rows->slice(($page - 1) * $perPage, $perPage)->values();

        return response()->json([
            'data' => $slice->map(fn (FuelTankerFill $fill) => array_merge(
                (new FuelTankerFillResource($fill))->resolve($request),
                ['inventory_readiness' => $result['items'][$fill->id]],
            ))->all(),
            'meta' => [
                'page' => $page, 'per_page' => $perPage, 'total' => $rows->count(), 'last_page' => max(1, (int) ceil($rows->count() / $perPage)),
                'summary' => $summary,
                'pools' => $result['pools'],
                'truncated' => $truncated,
                // الترحيل غير مفعَّل في هذه المرحلة (ثابت لا إعداد): هذه الشاشة مراجعة وعرض فقط.
                'posting_enabled' => FuelTankerFillInventoryReadiness::POSTING_ENABLED,
                'reconciliation_requirements' => FuelTankerFillInventoryReadiness::RECONCILIATION_REQUIREMENTS,
            ],
        ]);
    }

    /**
     * TANKER-PR6B-0 — مطابقة مجمّع تكلفة الوقود مع رصيد المخزن والأستاذ العام. **قراءة فقط** (GET وحده): لا قفل ولا قيد ولا حركة ولا تسوية.
     * الكمية لكل مجمّع ضمن مخازن المراجع؛ **القيمة** (لكل فرع) تتطلب `products.view_cost` **وعدم التقييد بمخزن/محطة** (الفرع يضم مخازن لا يراها المقيَّد)، وإلا لا تظهر أي قيمة مالية في الحمولة.
     * الصلاحية والبوابتان نفسها لمراجعة الجاهزية؛ لا صلاحية جديدة.
     */
    public function reconciliation(Request $request): JsonResponse
    {
        $user = $request->user();
        $stationIds = $this->accessibleStationIds();
        $visibleWarehouses = $stationIds === null ? null : FuelStation::query()->whereIn('id', $stationIds)->whereNotNull('warehouse_id')->pluck('warehouse_id')->unique()->values()->all();
        $fullScope = $user->allowedWarehouseIds() === null && $user->allowedFuelStationIds() === null;

        $result = $this->reconciliation->reconcile($visibleWarehouses, $user->allowedBranchIds(), $user->hasPermission('products.view_cost'), $fullScope);

        return response()->json([
            'data' => $result,
            'meta' => ['read_only' => true, 'posting_enabled' => FuelTankerFillInventoryReadiness::POSTING_ENABLED],
        ]);
    }
}
