<?php

namespace Tests\Feature;

use App\Models\Partner;
use App\Models\PriceList;
use App\Models\PriceListItem;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Services\Commerce\CommercePriceResolver;
use App\Services\Commerce\ResolvedCommercePrice;
use App\Support\PosSettings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use PHPUnit\Framework\Attributes\Test;
use RuntimeException;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  H6 Batch I (P2) — مصفوفة أسبقية التسعير: توصيفٌ لما يفعله `CommercePriceResolver` اليوم
 * ═══════════════════════════════════════════════════════════════
 *  لا قاعدة تسعير جديدة هنا. كل اختبار يثبّت صفاً من المصفوفة الموثَّقة في `docs/audits/AWJ_H6_BATCH_I_PRICING_PRECEDENCE_MATRIX.md`
 *  كما هو **الآن**، ليصير أي تغيير مستقبلي قراراً صريحاً يمرّ بموافقة المالك لا نتيجةً عرضية. الصفوف المعلَّمة «قرار مالك»
 *  تصف سلوكاً قائماً قد لا يكون ما يريده المالك للجملة؛ تغييرها مؤجَّل عمداً.
 *
 *  عضوية المشتري (موقوف/غير معتمد) ليست جزءاً من المحلِّل أصلاً: تُحكم قبله في الوسيط `EnsureWholesalePriceAccess`
 *  (يثبّتها `WholesalePriceVisibilityTest` و`WholesaleCartCheckoutBoundaryTest`)؛ هنا يُثبَّت فقط أن المحلِّل لا يعرف المشتري.
 */
class CommercePricePrecedenceMatrixTest extends TestCase
{
    use RefreshDatabase;

    private CommercePriceResolver $resolver;

    private Tenant $tenant;

    private Product $product;

    private SalesChannel $channel;

    protected function setUp(): void
    {
        parent::setUp();
        $this->tenant = Tenant::create(['name' => 'مصفوفة', 'slug' => 'matrix-'.uniqid(), 'vat_number' => '300000000000003', 'currency' => 'SAR']);
        app(TenantContext::class)->set($this->tenant->id);

        $this->product = Product::create(['name' => 'صنف المصفوفة', 'sale_price' => 10000]);
        $this->channel = SalesChannel::create(['slug' => 'web', 'name' => 'جملة', 'type' => SalesChannel::TYPE_WEB]);
        $this->resolver = app(CommercePriceResolver::class);
    }

    private function list(string $name, int $price, bool $active = true, ?Product $product = null): PriceList
    {
        $list = PriceList::create(['name' => $name, 'is_active' => $active]);
        if ($price > 0) {
            PriceListItem::create(['price_list_id' => $list->id, 'product_id' => ($product ?? $this->product)->id, 'unit_name' => $this->product->unit ?? '', 'price' => $price]);
        }

        return $list;
    }

    private function channelList(PriceList $list): void
    {
        $this->channel->forceFill(['default_price_list_id' => $list->id])->save();
    }

    private function partner(?PriceList $list): Partner
    {
        return Partner::create(['name' => 'عميل '.uniqid(), 'type' => 'customer', 'default_price_list_id' => $list?->id]);
    }

    private function resolve(?Partner $partner = null): ResolvedCommercePrice
    {
        return $this->resolver->resolve($this->product->id, $this->channel->id, $partner?->id);
    }

    // ───────────── 1 · مشترٍ معتمد + قائمة شريك نشطة صالحة ─────────────

    #[Test]
    public function m1_an_active_partner_list_with_an_item_wins_over_the_channel_list_and_the_base_price(): void
    {
        $partnerList = $this->list('partner', 7000);
        $this->channelList($this->list('channel', 8500));

        $r = $this->resolve($this->partner($partnerList));

        $this->assertSame(7000, $r->amount);
        $this->assertSame(ResolvedCommercePrice::SOURCE_PRICE_LIST, $r->source);
        $this->assertSame($partnerList->id, $r->priceListId);
    }

    #[Test]
    public function m1b_owner_decision_a_partner_list_without_the_item_falls_to_the_base_price_not_the_channel_list(): void
    {
        // السلوك القائم: اختيار القائمة يسبق البحث عن العنصر. قائمة الشريك تُختار فتُهمل قائمة القناة كلياً حتى لو كانت تحمل سعراً
        // للمنتج، ويُرجَع السعر الأساسي. قد لا يكون هذا ما يريده المالك (D-B1) — موثَّق وغير معدَّل.
        $partnerList = $this->list('partner-empty', 0);
        $this->channelList($this->list('channel', 8500));

        $r = $this->resolve($this->partner($partnerList));

        $this->assertSame(10000, $r->amount);
        $this->assertSame(ResolvedCommercePrice::SOURCE_PRODUCT_DEFAULT, $r->source);
        // `priceListId` يحمل القائمة المختارة، لكن **البصمة** المخزَّنة على سطر الطلب (`provenanceListId()`) تبقى فارغة لأن المصدر
        // سعر المنتج: قيد `commerce_order_lines` (product_default ⇒ price_list_id NULL) يبقى سليماً.
        $this->assertSame($partnerList->id, $r->priceListId);
        $this->assertNull($r->provenanceListId());
    }

