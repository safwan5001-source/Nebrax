<?php

namespace Tests\Feature;

use App\Models\CommerceListing;
use App\Models\Invoice;
use App\Models\InvoiceLine;
use App\Models\Partner;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * AD-09 / S08a — ترتيب `popularity` على `GET commerce/v1/products`.
 * محسوب خادمياً من كميات الفواتير **المرحّلة** ضمن نافذة قابلة للضبط، قراءة فقط (لا قيد ولا حركة)،
 * ولا يكشف أي رقم مبيعات في الاستجابة — الترتيب وحده.
 */
class CommerceProductPopularityTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private int $seq = 0;

    /** @return array{tenant: Tenant, channel: SalesChannel, token: string, partner: string} */
    private function store(string $slug): array
    {
        $tenant = Tenant::create([
            'name' => "متجر {$slug}", 'slug' => $slug.'-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create(['slug' => 'mobile', 'name' => 'تطبيق الجوال', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true]);
        $partner = Partner::create(['type' => 'customer', 'name' => 'عميل']);
        app(TenantContext::class)->forget();
        $client = app(ApiClientKeyService::class)->createClient($tenant, 'mobile-app', true);
        $key = app(ApiClientKeyService::class)->issueKey($client, 'default', []);

        return ['tenant' => $tenant, 'channel' => $channel, 'token' => $key->plainTextToken, 'partner' => $partner->id];
    }

    private function product(array $s, string $name, bool $published = true): Product
    {
        app(TenantContext::class)->set($s['tenant']->id);
        $p = Product::create([
            'sku' => 'SKU-'.Str::random(6), 'name' => $name, 'type' => 'good', 'unit' => 'piece',
            'sale_price' => 10000, 'tax_rate' => 15, 'is_active' => true,
        ]);
        if ($published) {
            CommerceListing::create(['product_id' => $p->id, 'sales_channel_id' => $s['channel']->id, 'is_published' => true]);
        }
        app(TenantContext::class)->forget();

        return $p;
    }

    private function sell(array $s, Product $p, int $qty, string $status = 'posted', ?string $date = null, int $unitFactor = 1, ?int $num = null, ?int $den = null): void
    {
        app(TenantContext::class)->set($s['tenant']->id);
        $inv = Invoice::create([
            'number' => 'POP-'.(++$this->seq), 'partner_id' => $s['partner'], 'type' => 'sale', 'payment_type' => 'credit',
            'invoice_date' => $date ?? now()->toDateString(), 'status' => $status,
            'subtotal' => 0, 'total' => 0, 'tax_inclusive' => false,
        ]);
        InvoiceLine::create([
            'invoice_id' => $inv->id, 'product_id' => $p->id, 'quantity' => $qty, 'unit_factor' => $unitFactor,
            'quantity_numerator' => $num, 'quantity_denominator' => $den,
            'unit_price' => 10000, 'tax_rate' => 15, 'line_subtotal' => 0, 'line_discount' => 0, 'line_tax' => 0, 'line_total' => 0,
        ]);
        app(TenantContext::class)->forget();
    }

    private function names(array $s, string $sort): array
    {
        $res = $this->getJson('/commerce/v1/products?sort='.$sort, ['Authorization' => 'Bearer '.$s['token']])->assertOk();

        return collect($res->json('data'))->pluck('name')->all();
    }

    /** @test */
    public function descending_popularity_orders_by_posted_units_sold(): void
    {
        $s = $this->store('pop');
        $low = $this->product($s, 'قليل');
        $high = $this->product($s, 'كثير');
        $none = $this->product($s, 'بلا مبيعات');
        $this->sell($s, $low, 2);
        $this->sell($s, $high, 7);
        $this->sell($s, $high, 3);

        $this->assertSame(['كثير', 'قليل', 'بلا مبيعات'], $this->names($s, '-popularity'));
        $this->assertSame(['بلا مبيعات', 'قليل', 'كثير'], $this->names($s, 'popularity'));
    }

    /** @test */
    public function draft_and_cancelled_invoices_do_not_count(): void
    {
        $s = $this->store('pop-status');
        $a = $this->product($s, 'أ');
        $b = $this->product($s, 'ب');
        $this->sell($s, $a, 100, 'draft');
        $this->sell($s, $a, 100, 'cancelled');
        $this->sell($s, $b, 1);

        $this->assertSame(['ب', 'أ'], $this->names($s, '-popularity'));
    }

    /** @test */
    public function base_units_use_the_unit_factor(): void
    {
        $s = $this->store('pop-units');
        $box = $this->product($s, 'علبة');
        $piece = $this->product($s, 'حبة');
        $this->sell($s, $box, 2, 'posted', null, 12); // 24 وحدة أساس
        $this->sell($s, $piece, 10);

        $this->assertSame(['علبة', 'حبة'], $this->names($s, '-popularity'));
    }

    /** @test */
    public function rational_quantities_count_their_real_base_units_not_the_placeholder(): void
    {
        $s = $this->store('pop-rational');
        $half = $this->product($s, 'نصف عبوة');   // 1/2 عبوة × معامل 10 = 5 وحدات (السطر يخزّن quantity=1 كعنصر نائب)
        $six = $this->product($s, 'ست حبات');
        $this->sell($s, $half, 1, 'posted', null, 10, 1, 2);
        $this->sell($s, $six, 6);

        $this->assertSame(['ست حبات', 'نصف عبوة'], $this->names($s, '-popularity'));
    }

    /** @test */
    public function future_dated_invoices_do_not_count(): void
    {
        $s = $this->store('pop-future');
        $future = $this->product($s, 'مستقبلي');
        $now = $this->product($s, 'حالي');
        $this->sell($s, $future, 500, 'posted', now()->addDays(10)->toDateString());
        $this->sell($s, $now, 1);

        $this->assertSame(['حالي', 'مستقبلي'], $this->names($s, '-popularity'));
    }

    /** @test */
    public function the_window_is_configurable_per_tenant_and_old_sales_fall_out(): void
    {
        $s = $this->store('pop-window');
        $old = $this->product($s, 'قديم');
        $recent = $this->product($s, 'حديث');
        $this->sell($s, $old, 50, 'posted', now()->subDays(60)->toDateString());
        $this->sell($s, $recent, 1);

        // الافتراضي 90 يوماً ⇒ القديم يُحتسب.
        $this->assertSame(['قديم', 'حديث'], $this->names($s, '-popularity'));

        app(TenantContext::class)->set($s['tenant']->id);
        Settings::put('sales', ['popularity_window_days' => 30]);
        app(TenantContext::class)->forget();

        $this->assertSame(['حديث', 'قديم'], $this->names($s, '-popularity'));
    }

    /** @test */
    public function ties_are_deterministic_by_name_then_id(): void
    {
        $s = $this->store('pop-ties');
        foreach (['ج', 'أ', 'ب'] as $n) {
            $this->product($s, $n);
        }

        $first = $this->names($s, '-popularity');
        $this->assertSame($first, $this->names($s, '-popularity'));
        $this->assertSame(['أ', 'ب', 'ج'], $first);
    }

    /** @test */
    public function another_tenants_sales_never_influence_ranking_and_no_sales_figures_leak(): void
    {
        $a = $this->store('iso-a');
        $b = $this->store('iso-b');
        $a1 = $this->product($a, 'أول');
        $a2 = $this->product($a, 'ثاني');
        $b1 = $this->product($b, 'ب١');
        $this->sell($a, $a2, 1);
        $this->sell($b, $b1, 9999);

        $res = $this->getJson('/commerce/v1/products?sort=-popularity', ['Authorization' => 'Bearer '.$a['token']])->assertOk();
        $this->assertSame(['ثاني', 'أول'], collect($res->json('data'))->pluck('name')->all());
        $json = json_encode($res->json());
        $this->assertStringNotContainsString('ب١', $json);
        foreach ($res->json('data') as $row) {
            foreach (['popularity', 'sold', 'units_sold', 'sales_count'] as $k) {
                $this->assertArrayNotHasKey($k, $row);
            }
        }
    }

    /** @test */
    public function unpublished_products_stay_hidden_and_unknown_sorts_still_fail(): void
    {
        $s = $this->store('pop-pub');
        $hidden = $this->product($s, 'مخفي', false);
        $shown = $this->product($s, 'ظاهر');
        $this->sell($s, $hidden, 99);

        $this->assertSame(['ظاهر'], $this->names($s, '-popularity'));
        $this->getJson('/commerce/v1/products?sort=-revenue', ['Authorization' => 'Bearer '.$s['token']])->assertStatus(422);
    }

    /** @test */
    public function the_sales_setting_rejects_out_of_range_windows(): void
    {
        $token = $this->registerTenant('pop-settings', 'owner@pop.test')['token'];
        $this->withToken($token)->putJson('/api/sales-settings', ['popularity_window_days' => 3])->assertStatus(422);
        $this->withToken($token)->putJson('/api/sales-settings', ['popularity_window_days' => 1000])->assertStatus(422);
        $this->withToken($token)->putJson('/api/sales-settings', ['popularity_window_days' => 60])->assertOk();
    }
}
