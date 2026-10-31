<?php

namespace App\Services\Commerce;

use App\Models\CustomerIdentity;
use App\Models\CustomerPartnerLink;
use App\Models\Partner;
use App\Models\SalesChannel;
use App\Models\User;
use App\Models\WholesaleMembership;
use App\Services\CustomerPartnerLinkService;
use App\Tenancy\BranchScope;
use Illuminate\Support\Collection;
use Illuminate\Validation\ValidationException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  H6 Batch M — واجهة الموظف لربط مشترٍ معتمد بطرف (عميل) في أَوْج
 * ═══════════════════════════════════════════════════════════════
 *  طبقة رقيقة فوق {@see CustomerPartnerLinkService} (المصدر الوحيد لكتابة `customer_partner_links`: الأقفال، الأهلية، صلاحية
 *  `customer_access.manage`، رابط نشط واحد لكل هوية). لا تكتب هنا جداول الروابط ولا الأسعار؛ ولا تسعّر: ما يراه الموظف كـ«علاقة
 *  القائمة الفعلية» يأتي من {@see WholesalePriceAuthority::describeFor()} نفسه الذي يحكم الدفع.
 *
 *  الحدود: كل الاستعلامات تحت نطاق المستأجر (TenantScope)؛ العضوية يجب أن تكون على قناة جملة موسومة وبحالة `approved` للربط
 *  (فك الربط مسموح في أي حالة كي لا يبقى سعر خاص لمشترٍ موقوف)؛ الشريك يجب أن يكون عميلاً نشطاً من المستأجر نفسه. المشتري نفسه لا
 *  يصل هنا أبداً (مسارات الموظف وراء `auth:sanctum` + الصلاحيات)، ولا يُقبل أي معرّف شريك/قائمة من جانب المشتري في أي مسار.
 *  لا مساس بإعداد POS `apply_customer_price_list` ولا بقوائم الأسعار نفسها.
 */
class WholesalePartnerLinkAdminService
{
    public function __construct(
        private readonly CustomerPartnerLinkService $links,
        private readonly WholesalePriceAuthority $authority,
    ) {}

    /** @return Collection<int, Partner> عملاء نشطون من المستأجر (بحث نصي بسيط). */
    public function eligiblePartners(?string $q, int $limit = 20): Collection
    {
        $query = Partner::query()
            ->withoutGlobalScope(BranchScope::class)
            ->whereIn('type', ['customer', 'both'])
            ->where('is_active', true)
            ->orderBy('name')
            ->limit(max(1, min($limit, 50)));

        $term = $q === null ? '' : trim($q);
        if ($term !== '') {
            $like = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $term).'%';
            $query->where(fn ($w) => $w->where('name', 'like', $like)->orWhere('name_en', 'like', $like)->orWhere('code', 'like', $like)
                ->orWhere('phone', 'like', $like)->orWhere('mobile', 'like', $like)->orWhere('email', 'like', $like));
        }

        return $query->get(['id', 'code', 'name', 'name_en', 'phone', 'email', 'default_price_list_id']);
    }

    public function link(string $membershipId, string $partnerId, User $actor): CustomerPartnerLink
    {
        $membership = $this->membership($membershipId);
        if ($membership->status !== WholesaleMembership::APPROVED) {
            throw new WholesalePartnerLinkAdminException('membership_not_approved', 'لا يُربط إلا مشترٍ معتمد.', 422);
        }

        $partner = Partner::query()->withoutGlobalScope(BranchScope::class)->whereKey($partnerId)->first();
        if ($partner === null) {
            throw new WholesalePartnerLinkAdminException('partner_not_found', 'العميل غير موجود.', 404);
        }

        $identity = CustomerIdentity::query()->whereKey($membership->customer_identity_id)->firstOrFail();

        $existing = $this->activeLink($identity->id);
        if ($existing !== null && $existing->partner_id !== $partner->id) {
            throw new WholesalePartnerLinkAdminException('already_linked', 'للمشتري ربط نشط بعميل آخر. فكّ الربط أولاً.', 409);
        }

        try {
            return $this->links->link($identity, $partner, $actor);
        } catch (ValidationException $e) {
            // eligibility / permission refusals from the single writer surface as a stable reason, never as a 500
            $field = array_key_first($e->errors());
            $reason = match ($field) {
                'partner_id' => 'partner_not_eligible',
                'customer_identity_id' => 'identity_not_eligible',
                'actor' => 'actor_not_permitted',
                default => 'link_refused',
            };

            throw new WholesalePartnerLinkAdminException($reason, (string) ($e->errors()[$field][0] ?? 'تعذّر الربط.'), $reason === 'actor_not_permitted' ? 403 : 422);
        }
    }

    public function unlink(string $membershipId, User $actor): CustomerPartnerLink
    {
        $membership = $this->membership($membershipId);
        $active = $this->activeLink($membership->customer_identity_id);
        if ($active === null) {
            throw new WholesalePartnerLinkAdminException('not_linked', 'لا يوجد ربط نشط.', 404);
        }

        try {
            return $this->links->revoke($active, $actor);
        } catch (ValidationException $e) {
            throw new WholesalePartnerLinkAdminException('actor_not_permitted', (string) collect($e->errors())->flatten()->first(), 403);
        }
    }

    /**
     * @return array{
     *   active: CustomerPartnerLink|null,
     *   history: Collection<int, CustomerPartnerLink>,
     *   effective: array{source: string, price_list: ?\App\Models\PriceList, partner_list: ?\App\Models\PriceList, channel_list: ?\App\Models\PriceList}
     * }
     */
    public function show(string $membershipId): array
    {
        $membership = $this->membership($membershipId);
        $history = CustomerPartnerLink::query()
            ->where('customer_identity_id', $membership->customer_identity_id)
            ->with(['partner' => fn ($q) => $q->withoutGlobalScope(BranchScope::class)->select('id', 'code', 'name'), 'linkedBy:id,name', 'revokedBy:id,name'])
            ->orderByDesc('linked_at')
            ->get();

        return [
            'active' => $history->firstWhere('status', 'active'),
            'history' => $history,
            'effective' => $this->effective($membership),
        ];
    }

    /** علاقة القائمة الفعلية؛ لمشترٍ غير معتمد لا قائمة (البوابة نفسها تحجب الأسعار قبل الاعتماد). */
    public function effective(WholesaleMembership $membership): array
    {
        $channel = SalesChannel::query()->whereKey($membership->sales_channel_id)->firstOrFail();
        if ($membership->status !== WholesaleMembership::APPROVED) {
            return ['source' => 'none', 'price_list' => null, 'partner_list' => null, 'channel_list' => $this->authority->describeFor($membership->customer_identity_id, $channel)['channel_list']];
        }

        return $this->authority->describeFor($membership->customer_identity_id, $channel);
    }

    private function membership(string $id): WholesaleMembership
    {
        $membership = WholesaleMembership::query()->whereKey($id)->first();
        if ($membership === null) {
            throw new WholesalePartnerLinkAdminException('not_found', 'الطلب غير موجود.', 404);
        }

        if (! $this->authority->governsId($membership->sales_channel_id)) {
            throw new WholesalePartnerLinkAdminException('not_found', 'الطلب غير موجود.', 404);
        }

        return $membership;
    }

    private function activeLink(string $identityId): ?CustomerPartnerLink
    {
        return CustomerPartnerLink::query()->where('customer_identity_id', $identityId)->where('status', 'active')->first();
    }
}
