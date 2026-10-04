<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\StorefrontOfferResource;
use App\Models\Storefront;
use App\Models\StorefrontOffer;
use App\Services\Commerce\StorefrontOfferConflictException;
use App\Services\Commerce\StorefrontOfferResolver;
use App\Services\Commerce\StorefrontOfferService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * CUST-H4-6 — تهيئة العروض (CRUD) + قراءة معاينة Canvas لمساحة عمل Commerce.
 * الأساس: `docs/plans/store/CUST-H4-ARCH-1-SECTION-LIBRARY-ACTIVATION-CONTRACT.md` §23.4.
 *
 * **تنسيق وجدولة فقط** — لا سعر ولا خصم ولا نسبة في أي جسم طلب. الجسم يُقبل
 * بقائمة سماح صريحة؛ أي مفتاح آخر (بما فيه `price`/`discount`/`percent`، وبما
 * فيه `tenant_id`/`storefront_id` الذي لا يصحّ أن يكون سلطةً من العميل) يُرفض
 * بـ422 بدل أن يُتجاهَل صامتاً — لأن قبول حقلٍ ثم تجاهله يوحي للتاجر بأن خصماً
 * كُتب، وهذا بالضبط الفخّ الذي أُغلق بنيوياً في هذا الجدول.
 *
 * السلطة: المستأجر من `TenantContext`، والمتجر `ownedStorefront()` (أجنبي أو
 * غير موجود ⇒ 404 لا 403)، والعرض يُبحث عنه ضمن هذا المتجر وحده (متجرٌ آخر
 * لنفس المستأجر ⇒ 404). القراءة تستدعي `StorefrontOfferResolver` نفسه الذي
 * تستدعيه القراءة العامة — التكافؤ بنيويٌّ على مستوى الخدمة لا المسار.
 */
class CommerceWorkspaceStorefrontOfferController extends ApiController
{
    /** @var list<string> */
    private const ALLOWED_FIELDS = ['product_id', 'starts_at', 'ends_at', 'is_active', 'position'];

    public function index(Request $request, StorefrontOfferService $offers, StorefrontOfferResolver $resolver, string $id): JsonResponse
    {
        $this->denySelfService($request);
        $storefront = $this->storefrontOr404($offers, $id);

        $views = $resolver->allForStorefront($storefront->id, $storefront->sales_channel_id);

        return response()->json([
            'data' => array_map(fn ($view) => StorefrontOfferResource::workspace($view, $storefront->id), $views),
            'meta' => ['max_offers' => StorefrontOfferResolver::MAX_OFFERS_PER_STOREFRONT],
        ]);
    }

    public function store(Request $request, StorefrontOfferService $offers, StorefrontOfferResolver $resolver, string $id): JsonResponse
    {
        $this->denySelfService($request);
        $storefront = $this->storefrontOr404($offers, $id);
        $this->rejectUnknownFields($request);

        $data = $request->validate([
            'product_id' => ['required', 'string', 'uuid'],
            'starts_at' => ['sometimes', 'nullable', 'date'],
            'ends_at' => ['sometimes', 'nullable', 'date'],
            'is_active' => ['sometimes', 'boolean'],
            'position' => ['sometimes', 'integer', 'min:0', 'max:'.StorefrontOfferService::MAX_POSITION],
        ]);

        $offer = $this->guard(fn () => $offers->create($storefront, $data));

        return response()->json(['data' => $this->single($resolver, $storefront, $offer)], 201);
    }

    public function update(Request $request, StorefrontOfferService $offers, StorefrontOfferResolver $resolver, string $id, string $offer): JsonResponse
    {
        $this->denySelfService($request);
        $storefront = $this->storefrontOr404($offers, $id);
        $this->rejectUnknownFields($request);

        $data = $request->validate([
            'product_id' => ['sometimes', 'string', 'uuid'],
            'starts_at' => ['sometimes', 'nullable', 'date'],
            'ends_at' => ['sometimes', 'nullable', 'date'],
            'is_active' => ['sometimes', 'boolean'],
            'position' => ['sometimes', 'integer', 'min:0', 'max:'.StorefrontOfferService::MAX_POSITION],
        ]);

        $updated = $this->guard(fn () => $offers->update($storefront, $offer, $data));
        abort_if($updated === null, 404, 'العرض غير موجود.');

        return response()->json(['data' => $this->single($resolver, $storefront, $updated)]);
    }

    public function destroy(Request $request, StorefrontOfferService $offers, string $id, string $offer): JsonResponse
    {
        $this->denySelfService($request);
        $storefront = $this->storefrontOr404($offers, $id);

        abort_unless($offers->delete($storefront, $offer), 404, 'العرض غير موجود.');

        return response()->json(['data' => ['deleted' => true]]);
    }

    /** @return array<string, mixed> */
    private function single(StorefrontOfferResolver $resolver, Storefront $storefront, StorefrontOffer $offer): array
    {
        [$view] = $resolver->evaluate(collect([$offer]), $storefront->sales_channel_id);

        return StorefrontOfferResource::workspace($view, $storefront->id);
    }

    private function storefrontOr404(StorefrontOfferService $offers, string $id): Storefront
    {
        return $offers->ownedStorefront($id) ?? abort(404, 'المتجر غير موجود.');
    }

    private function rejectUnknownFields(Request $request): void
    {
        $unknown = array_diff(array_keys($request->all()), self::ALLOWED_FIELDS);
        if ($unknown === []) {
            return;
        }

        throw ValidationException::withMessages(array_fill_keys(
            array_values($unknown),
            ['حقل غير مسموح: العروض تنسيقٌ وجدولة فقط، والسعر والخصم يأتيان من التسعير القائم.'],
        ));
    }

    private function guard(callable $callback): mixed
    {
        try {
            return $callback();
        } catch (StorefrontOfferConflictException $e) {
            abort(409, $e->getMessage());
        }
    }

    private function denySelfService(Request $request): void
    {
        if ($request->user()?->role === 'self_service') {
            abort(403, 'مساحة عمل التجارة غير متاحة لحساب الخدمة الذاتية.');
        }
    }
}
