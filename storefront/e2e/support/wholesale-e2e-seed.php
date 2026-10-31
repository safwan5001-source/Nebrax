<?php

/**
 * H6 Batch L — seed for the LOCAL wholesale browser E2E.
 *
 * Run from the assembled Laravel root (`/home/user/nibras-app` locally, the CI app in CI) against a THROWAWAY
 * database only — it refuses to run unless `E2E_ALLOW_SEED=1`, the connection is SQLite, and the database file
 * lives under a path containing `e2e`. It creates a disposable tenant set through the real models/services (no raw
 * writes to accounting tables, no orders, no invoices). It prints one JSON document: hostnames, fixture ids and
 * the throwaway staff/buyer credentials the spec needs. Credentials are test-only and never leave the sandbox.
 *
 * Topology seeded
 *   tenant A  — wholesale channel WS (host wholesale.e2e.localhost), second wholesale channel WS2, retail channel DTC
 *   tenant B  — its own wholesale channel (cross-tenant probe)
 *   products  — P1 (partner 500 / channel 700 / retail 1000), P2 (channel 900 only), P3 (no wholesale price anywhere)
 *   buyers    — `suspended` (approved then suspended) and `approved-unlinked` seeded; the primary buyer registers in the browser.
 */

use App\Models\CommerceListing;
use App\Models\CustomerIdentity;
use App\Models\Partner;
use App\Models\PriceList;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Commerce\WholesaleMembershipService;
use App\Services\TenantApplicationService;
use App\Services\CustomerPartnerLinkService;
use App\Services\PriceListService;
use App\Tenancy\TenantContext;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

require getcwd().'/vendor/autoload.php';
$app = require getcwd().'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$db = (string) config('database.connections.sqlite.database');
if (getenv('E2E_ALLOW_SEED') !== '1' || config('database.default') !== 'sqlite' || ! str_contains($db, 'e2e')) {
    fwrite(STDERR, "refusing to seed: needs E2E_ALLOW_SEED=1, DB_CONNECTION=sqlite and a database path containing 'e2e' (got '{$db}')\n");
    exit(1);
}