    // ───────────── 2 · مشترٍ معتمد بلا قائمة شريك ─────────────

    #[Test]
    public function m2_a_partner_without_a_list_uses_the_channel_list(): void
    {
        $channelList = $this->list('channel', 8500);
        $this->channelList($channelList);

        $r = $this->resolve($this->partner(null));

        $this->assertSame(8500, $r->amount);
        $this->assertSame($channelList->id, $r->priceListId);
    }

    // ───────────── 3 · قائمة القناة متاحة ─────────────

    #[Test]
    public function m3_the_channel_list_applies_when_no_partner_is_given(): void
    {
        $channelList = $this->list('channel', 8500);
        $this->channelList($channelList);

        $r = $this->resolve();

        $this->assertSame(8500, $r->amount);
        $this->assertSame(ResolvedCommercePrice::SOURCE_PRICE_LIST, $r->source);
        $this->assertSame($channelList->id, $r->priceListId);
    }

    #[Test]
    public function m3b_a_channel_list_without_the_item_falls_to_the_base_price(): void
    {
        $this->channelList($this->list('channel-empty', 0));

        $r = $this->resolve();

        $this->assertSame(10000, $r->amount);
        $this->assertSame(ResolvedCommercePrice::SOURCE_PRODUCT_DEFAULT, $r->source);
    }

    // ───────────── 4 · السعر الاحتياطي للمنتج ─────────────

    #[Test]
    public function m4_no_list_anywhere_resolves_to_the_product_price(): void
    {
        $r = $this->resolve();

        $this->assertSame(10000, $r->amount);
        $this->assertSame(ResolvedCommercePrice::SOURCE_PRODUCT_DEFAULT, $r->source);
        $this->assertNull($r->priceListId);
    }

    // ───────────── 5 · قائمة منتهية/معطّلة ─────────────

    #[Test]
    public function m5a_an_inactive_partner_list_is_ignored_and_the_channel_list_applies(): void
    {
        $this->channelList($channelList = $this->list('channel', 8500));
        $inactive = $this->list('partner-off', 7000, active: false);

        $r = $this->resolve($this->partner($inactive));

        $this->assertSame(8500, $r->amount);
        $this->assertSame($channelList->id, $r->priceListId);
    }

    #[Test]
    public function m5b_an_inactive_channel_list_falls_back_to_the_base_price_without_error(): void
    {
        // الإسناد يشترط قائمة نشطة (SalesChannel::saving)، فالحالة الواقعية: قائمة معيَّنة ثم عُطِّلت لاحقاً.
        $channelList = $this->list('channel-off', 8500);
        $this->channelList($channelList);
        DB::table('price_lists')->where('id', $channelList->id)->update(['is_active' => false]);

        $r = $this->resolve();

        $this->assertSame(10000, $r->amount);
        $this->assertSame(ResolvedCommercePrice::SOURCE_PRODUCT_DEFAULT, $r->source);
    }

    #[Test]
    public function m5b2_assigning_an_inactive_list_as_the_channel_default_is_refused(): void
    {
        $this->expectException(\DomainException::class);
        $this->channelList($this->list('never-active', 8500, active: false));
    }

    #[Test]
    public function m5c_there_is_no_date_validity_so_expired_means_inactive_only(): void
    {
        // لا أعمدة صلاحية زمنية على قوائم الأسعار: «منتهية» غير قابلة للتمثيل اليوم؛ التعطيل اليدوي هو الآلية الوحيدة.
        foreach (['valid_from', 'valid_to', 'starts_at', 'ends_at', 'expires_at'] as $column) {
            $this->assertFalse(Schema::hasColumn('price_lists', $column), "price_lists.{$column} must not exist until the owner approves date validity");
            $this->assertFalse(Schema::hasColumn('price_list_items', $column), "price_list_items.{$column} must not exist until the owner approves date validity");
        }
    }

    #[Test]
    public function m5d_the_partner_list_is_gated_by_the_pos_setting_not_by_wholesale(): void
    {
        // السلوك القائم: قائمة الشريك تتبع إعداد POS `apply_customer_price_list` (D-B2). إيقافه يُسقط قائمة الشريك للجميع.
        $partnerList = $this->list('partner', 7000);
        $partner = $this->partner($partnerList);
        $this->assertSame(7000, $this->resolve($partner)->amount);

        $this->assertTrue(PosSettings::appliesCustomerPriceList(), 'default is ON');
        $settings = $this->tenant->settings ?? [];
        $settings['sales_config']['pos']['apply_customer_price_list'] = false;
        $this->tenant->forceFill(['settings' => $settings])->save();
        app(TenantContext::class)->set($this->tenant->id);

        $this->assertSame(10000, $this->resolve($partner)->amount, 'POS toggle off ⇒ the partner list is ignored');
    }

