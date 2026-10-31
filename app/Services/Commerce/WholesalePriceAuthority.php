<?php

namespace App\Services\Commerce;

use App\Models\CustomerPartnerLink;
use App\Models\Partner;
use App\Models\PriceList;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\SalesChannel;
use App\Models\WholesaleMembership;
use App\Services\PriceListService;
use App\Tenancy\BranchScope;
use App\Tenancy\CustomerContext;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\Log;

/**
 * ═══════════════════════════════════════════════════════════════
 *  H6 Batch J — السلطة الوحيدة لتسعير قناة الجملة (قرار المالك المعتمد)
 * ═══════════════════════════════════════════════════════════════
 *  الأسبقية، لكل سطر، بالترتيب، وأول إصابة تفوز:
 *    1. عنصر قائمة سعر **الشريك** المرتبط بالمشتري المعتمد (رابط نشط ← شريك عميل نشط ← قائمة نشطة).
 *    2. عنصر قائمة سعر **قناة الجملة** (نشطة).
 *    3. لا شيء ⇒ **غير متاح للجملة**. لا سعر المنتج الأساسي/التجزئة بديلاً أبداً.
 *
 *  - «قناة جملة» = `sales_channels.wholesale_membership_enabled`. القناة غير الموسومة لا تمرّ من هنا إطلاقاً
 *    (التجزئة/DTC بلا أي تغيير).
 *  - هوية المشتري من جلسة الخادم (`CustomerContext` الذي يثبّته `EnsureWholesalePriceAccess` بعد التحقق من الرمز والقناة
 *    والعضوية) — لا معرّف مشترٍ/شريك/قائمة من الطلب. ويُعاد التحقق من **عضوية معتمدة** لهذه القناة هنا أيضاً (دفاع بالعمق).
 *  - قائمة شريك غير نشطة، أو شريك غير عميل/معطّل، أو رابط ملغى ⇒ تُهمل (تنتقل الأسبقية لقائمة القناة). قائمة قناة غير نشطة أو
 *    لا يحلّها نطاق المستأجر (محذوفة/عابرة للمستأجر) ⇒ لا قائمة قناة (لا استثناء ولا سعر أساسي).
 *  - «منتهية الصلاحية» = غير نشطة: لا أعمدة صلاحية زمنية على القوائم (راجع مصفوفة الدفعة I).
 *  - قائمة الشريك هنا **لا تتبع** إعداد POS `apply_customer_price_list` (القرار D-B2): POS ومساراته بلا مساس.
 *  - عنصر القائمة ذو السعر `0` سعرٌ صريح مقصود (كما في بقية الطبقة)؛ الغياب وحده يعني «لا إدخال».
 */
final class WholesalePriceAuthority
{
    public function __construct(private readonly PriceListService $priceLists) {}

    /** هل تحكم هذه القناة قواعد الجملة؟ (الموسومة فقط) */
    public function governs(SalesChannel $channel): bool
    {
        return (bool) $channel->wholesale_membership_enabled;
    }

    public function governsId(string $salesChannelId): bool
    {
        $channel = SalesChannel::query()->whereKey($salesChannelId)->first();

        return $channel !== null && $this->governs($channel);
    }

    /**
     * الموقف التسعيري للطلب الحالي على هذه القناة. لا يرمي لحالات «غير مؤهل» — يعيد سياقاً غير مؤهل (فشل مغلق).
     */
    public function context(SalesChannel $channel): WholesalePriceContext
    {
        $tenantId = app(TenantContext::class)->id();
        $customer = app(CustomerContext::class);

        if ($tenantId === null || ! $customer->isEstablished() || $customer->tenantId() !== $tenantId) {
            return WholesalePriceContext::ineligible();
        }

        $identityId = $customer->customerIdentityId();

        // عضوية معتمدة لهذه القناة بالذات (نطاق المستأجر تلقائي). موقوف/معلّق/مرفوض/قناة أخرى ⇒ غير مؤهل.
        $approved = WholesaleMembership::query()
            ->where('customer_identity_id', $identityId)
            ->where('sales_channel_id', $channel->id)
            ->where('status', WholesaleMembership::APPROVED)
            ->exists();
        if (! $approved) {
            return WholesalePriceContext::ineligible();
        }

        return new WholesalePriceContext(true, $this->partnerList($identityId), $this->channelList($channel));
    }

