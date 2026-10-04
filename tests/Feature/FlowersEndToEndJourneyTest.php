<?php

namespace Tests\Feature;

use App\Models\CommerceGiftSetting;
use App\Models\CommerceListing;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\ProductWarehouseStock;
use App\Models\Tenant;
use App\Models\Warehouse;
use App\Services\Commerce\CommerceCartService;
use App\Services\Commerce\CommerceDeliveryScheduleService;
use App\Services\Commerce\CommerceFacetService;
use App\Services\Commerce\FulfillmentPolicyService;
use App\Services\Commerce\ProductAddonService;
use App\Services\Commerce\ProductContentService;
use App\Services\Commerce\ProductPersonalizationService;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * FLOWERS-H16 — الرحلة الكاملة لمتجر ورد وهدايا عبر واجهة `store/v1` الفعلية: تصنيف ← محتوى ← تخصيص ← إضافات ←
 * إهداء ← جدولة ← سلة ← Checkout ← إتمام ← طلب.
 *
 * كل شريحة في الأفق اختُبرت بمفردها؛ هذا الاختبار يثبت أنها تعمل **معاً** ويلتقط الاستجابات الحقيقية كعقد
 * مشترك (`contracts/flowers-journey/*.json`) يقرؤه اختبار واجهة المتجر (storefront) بمحلّلاته الفعلية — فلا
 * ينحرف الخادم عن الواجهة بصمت. القيم المتغيّرة (معرّفات/أختام زمنية/رموز) تُستبدل بعناصر نائبة ثابتة.
 *
 * تحديث العقد عمداً: FLOWERS_WRITE_CONTRACT=1 php artisan test --filter=FlowersEndToEndJourneyTest
 *
 * الساعة مثبَّتة: الأربعاء 2026-10-07 10:00 بتوقيت الرياض (= 07:00 UTC).
 */
class FlowersEndToEndJourneyTest extends TestCase
{
    use RefreshDatabase;

    private const SECRET = 'journey-gateway-secret';

    private const HOST = 'flowers.example.test';

    private const BASE = 'http://laravel-internal.test/store/v1/';

    /** @var array<string, string> معرّف حقيقي ⇒ عنصر نائب ثابت */
    private array $ids = [];

