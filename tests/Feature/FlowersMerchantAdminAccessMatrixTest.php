<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/**
 * FLOWERS-H2-13 / ADR-27 — مصفوفة وصول موحّدة لكل مسارات إدارة «الورد والهدايا» التي تستهلكها شاشات Horizon 2.
 *
 * كل مسار على حدة مُغطّى باختباره الخاص؛ هذه المصفوفة تضمن ألّا يُضاف مسار إدارة جديد بلا حارس صلاحية أو بلا عزل
 * بين المستأجرين، وأن الرفض لا يكتب شيئاً ولا يكشف وجود سجل مستأجرٍ آخر (404 غير كاشف).
 *
 * - مسارات المتجر (`storefronts/{id}/…`): `commerce.manage` قراءةً وكتابة. المحاسب والموظف لا يملكانها ⇒ 403.
 * - مسارات المنتج (`products/{id}/…`): `products.view` للقراءة و`products.manage` للكتابة.
 *
 * تشغيل: php artisan test --filter=FlowersMerchantAdminAccessMatrixTest
 */
class FlowersMerchantAdminAccessMatrixTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const STORE_BASE = '/api/commerce/workspace/storefronts/';

    private const PRODUCT_BASE = '/api/commerce/workspace/products/';

    /** @return list<array{string, string, array}> [method, suffix, body] */
    private function storeRoutes(): array
    {
        return [
            ['GET', '/gift-settings', []],
            ['PUT', '/gift-settings', ['is_enabled' => true]],
            ['GET', '/delivery-schedule', []],
            ['PUT', '/delivery-schedule/settings', ['is_enabled' => true]],
            ['PUT', '/delivery-schedule/slots', ['slots' => []]],
            ['PUT', '/delivery-schedule/blocked-dates', ['blocked_dates' => []]],
            ['GET', '/fulfillment', []],
            ['PUT', '/fulfillment', ['warehouse_id' => '00000000-0000-4000-8000-000000000000']],
            ['GET', '/vertical-setup', []],
            ['GET', '/vertical-setup/starters', []],
            ['POST', '/vertical-setup/starters', []],
        ];
    }

    /** @return list<array{string, string, array}> */
    private function productRoutes(): array
    {
        return [
            ['preparation', ['preparation_minutes' => 60]],
            ['personalization', ['fields' => []]],
            ['addons', ['addons' => []]],
            ['content', ['blocks' => []]],
        ];
    }

    /** @return array{auth: array, store: Storefront, product: Product} */
    private function tenant(string $slug): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        app(TenantContext::class)->set($auth['tenant_id']);
        $channel = SalesChannel::query()->where('slug', 'web')->first()
            ?? SalesChannel::create(['slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $store = Storefront::create(['slug' => 'main', 'name' => 'المتجر', 'sales_channel_id' => $channel->id, 'is_active' => true]);
        $product = Product::create(['name' => 'باقة', 'type' => 'good', 'unit' => 'piece', 'sale_price' => 10000, 'is_active' => true]);
        app(TenantContext::class)->forget();

        return ['auth' => $auth, 'store' => $store, 'product' => $product];
    }

    private function call2(string $token, string $method, string $url, array $body = [])
    {
        return $this->withToken($token)->json($method, $url, $body);
    }

    /** @test */
    public function store_routes_need_commerce_manage_for_every_non_owner_role_and_guests(): void
    {
        $a = $this->tenant('mx-store');
        $staff = $this->tokenForRole($a['auth']['tenant_id'], 'staff', 'staff@mx-store.test');
        $accountant = $this->tokenForRole($a['auth']['tenant_id'], 'accountant', 'acc@mx-store.test');
        $selfService = $this->tokenForRole($a['auth']['tenant_id'], 'self_service', 'ss@mx-store.test');

        foreach ($this->storeRoutes() as [$method, $suffix, $body]) {
            $url = self::STORE_BASE.$a['store']->id.$suffix;
            foreach (['staff' => $staff, 'accountant' => $accountant, 'self_service' => $selfService] as $role => $token) {
                $this->call2($token, $method, $url, $body)->assertForbidden("{$role} must not reach {$method} {$suffix}");
            }
            $this->flushHeaders();
            $this->json($method, $url, $body)->assertUnauthorized("guest must not reach {$method} {$suffix}");
        }
    }

    /** @test */
    public function store_routes_never_reveal_or_touch_a_foreign_tenants_store(): void
    {
        $a = $this->tenant('mx-iso-a');
        $b = $this->tenant('mx-iso-b');

        foreach ($this->storeRoutes() as [$method, $suffix, $body]) {
            $this->call2($a['auth']['token'], $method, self::STORE_BASE.$b['store']->id.$suffix, $body)
                ->assertNotFound("{$method} {$suffix} must answer 404 for another tenant's store");
        }
        // معرّف غير UUID لا يصل للمتحكم أصلاً.
        $this->call2($a['auth']['token'], 'GET', self::STORE_BASE.'not-a-uuid/gift-settings')->assertNotFound();
    }

    /** @test */
    public function product_routes_split_view_from_manage_and_deny_self_service_and_guests(): void
    {
        $a = $this->tenant('mx-prod');
        $staff = $this->tokenForRole($a['auth']['tenant_id'], 'staff', 'staff@mx-prod.test');
        $accountant = $this->tokenForRole($a['auth']['tenant_id'], 'accountant', 'acc@mx-prod.test');
        $selfService = $this->tokenForRole($a['auth']['tenant_id'], 'self_service', 'ss@mx-prod.test');

        foreach ($this->productRoutes() as [$section, $body]) {
            $url = self::PRODUCT_BASE.$a['product']->id.'/'.$section;

            // الموظف: قراءة فقط.
            $this->call2($staff, 'GET', $url)->assertOk();
            $this->call2($staff, 'PUT', $url, $body)->assertForbidden("staff must not write {$section}");
            // المحاسب يملك products.manage ⇒ يكتب (لا يُطلب commerce.manage على مسار المنتج).
            $this->call2($accountant, 'GET', $url)->assertOk();
            $this->call2($accountant, 'PUT', $url, $body)->assertOk();
            // الخدمة الذاتية والضيف: لا شيء.
            $this->call2($selfService, 'GET', $url)->assertForbidden();
            $this->call2($selfService, 'PUT', $url, $body)->assertForbidden();
            $this->flushHeaders();
            $this->getJson($url)->assertUnauthorized();
        }
    }

    /** @test */
    public function product_routes_never_reveal_or_touch_a_foreign_tenants_product(): void
    {
        $a = $this->tenant('mx-piso-a');
        $b = $this->tenant('mx-piso-b');

        foreach ($this->productRoutes() as [$section, $body]) {
            $url = self::PRODUCT_BASE.$b['product']->id.'/'.$section;
            $this->call2($a['auth']['token'], 'GET', $url)->assertNotFound("GET {$section} must answer 404 for another tenant's product");
            $this->call2($a['auth']['token'], 'PUT', $url, $body)->assertNotFound("PUT {$section} must answer 404 for another tenant's product");
        }

        // وما كُتب شيء على منتج المستأجر الآخر: قراءته بمالكه تُظهر الحالة الافتراضية.
        $this->call2($b['auth']['token'], 'GET', self::PRODUCT_BASE.$b['product']->id.'/personalization')->assertOk()->assertJsonPath('data.fields', []);
        $this->call2($b['auth']['token'], 'GET', self::PRODUCT_BASE.$b['product']->id.'/addons')->assertOk()->assertJsonPath('data.addons', []);
    }

    /** @test */
    public function an_addon_can_only_reference_a_product_of_the_same_tenant_and_a_rejected_save_writes_nothing(): void
    {
        $a = $this->tenant('mx-addon-a');
        $b = $this->tenant('mx-addon-b');
        $url = self::PRODUCT_BASE.$a['product']->id.'/addons';

        $this->call2($a['auth']['token'], 'PUT', $url, ['addons' => [['addon_product_id' => $b['product']->id]]])->assertStatus(422);

        $this->call2($a['auth']['token'], 'GET', $url)->assertOk()->assertJsonPath('data.addons', []);
    }

    /**
     * حارس اكتمال: أي مسار إدارة جديد تحت هذه البادئات يجب أن يدخل المصفوفة أعلاه (فيُختبر صلاحيةً وعزلاً) —
     * وإلا يفشل هذا الاختبار فلا يمرّ مسارٌ بلا حارس بصمت.
     *
     * @test
     */
    public function every_registered_admin_route_is_covered_by_the_matrix(): void
    {
        $registered = [];
        foreach (Route::getRoutes() as $route) {
            $uri = $route->uri();
            if (preg_match('#^api/commerce/workspace/storefronts/\{id\}/(gift-settings|delivery-schedule|fulfillment|vertical-setup)(/.*)?$#', $uri, $m)) {
                foreach ($route->methods() as $method) {
                    if ($method !== 'HEAD') {
                        $registered[] = $method.' '.substr($uri, strlen('api/commerce/workspace/storefronts/{id}'));
                    }
                }
            }
            if (preg_match('#^api/commerce/workspace/products/\{id\}/(preparation|personalization|addons|content)$#', $uri, $m)) {
                foreach ($route->methods() as $method) {
                    if ($method !== 'HEAD') {
                        $registered[] = $method.' product:'.$m[1];
                    }
                }
            }
        }

        $covered = [];
        foreach ($this->storeRoutes() as [$method, $suffix]) {
            $covered[] = $method.' '.$suffix;
        }
        foreach ($this->productRoutes() as [$section]) {
            $covered[] = 'GET product:'.$section;
            $covered[] = 'PUT product:'.$section;
        }
        sort($registered);
        sort($covered);

        $this->assertSame($covered, $registered, 'a Flowers admin route was added or removed without updating the access matrix');
    }
}