    /**
     * سعر الوحدة من الأسبقية المعتمدة، أو `null` ⇒ غير متاح للجملة.
     *
     * @return array{amount: int, priceList: PriceList}|null
     */
    public function priceFor(
        WholesalePriceContext $context,
        Product $product,
        ?string $unitName,
        ?ProductVariant $variant,
        bool $lock = false,
    ): ?array {
        if (! $context->eligible) {
            return null;
        }

        foreach ($context->lists() as $list) {
            if ($lock) {
                // يقفل صف القائمة ويعيد قراءته: تعطيلٌ متزامن بين السلة والإتمام يُرى هنا فتُهمل القائمة (فشل مغلق).
                $fresh = PriceList::query()->whereKey($list->id)->lockForUpdate()->first();
                if ($fresh === null || ! $fresh->is_active) {
                    continue;
                }
                $list = $fresh;
            } elseif (! $list->is_active) {
                continue;
            }

            $amount = $this->priceLists->resolve($list, $product, $unitName, $lock, $variant);
            if ($amount !== null) {
                return ['amount' => $amount, 'priceList' => $list];
            }
        }

        return null;
    }

    /**
     * H6 Batch M — «العلاقة الفعلية» لعرض الموظف فقط (لا يسعّر شيئاً): أي قائمة ستحكم هذا المشتري على هذه القناة الآن.
     * يعيد استعمال نفس الدالتين الخاصتين اللتين تبني بهما `context()` الأسبقية، فلا نسخة ثانية من القاعدة: رابط نشط ← شريك عميل نشط ←
     * قائمة نشطة، وإلا قائمة القناة النشطة، وإلا لا شيء (غير متاح للجملة — لا سعر أساسي بديلاً).
     *
     * @return array{source: 'partner'|'channel'|'none', price_list: PriceList|null, partner_list: PriceList|null, channel_list: PriceList|null}
     */
    public function describeFor(string $identityId, SalesChannel $channel): array
    {
        $partnerList = $this->partnerList($identityId);
        $channelList = $this->channelList($channel);

        return [
            'source' => $partnerList !== null ? 'partner' : ($channelList !== null ? 'channel' : 'none'),
            'price_list' => $partnerList ?? $channelList,
            'partner_list' => $partnerList,
            'channel_list' => $channelList,
        ];
    }

    private function partnerList(string $identityId): ?PriceList
    {
        $link = CustomerPartnerLink::query()
            ->where('customer_identity_id', $identityId)
            ->where('status', 'active')
            ->first();
        if ($link === null) {
            return null;
        }

        $partner = Partner::query()->withoutGlobalScope(BranchScope::class)->find($link->partner_id);
        if ($partner === null || ! $partner->is_active || ! $partner->isCustomer() || $partner->default_price_list_id === null) {
            return null;
        }

        // TenantScope: قائمة من مستأجر آخر لا تُحلّ ⇒ null ⇒ تُهمل.
        $list = PriceList::query()->find($partner->default_price_list_id);

        return $list !== null && $list->is_active ? $list : null;
    }

    private function channelList(SalesChannel $channel): ?PriceList
    {
        if ($channel->default_price_list_id === null) {
            return null;
        }

        $list = $channel->defaultPriceList()->first();
        if ($list === null) {
            // مرجع مُعدّ لا يحلّه نطاق المستأجر: تالف/محذوف/عابر للمستأجر. لا استثناء (الجملة تفشل مغلقة: غير متاح)، ولا سعر أساسي.
            Log::warning('wholesale.channel_price_list_unresolvable', ['sales_channel_id' => $channel->id]);

            return null;
        }

        return $list->is_active ? $list : null;
    }
}