    /** @var array<string, mixed> */
    private array $captured = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(CarbonImmutable::parse('2026-10-07 07:00:00', 'UTC'));
        config(['storefront.gateway_secret' => self::SECRET]);
    }

    private function headers(): array
    {
        return ['X-Storefront-Forwarded-Host' => self::HOST, 'X-Storefront-Gateway-Secret' => self::SECRET];
    }

    private function api(string $method, string $path, ?array $body = null, ?string $cart = null): TestResponse
    {
        $test = $this->withHeaders($this->headers())->withCredentials();
        if ($cart !== null) {
            $test = $test->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, $cart);
        }

        return $test->json($method, self::BASE.$path, $body ?? []);
    }

    private function capture(string $name, TestResponse $response): TestResponse
    {
        $this->captured[$name] = $response->json();

        return $response;
    }

    /** يبني متجراً + بيانات الأفق كاملة ويعيد معرّفات المنتجات. */
    private function seedFlowersStore(): array
    {
        $tenant = Tenant::create([
            'name' => 'ورد الندى', 'slug' => 'journey-'.Str::random(8),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);

        $channel = SalesChannel::create(['slug' => 'web', 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $storefront = Storefront::create(['slug' => 'main', 'name' => 'ورد الندى', 'sales_channel_id' => $channel->id, 'is_active' => true]);
        StorefrontDomain::create([
            'storefront_id' => $storefront->id, 'hostname' => self::HOST, 'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_active' => true, 'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);

        $mk = function (string $name, int $price, string $sku) use ($channel): Product {
            $p = Product::create(['name' => $name, 'sku' => $sku, 'unit' => 'piece', 'sale_price' => $price, 'is_active' => true]);
            CommerceListing::create(['product_id' => $p->id, 'sales_channel_id' => $channel->id, 'is_published' => true]);

            return $p;
        };
        $bouquet = $mk('باقة جوري', 24000, 'JOURNEY-BOUQUET');
        $chocolate = $mk('علبة شوكولاتة', 7000, 'JOURNEY-CHOCOLATE');
        $balloon = $mk('بالون', 1500, 'JOURNEY-BALLOON');

        // مخزن التنفيذ والمخزون: بدونهما لا وعد «يصل اليوم» (ATS) ولا حجز عند الإتمام.
        $warehouse = Warehouse::create(['name' => 'مخزن الورد', 'code' => 'J-W1', 'is_default' => true]);
        app(FulfillmentPolicyService::class)->setFixedWarehouse($channel->id, $warehouse->id);
        foreach ([$bouquet, $chocolate, $balloon] as $stocked) {
            ProductWarehouseStock::create(['product_id' => $stocked->id, 'warehouse_id' => $warehouse->id, 'quantity' => 50]);
        }

        // H2 — تصنيف المناسبات والمُهدى إليهم، ومنتج واحد مسنَد.
        $facets = app(CommerceFacetService::class);
        $occasion = $facets->createFacet(['key' => 'occasion', 'system_key' => 'occasion', 'name' => 'المناسبة', 'name_en' => 'Occasion']);
        $birthday = $facets->createValue($occasion['id'], ['slug' => 'birthday', 'name' => 'عيد ميلاد', 'name_en' => 'Birthday']);
        $facets->createValue($occasion['id'], ['slug' => 'wedding', 'name' => 'زفاف', 'name_en' => 'Wedding']);
        $recipient = $facets->createFacet(['key' => 'recipient', 'system_key' => 'recipient', 'name' => 'المُهدى إليه', 'name_en' => 'Recipient']);
        $forHer = $facets->createValue($recipient['id'], ['slug' => 'for-her', 'name' => 'لها', 'name_en' => 'For her']);
        $facets->replaceAssignments($bouquet, [$birthday['id'], $forHer['id']]);

        // H5 — محتوى مهيكل، H4 — تخصيص، H6 — إضافات.
        app(ProductContentService::class)->replace($bouquet, [
            ['block_type' => 'care', 'body' => "ضعها في ماء بارد.\nقصّ الساق بزاوية.", 'body_en' => 'Keep in cool water.'],
            ['block_type' => 'included_items', 'body' => '١٢ وردة جوري', 'body_en' => '12 roses'],
        ]);
        app(ProductPersonalizationService::class)->replaceDefinitions($bouquet, [
            ['key' => 'card-name', 'type' => 'text', 'label' => 'الاسم على البطاقة', 'label_en' => 'Name on the card', 'is_required' => true, 'max_length' => 20],
            ['key' => 'wrap', 'type' => 'select', 'label' => 'التغليف', 'label_en' => 'Wrapping', 'options' => [
                ['value_key' => 'kraft', 'label' => 'كرافت', 'label_en' => 'Kraft'],
                ['value_key' => 'satin', 'label' => 'ساتان', 'label_en' => 'Satin'],
            ]],
        ]);
        app(ProductAddonService::class)->replace($bouquet, [
            ['addon_product_id' => $chocolate->id, 'max_quantity' => 3],
            ['addon_product_id' => $balloon->id, 'max_quantity' => 1],
        ]);

        // H3 — سياسة الإهداء، H7 — جدولة التسليم.
        CommerceGiftSetting::create(['sales_channel_id' => $channel->id, 'is_enabled' => true]);
        $schedule = app(CommerceDeliveryScheduleService::class);
        $schedule->saveSettings($channel->id, ['is_enabled' => true, 'is_required' => false]);
        $schedule->replaceSlots($channel->id, [
            ['method' => 'delivery', 'label' => 'مساءً', 'label_en' => 'Evening', 'start_time' => '16:00', 'end_time' => '20:00'],
            ['method' => 'delivery', 'label' => 'ليلاً', 'label_en' => 'Night', 'start_time' => '20:00', 'end_time' => '23:00'],
        ]);
        app(TenantContext::class)->forget();

        return compact('bouquet', 'chocolate', 'balloon');
    }

    /** @test */
    public function the_whole_flowers_journey_works_through_the_real_store_api(): void
    {
        $p = $this->seedFlowersStore();
        $bouquet = $p['bouquet'];

        // اكتشاف: القائمة بقيمها ومتاحة للتصفية، والتفصيل بكتلته.
        $list = $this->capture('01-product-list', $this->api('GET', 'products?per_page=10'))->assertOk();
        $this->assertNotEmpty($list->json('meta'));
        $detail = $this->capture('02-product-detail', $this->api('GET', 'products/'.$bouquet->id))->assertOk();
        $product = $detail->json('data.product') ?? $detail->json('data');
        $this->assertSame(['card-name', 'wrap'], array_column($product['personalization']['fields'] ?? [], 'key'));
        $this->assertNotEmpty($product['content_blocks'] ?? []);
        $this->assertCount(2, $product['addons'] ?? []);
        // مخزون + نافذة مساء اليوم (بعد الآن 10:00 بتوقيت الرياض) ⇒ وعد «يصل اليوم» مشتقّ لا مخزَّن.
        $this->assertTrue($product['delivery_promise']['deliverable']);
        $this->assertTrue($product['delivery_promise']['same_day']);
        $this->assertSame('2026-10-07', $product['delivery_promise']['earliest']['date']);
        $this->assertTrue($product['in_stock']);

        $this->capture('03-delivery-schedule', $this->api('GET', 'delivery-schedule?method=delivery'))->assertOk();

        // السلة: تخصيص + إضافات؛ السعر من الخادم.
        $chocolateLine = collect($product['addons'])->firstWhere('product_id', $p['chocolate']->id);
        $added = $this->capture('04-cart-add', $this->api('POST', 'cart/items', [
            'product_id' => $bouquet->id, 'quantity' => 1, 'unit_key' => 'base',
            'personalization' => ['card-name' => 'ريم', 'wrap' => 'satin'],
            'addons' => [['product_id' => $p['chocolate']->id, 'quantity' => 2]],
        ]))->assertCreated();
        $this->assertNotNull($chocolateLine);
        $cart = $added->getCookie(CommerceCartService::COOKIE_NAME, false)->getValue();
        $this->capture('05-cart', $this->api('GET', 'cart', null, $cart))->assertOk();

        // Checkout: جهة اتصال ← عنوان ← توصيل ← موعد ← إهداء.
        $this->capture('06-checkout-created', $this->api('POST', 'checkout', [], $cart))->assertCreated();
        $this->api('PATCH', 'checkout/contact', ['name' => 'سالم الأحمدي', 'phone' => '0501234567', 'email' => 'salem@example.com'], $cart)->assertOk();
        $this->api('PATCH', 'checkout/address', ['country' => 'SA', 'city' => 'الدمام', 'district' => 'الشاطئ', 'street' => 'شارع الملك فهد', 'postal_code' => '31411'], $cart)->assertOk();
        $this->api('PATCH', 'checkout/delivery', ['method' => 'standard'], $cart)->assertOk();

        $options = $this->capture('07-delivery-schedule-for-city', $this->api('GET', 'delivery-schedule?method=delivery&city='.urlencode('الدمام')))->assertOk();
        $date = $options->json('data.dates.1.date');
        $slot = $options->json('data.dates.1.slots.0.id');
        $this->assertNotNull($slot);

        $this->capture('08-checkout-schedule', $this->api('PATCH', 'checkout/schedule', ['date' => $date, 'slot_id' => $slot], $cart))->assertOk();
        $this->capture('09-checkout-gift', $this->api('PATCH', 'checkout/gift', [
            'is_gift' => true, 'recipient_name' => 'ريم الحربي', 'recipient_phone' => '0555550101',
            'sender_name' => 'سالم', 'hide_sender' => false, 'message' => "كل عام وأنتِ بخير\nمع محبتي",
        ], $cart))->assertOk();

        $checkout = $this->capture('10-checkout', $this->api('GET', 'checkout', null, $cart))->assertOk();
        $this->assertTrue($checkout->json('data.checkout.gift_options.enabled') ?? $checkout->json('data.gift_options.enabled'));

        $done = $this->capture('11-order', $this->withHeaders($this->headers() + ['Idempotency-Key' => 'journey-key-0001'])
            ->withCredentials()->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, $cart)
            ->postJson(self::BASE.'checkout/complete', []))->assertCreated();

        $order = $done->json('data.order');
        $this->assertSame('ريم الحربي', $order['gift']['recipient_name']);
        $this->assertSame($date, $order['schedule']['date']);
        // سطر الباقة بتخصيصه وإضافة الشوكولاتة تحته بسعرها من الخادم: 24000 + 2×7000.
        $this->assertSame(38000, $order['total']['amount_minor']);

        $this->assertMatchesContract();
    }

    // ── العقد المشترك ───────────────────────────────────────────────────

    private function contractDir(): string
    {
        return base_path('contracts/flowers-journey');
    }

    /** يستبدل المعرّفات (UUID) بمعرّفات نائبة صالحة الشكل بترتيب الظهور، فيبقى العقد ثابتاً بين التشغيلات. */
    private function normalize(mixed $value): mixed
    {
        if (is_array($value)) {
            return array_map(fn ($v) => $this->normalize($v), $value);
        }
        if (is_string($value) && preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $value) === 1) {
            // بصيغة UUID صالحة (الواجهة تتحقق من شكل المعرّف) لكن في نطاق نائب ثابت لا يتطابق مع أي معرّف حقيقي.
            return $this->ids[$value] ??= sprintf('00000000-0000-4000-8000-%012d', count($this->ids) + 1);
        }

        return $value;
    }

    private function assertMatchesContract(): void
    {
        $write = getenv('FLOWERS_WRITE_CONTRACT') === '1';
        if ($write && ! is_dir($this->contractDir())) {
            mkdir($this->contractDir(), 0777, true);
        }

        foreach ($this->captured as $name => $payload) {
            $normalized = $this->normalize($payload);
            $file = $this->contractDir().'/'.$name.'.json';

            if ($write) {
                file_put_contents($file, json_encode($normalized, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT)."\n");

                continue;
            }

            $this->assertFileExists($file, "عقد الرحلة «{$name}» غير موجود — شغّل الاختبار مع FLOWERS_WRITE_CONTRACT=1 وراجع الفرق.");
            $this->assertEquals(
                json_decode((string) file_get_contents($file), true),
                json_decode(json_encode($normalized), true),
                "استجابة «{$name}» انحرفت عن العقد المشترك مع واجهة المتجر — إن كان التغيير مقصوداً حدّث العقد ومحلّلات الواجهة معاً.",
            );
        }
    }
}
