<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\EndFuelTankerOwnerLinkRequest;
use App\Http\Requests\StoreFuelTankerOwnerLinkRequest;
use App\Http\Requests\StoreFuelTankerOwnerRequest;
use App\Http\Requests\StoreFuelTankerRequest;
use App\Http\Requests\UpdateFuelTankerOwnerRequest;
use App\Http\Requests\UpdateFuelTankerRequest;
use App\Http\Resources\FuelTankerOwnerLinkResource;
use App\Http\Resources\FuelTankerOwnerResource;
use App\Http\Resources\FuelTankerResource;
use App\Models\FuelTanker;
use App\Models\FuelTankerOwner;
use App\Models\FuelTankerOwnerCompanyLink;
use App\Services\FuelTankerService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * TANKER-PR1 — بيانات أصحاب الصهاريج الرئيسية (الملف، الصهريج، ربط الشركات). **بلا أثر مالي أو مخزني.**
 *
 * البوابة `fuel_stations.tanker_management_enabled` (وسيط `EnsureFuelTankerManagementEnabled` أول المسار) مغلقة ⇒ 404 موحَّد. التفويض بمفتاحَي `fuel.tanker.view|manage`
 * + قدرة `fuel_stations.core` التجارية؛ العزل بالمستأجر من `BaseModel`. كل الكتابة عبر `FuelTankerService` (الكاتب الوحيد، مع التدقيق). جلسة PIN لا تصل هذه المسارات
 * (خارج `StationSessionBoundary`، فشل مغلق) — وصول الموظف الميداني لقراءة صاحب الصهريج شريحة لاحقة منفصلة.
 */
class FuelTankerController extends ApiController
{
    private const PER_PAGE = 50;

    public function __construct(private FuelTankerService $tankers) {}

    // ── أصحاب الصهاريج ──

    public function owners(Request $request): JsonResponse
    {
        $query = FuelTankerOwner::query()
            ->when($request->query('status'), fn ($q, $status) => $q->where('status', (string) $status))
            ->when($request->query('q'), function ($q, $term) {
                $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], (string) $term) . '%';
                $q->where(fn ($w) => $w->where('name', 'like', $like)->orWhere('code', 'like', $like));
            })
            ->orderBy('name')->orderBy('id');

        return FuelTankerOwnerResource::collection($query->paginate(self::PER_PAGE))->response();
    }

    public function showOwner(string $id): FuelTankerOwnerResource
    {
        return new FuelTankerOwnerResource(FuelTankerOwner::query()->findOrFail($id));
    }

    public function storeOwner(StoreFuelTankerOwnerRequest $request): JsonResponse
    {
        $owner = $this->domain(fn () => $this->tankers->createOwner($request->validated(), $request->user()));

        return (new FuelTankerOwnerResource($owner))->response()->setStatusCode(201);
    }

    public function updateOwner(UpdateFuelTankerOwnerRequest $request, string $id): FuelTankerOwnerResource
    {
        $owner = FuelTankerOwner::query()->findOrFail($id);

        return new FuelTankerOwnerResource($this->domain(fn () => $this->tankers->updateOwner($owner, $request->validated(), $request->user())));
    }

    // ── الصهاريج ──

    public function tankers(Request $request): JsonResponse
    {
        $query = FuelTanker::query()->with('owner')
            ->when($request->query('owner_id'), fn ($q, $owner) => $q->where('fuel_tanker_owner_id', (string) $owner))
            ->when($request->query('status'), fn ($q, $status) => $q->where('status', (string) $status))
            ->orderBy('plate_number')->orderBy('id');

        return FuelTankerResource::collection($query->paginate(self::PER_PAGE))->response();
    }

    public function showTanker(string $id): FuelTankerResource
    {
        return new FuelTankerResource(FuelTanker::query()->with('owner')->findOrFail($id));
    }

    public function storeTanker(StoreFuelTankerRequest $request): JsonResponse
    {
        $tanker = $this->domain(fn () => $this->tankers->createTanker($request->validated(), $request->user()));

        return (new FuelTankerResource($tanker))->response()->setStatusCode(201);
    }

    public function updateTanker(UpdateFuelTankerRequest $request, string $id): FuelTankerResource
    {
        $tanker = FuelTanker::query()->findOrFail($id);

        return new FuelTankerResource($this->domain(fn () => $this->tankers->updateTanker($tanker, $request->validated(), $request->user())));
    }

    // ── ربط الشركات (مؤرَّخ) ──

    public function links(string $ownerId): JsonResponse
    {
        $owner = FuelTankerOwner::query()->findOrFail($ownerId);
        $links = FuelTankerOwnerCompanyLink::query()->with('partner')->where('fuel_tanker_owner_id', $owner->id)
            ->orderByDesc('valid_from')->orderBy('id')->paginate(self::PER_PAGE);

        return FuelTankerOwnerLinkResource::collection($links)->response();
    }

    public function storeLink(StoreFuelTankerOwnerLinkRequest $request, string $ownerId): JsonResponse
    {
        $owner = FuelTankerOwner::query()->findOrFail($ownerId);
        $link = $this->domain(fn () => $this->tankers->createLink($owner, $request->validated(), $request->user()));

        return (new FuelTankerOwnerLinkResource($link))->response()->setStatusCode(201);
    }

    public function endLink(EndFuelTankerOwnerLinkRequest $request, string $ownerId, string $linkId): FuelTankerOwnerLinkResource
    {
        $link = FuelTankerOwnerCompanyLink::query()->where('fuel_tanker_owner_id', $ownerId)->findOrFail($linkId);

        return new FuelTankerOwnerLinkResource($this->domain(fn () => $this->tankers->endLink($link, $request->validated(), $request->user())));
    }
}
