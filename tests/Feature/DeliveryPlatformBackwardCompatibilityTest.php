<?php

namespace Tests\Feature;

use App\Models\JournalEntry;
use App\Models\Payment;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\Tenant;
use App\Services\Commerce\MobileSalesChannelResolver;
use App\Services\Commerce\StorefrontProvisioningService;
use App\Services\DeliveryPlatformConfigService;
use App\Support\DeliveryPlatformCatalog;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use RuntimeException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Tests\TestCase;

/**
 * DLV-FOUNDATION-1 — التوافق الرجعي: وجود قنوات/ملفات التوصيل لا يغيّر Commerce web/mobile،
 * ولا POS الحالي (نقد/بطاقة/متعدد)، ولا قيوده، ولا إغلاق الجلسة.
 *
 * تشغيل: php artisan test --filter=DeliveryPlatformBackwardCompatibilityTest
 */
class DeliveryPlatformBackwardCompatibilityTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function configureAllPlatforms(string $tenantId, string $mode = 'platform_collected'): void
    {
        app(TenantContext::class)->set($tenantId);
        foreach (DeliveryPlatformCatalog::keys() as $key) {
            app(DeliveryPlatformConfigService::class)->create(['platform_key' => $key, 'collection_mode' => $mode]);
        }
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function delivery_channels_change_no_existing_channel_type_count_and_add_only_external_channels(): void
    {
        $tenant = Tenant::create(['name' => 'م', 'slug' => 'dlv-bc-counts', 'vat_number' => '300000000000003', 'currency' => 'SAR']);
        app(TenantContext::class)->set($tenant->id);
        SalesChannel::create(['slug' => 'web', 'name' => 'web', 'type' => SalesChannel::TYPE_WEB]);
        SalesChannel::create(['slug' => 'mobile', 'name' => 'mobile', 'type' => SalesChannel::TYPE_MOBILE]);
        SalesChannel::create(['slug' => 'pos', 'name' => 'pos', 'type' => SalesChannel::TYPE_POS]);
        $count = fn (string $type) => SalesChannel::query()->where('type', $type)->count();
        $before = [$count('web'), $count('mobile'), $count('pos'), $count('external')];

        $this->configureAllPlatforms($tenant->id);

        app(TenantContext::class)->set($tenant->id);
        $this->assertSame($before[0], $count('web'));
        $this->assertSame($before[1], $count('mobile'));
        $this->assertSame($before[2], $count('pos'));
        $this->assertSame($before[3] + 6, $count('external'));
        $this->assertSame(1, SalesChannel::query()->where('slug', 'web')->count());
    }

    /** @test */
    public function web_storefront_provisioning_is_unchanged_when_delivery_channels_exist(): void
    {
        config(['storefront.managed_base_domain' => 'store.awjdev.xyz']);
        $tenant = Tenant::create(['name' => 'متجر', 'slug' => 'dlv-bc-store', 'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true]);
        $this->configureAllPlatforms($tenant->id);

        app(TenantContext::class)->set($tenant->id);
        $result = app(StorefrontProvisioningService::class)->provisionFirstStorefrontForCurrentTenant();

        $web = SalesChannel::query()->where('type', SalesChannel::TYPE_WEB)->where('is_active', true)->get();
        $this->assertCount(1, $web);
        $this->assertSame('web', $web->first()->slug);
        $this->assertSame($web->first()->id, $result['sales_channel_id']);
        $this->assertSame(6, SalesChannel::query()->where('type', SalesChannel::TYPE_EXTERNAL)->count());
    }

    /** @test */
    public function a_storefront_still_refuses_a_delivery_channel(): void
    {
        $tenant = Tenant::create(['name' => 'م', 'slug' => 'dlv-bc-sf', 'vat_number' => '300000000000003', 'currency' => 'SAR']);
        $this->configureAllPlatforms($tenant->id);
        app(TenantContext::class)->set($tenant->id);
        $delivery = SalesChannel::query()->where('type', SalesChannel::TYPE_EXTERNAL)->firstOrFail();

        $this->expectException(RuntimeException::class);
        Storefront::create(['sales_channel_id' => $delivery->id, 'slug' => 'store', 'name' => 'متجر']);
    }

    /** @test */
    public function the_mobile_channel_resolver_fails_closed_on_a_delivery_channel(): void
    {
        $tenant = Tenant::create(['name' => 'م', 'slug' => 'dlv-bc-mobile', 'vat_number' => '300000000000003', 'currency' => 'SAR']);
        $this->configureAllPlatforms($tenant->id);
        app(TenantContext::class)->set($tenant->id);
        $delivery = SalesChannel::query()->where('type', SalesChannel::TYPE_EXTERNAL)->firstOrFail();
        $mobile = SalesChannel::create(['slug' => 'mobile', 'name' => 'mobile', 'type' => SalesChannel::TYPE_MOBILE]);

        $resolver = app(MobileSalesChannelResolver::class);
        try {
            $resolver->resolve($tenant->id, $delivery->id);
            $this->fail('delivery channel must not resolve as mobile');
        } catch (NotFoundHttpException) {
        }

        // والقناة الجوال الحقيقية تُحلّ كما كانت.
        $this->assertSame($mobile->id, $resolver->resolve($tenant->id, $mobile->id)->id);
    }

    /**
     * @return array{owner:string, tenant:string, branch:string}
     */
    private function posTenant(string $slug): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        app(TenantContext::class)->set($auth['tenant_id']);
        $branch = $this->withToken($auth['token'])->getJson('/api/branches')->assertOk()['data'][0]['id'];

        return ['owner' => $auth['token'], 'tenant' => $auth['tenant_id'], 'branch' => $branch];
    }

    /**
     * يمرّ بدورة POS كاملة (جلسة → بيع نقدي → معاينة إغلاق) ويعيد بصمةً قابلة للمقارنة.
     *
     * @return array<string, mixed>
     */
    private function posCycleFingerprint(array $t, string $tag): array
    {
        $h = ['X-Branch-Id' => $t['branch']];
        $token = $t['owner'];
        $customer = $this->withToken($token)->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])->assertCreated()['data']['id'];
        $warehouse = $this->withToken($token)->withHeaders($h)->postJson('/api/warehouses', [
            'name' => 'مخزن', 'code' => "W-{$tag}", 'branch_id' => $t['branch'], 'is_active' => true,
        ])->assertCreated()['data'];
        $device = $this->withToken($token)->withHeaders($h)->postJson('/api/pos-devices', [
            'name' => 'كاشير', 'code' => "D-{$tag}", 'warehouse_id' => $warehouse['id'], 'is_active' => true,
        ])->assertCreated()['data'];
        $session = $this->withToken($token)->withHeaders($h)->postJson('/api/pos-sessions/open', [
            'opening_balance' => 10000, 'pos_device_id' => $device['id'],
        ])->assertCreated()['data'];

        $invoice = $this->withToken($token)->withHeaders($h)->postJson('/api/pos/checkout', [
            'idempotency_key' => (string) Str::uuid(),
            'partner_id' => $customer,
            'pos_session_id' => $session['id'],
            'warehouse_id' => $warehouse['id'],
            'items' => [['description' => 'صنف', 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
            'tenders' => ['cash' => 11500, 'card' => 0, 'transfer' => 0, 'credit' => 0],
        ])->assertCreated()['data'];

        app(TenantContext::class)->set($t['tenant']);
        $lines = JournalEntry::query()->with('lines.account')->get()
            ->flatMap(fn ($e) => $e->lines->map(fn ($l) => [$l->account->code, (int) $l->debit, (int) $l->credit]))
            ->sortBy(fn ($row) => implode('|', $row))->values()->all();
        $payments = Payment::query()->get()->map(fn ($p) => [$p->method, $p->payment_method_name, (int) $p->amount, $p->status])->all();

        $preview = $this->withToken($token)->withHeaders($h)->getJson("/api/pos-sessions/{$session['id']}/closing-preview")
            ->assertOk()->json();

        return [
            'total' => $invoice['total'] ?? null,
            'payment_status' => $invoice['payment_status'] ?? null,
            'lines' => $lines,
            'payments' => $payments,
            'preview' => $preview,
        ];
    }

    /** @test */
    public function a_pos_cash_cycle_is_identical_with_and_without_delivery_configuration_even_when_platform_collected(): void
    {
        $plain = $this->posTenant('dlv-bc-plain');
        $configured = $this->posTenant('dlv-bc-configured');
        $this->configureAllPlatforms($configured['tenant'], 'platform_collected');

        $a = $this->posCycleFingerprint($plain, 'A');
        $b = $this->posCycleFingerprint($configured, 'B');

        $this->assertNotEmpty($a['lines']);
        $this->assertSame($a['lines'], $b['lines'], 'journal lines must be identical');
        $this->assertSame($a['payments'], $b['payments'], 'payments must be identical');
        $this->assertSame($a['total'], $b['total']);
        $this->assertSame($a['payment_status'], $b['payment_status']);
        $this->assertSame($this->scrub($a['preview']), $this->scrub($b['preview']), 'close preview must be identical');
    }

    /** يحذف المعرّفات/الطوابع/الأرقام المتغيّرة بين المستأجرين ويُبقي الأرقام المحاسبية. */
    private function scrub(mixed $value): mixed
    {
        if (! is_array($value)) {
            return is_string($value) && (Str::isUuid($value) || preg_match('/^\d{4}-\d{2}-\d{2}/', $value)) ? '*' : $value;
        }
        $out = [];
        foreach ($value as $k => $v) {
            if (in_array($k, ['id', 'number', 'session_number', 'created_at', 'updated_at', 'opened_at', 'name', 'code'], true)) {
                continue;
            }
            $out[$k] = $this->scrub($v);
        }

        return $out;
    }
}