    // ───────────── 6 · مشترٍ موقوف ─────────────

    #[Test]
    public function m6_the_resolver_has_no_notion_of_a_buyer_membership(): void
    {
        // العضوية (معتمد/موقوف) تُحكم في الوسيط قبل أي تسعير. المحلِّل يستقبل `partnerId` فقط ولا يعرف المشتري إطلاقاً،
        // فلا يمكن أن «يسرّب» سعراً لموقوف من داخله؛ الحماية في الوسيط (مُثبتة في اختبارات الدفعتين G وH).
        $parameters = array_map(fn ($p) => $p->getName(), (new \ReflectionMethod(CommercePriceResolver::class, 'resolve'))->getParameters());
        $this->assertSame(['productId', 'salesChannelId', 'partnerId', 'unitName', 'lockEligibility', 'variantId'], $parameters);
    }

    // ───────────── 7 · زائر DTC ─────────────

    #[Test]
    public function m7_a_dtc_guest_on_a_channel_without_a_list_sees_exactly_the_base_price(): void
    {
        $dtc = SalesChannel::create(['slug' => 'dtc', 'name' => 'تجزئة', 'type' => SalesChannel::TYPE_WEB]);

        $r = $this->resolver->resolve($this->product->id, $dtc->id);

        $this->assertSame(10000, $r->amount);
        $this->assertSame(ResolvedCommercePrice::SOURCE_PRODUCT_DEFAULT, $r->source);
        $this->assertNull($r->priceListId);
    }

    // ───────────── 8 · عبر المستأجرين والقنوات ─────────────

    #[Test]
    public function m8a_another_channels_list_never_prices_this_channel(): void
    {
        $other = SalesChannel::create(['slug' => 'other', 'name' => 'قناة أخرى', 'type' => SalesChannel::TYPE_WEB]);
        $other->forceFill(['default_price_list_id' => $this->list('other-channel', 5000)->id])->save();

        $this->assertSame(10000, $this->resolve()->amount, 'this channel has no list ⇒ base price, never the other channel\'s list');
        $this->assertSame(5000, $this->resolver->resolve($this->product->id, $other->id)->amount);
    }

    #[Test]
    public function m8b_a_partner_from_another_tenant_is_rejected(): void
    {
        $foreign = Tenant::create(['name' => 'أجنبي', 'slug' => 'foreign-'.uniqid(), 'vat_number' => '300000000000003', 'currency' => 'SAR']);
        app(TenantContext::class)->set($foreign->id);
        $foreignPartner = $this->partner(null);
        app(TenantContext::class)->set($this->tenant->id);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('العميل غير موجود');
        $this->resolver->resolve($this->product->id, $this->channel->id, $foreignPartner->id);
    }

    #[Test]
    public function m8c_a_channel_list_reference_that_resolves_in_another_tenant_fails_closed_never_to_the_base_price(): void
    {
        $foreign = Tenant::create(['name' => 'أجنبي2', 'slug' => 'foreign2-'.uniqid(), 'vat_number' => '300000000000003', 'currency' => 'SAR']);
        app(TenantContext::class)->set($foreign->id);
        $foreignList = PriceList::create(['name' => 'foreign-list', 'is_active' => true]);
        app(TenantContext::class)->set($this->tenant->id);

        DB::table('sales_channels')->where('id', $this->channel->id)->update(['default_price_list_id' => $foreignList->id]);

        $this->expectException(RuntimeException::class);
        $this->resolver->resolve($this->product->id, $this->channel->id);
    }

    #[Test]
    public function m8d_a_partner_list_from_another_tenant_is_never_applied(): void
    {
        $foreign = Tenant::create(['name' => 'أجنبي3', 'slug' => 'foreign3-'.uniqid(), 'vat_number' => '300000000000003', 'currency' => 'SAR']);
        app(TenantContext::class)->set($foreign->id);
        $foreignList = $this->list('foreign-partner-list', 1000);
        app(TenantContext::class)->set($this->tenant->id);

        $partner = $this->partner(null);
        DB::table('partners')->where('id', $partner->id)->update(['default_price_list_id' => $foreignList->id]);

        $r = $this->resolve($partner);

        $this->assertSame(10000, $r->amount, 'TenantScope hides the foreign list ⇒ partner has no list ⇒ base');
        $this->assertNull($r->priceListId);
    }
}