$web = function (string $slug, string $host, bool $wholesale): SalesChannel {
    $channel = SalesChannel::create(['slug' => $slug, 'name' => $host, 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
    if ($wholesale) {
        $channel->forceFill(['wholesale_membership_enabled' => true])->save();
    }
    $storefront = Storefront::create(['slug' => 's-'.$slug, 'name' => $host, 'sales_channel_id' => $channel->id, 'is_active' => true]);
    StorefrontDomain::create([
        'storefront_id' => $storefront->id, 'hostname' => $host, 'type' => StorefrontDomain::TYPE_CUSTOM,
        'is_active' => true, 'is_primary' => true, 'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
    ]);

    return $channel;
};
$product = fn (string $name, string $nameAr): Product => Product::create([
    'name' => $nameAr, 'name_en' => $name, 'sku' => 'E2E-'.Str::upper(Str::random(6)), 'unit' => 'piece', 'sale_price' => 1000, 'is_active' => true,
]);
$list = function (string $name, array $items): PriceList {
    $l = PriceList::create(['name' => $name, 'is_active' => true]);
    foreach ($items as [$p, $price]) {
        app(PriceListService::class)->upsertItem($l, $p, ['price' => $price]);
    }

    return $l;
};
$password = 'E2e-correct-horse-9';

$out = ['password' => $password];

// ───────── tenant A ─────────
$a = Tenant::create(['name' => 'E2E Wholesale Co', 'slug' => 'e2e-a-'.Str::random(6), 'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true]);
app(TenantContext::class)->set($a->id);
$ws = $web('ws', 'wholesale.e2e.localhost', true);
$ws2 = $web('ws2', 'wholesale2.e2e.localhost', true);
$dtc = $web('dtc', 'retail.e2e.localhost', false);

$p1 = $product('Wholesale Item One', 'صنف جملة أول');
$p2 = $product('Wholesale Item Two', 'صنف جملة ثانٍ');
$p3 = $product('No Wholesale Price Item', 'صنف بلا سعر جملة');
$r1 = $product('Retail Only Item', 'صنف تجزئة');
foreach ([$ws, $ws2] as $channel) {
    foreach ([$p1, $p2, $p3] as $p) {
        CommerceListing::create(['product_id' => $p->id, 'sales_channel_id' => $channel->id, 'is_published' => true]);
    }
}
foreach ([$p1, $p2, $r1] as $p) {
    CommerceListing::create(['product_id' => $p->id, 'sales_channel_id' => $dtc->id, 'is_published' => true]);
}
$channelList = $list('e2e-wholesale-channel', [[$p1, 700], [$p2, 900]]);
$ws->update(['default_price_list_id' => $channelList->id]);
$partnerList = $list('e2e-partner', [[$p1, 500]]);
$partner = Partner::create(['name' => 'عميل جملة E2E', 'type' => 'customer', 'default_price_list_id' => $partnerList->id]);

$owner = User::create(['tenant_id' => $a->id, 'name' => 'e2e-owner', 'email' => 'owner-'.Str::random(5).'@e2e.test', 'password' => $password, 'role' => 'owner']);

// the operator step that makes the staff membership-review API reachable at all (EnsureApplicationActive:commerce.storefront)
app(TenantApplicationService::class)->enable('commerce.storefront', $owner, 'e2e seed');

$seedBuyer = function (string $tag, bool $link, ?string $finalAction) use ($a, $ws, $partner, $owner, $password): array {
    $identity = CustomerIdentity::create([
        'tenant_id' => $a->id, 'display_name' => 'E2E '.$tag, 'email' => $tag.'-'.Str::random(4).'@e2e.test', 'password' => $password,
        'email_verified_at' => now(), 'is_active' => true,
    ]);
    $svc = app(WholesaleMembershipService::class);
    $membership = $svc->apply($identity, $ws->id);
    $svc->transition($membership->id, 'approve', $owner);
    if ($link) {
        app(CustomerPartnerLinkService::class)->link($identity, $partner, $owner);
    }
    if ($finalAction) {
        $svc->transition($membership->id, $finalAction, $owner);
    }

    return ['email' => $identity->email, 'membership_id' => $membership->id, 'identity_id' => $identity->id];
};
$out['seeded_buyers'] = [
    'suspended' => $seedBuyer('suspended', true, 'suspend'),
    'approved_unlinked' => $seedBuyer('unlinked', false, null),
    'revoked_target' => $seedBuyer('revoke', true, null),
    'linked' => $seedBuyer('linked', true, null),
];
app(TenantContext::class)->forget();

// ───────── tenant B (cross-tenant probe) ─────────
$b = Tenant::create(['name' => 'E2E Other Co', 'slug' => 'e2e-b-'.Str::random(6), 'vat_number' => '300000000000004', 'currency' => 'SAR', 'is_active' => true]);
app(TenantContext::class)->set($b->id);
$wsB = $web('ws-b', 'other.e2e.localhost', true);
app(TenantContext::class)->forget();

$out += [
    'hosts' => ['ws' => 'wholesale.e2e.localhost', 'ws2' => 'wholesale2.e2e.localhost', 'dtc' => 'retail.e2e.localhost', 'other_tenant' => 'other.e2e.localhost'],
    'tenant_id' => $a->id,
    'channel_ids' => ['ws' => $ws->id, 'ws2' => $ws2->id, 'dtc' => $dtc->id],
    'products' => ['p1' => $p1->id, 'p2' => $p2->id, 'p3' => $p3->id, 'retail' => $r1->id],
    'expected_minor' => ['p1_partner' => 500, 'p1_channel' => 700, 'p1_retail' => 1000, 'p2_channel' => 900],
    'staff' => ['email' => $owner->email],
];

echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT)."\n";
