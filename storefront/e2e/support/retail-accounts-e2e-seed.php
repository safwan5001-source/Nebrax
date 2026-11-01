<?php

/**
 * B2C-ACCOUNTS — seed for the LOCAL retail-accounts browser E2E.
 *
 * Run from the assembled Laravel root against a THROWAWAY database only — it refuses to run unless `E2E_ALLOW_SEED=1`, the
 * connection is SQLite and the database file lives under a path containing `e2e`. Creates one disposable tenant through the real
 * models (no raw writes to accounting tables, no orders, no invoices):
 *   - `shop.e2e.localhost`   web channel with retail customer accounts ON, a small published catalogue
 *   - `closed.e2e.localhost` web channel with accounts OFF (the "accounts unavailable" host)
 * Prints one JSON document with hostnames, fixture ids and the throwaway shopper password.
 */

use App\Models\CommerceListing;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Str;
use App\Tenancy\TenantContext;

require getcwd().'/vendor/autoload.php';
$app = require getcwd().'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$db = (string) config('database.connections.sqlite.database');
if (getenv('E2E_ALLOW_SEED') !== '1' || config('database.default') !== 'sqlite' || ! str_contains($db, 'e2e')) {
    fwrite(STDERR, "refusing to seed: needs E2E_ALLOW_SEED=1, DB_CONNECTION=sqlite and a database path containing 'e2e' (got '{$db}')\n");
    exit(1);
}

$web = function (string $slug, string $host, bool $accounts): SalesChannel {
    $channel = SalesChannel::create(['slug' => $slug, 'name' => $host, 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
    if ($accounts) {
        $channel->forceFill(['customer_accounts_enabled' => true])->save();
    }
    $storefront = Storefront::create(['slug' => 's-'.$slug, 'name' => $host, 'sales_channel_id' => $channel->id, 'is_active' => true]);
    StorefrontDomain::create([
        'storefront_id' => $storefront->id, 'hostname' => $host, 'type' => StorefrontDomain::TYPE_CUSTOM,
        'is_active' => true, 'is_primary' => true, 'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
    ]);

    return $channel;
};

$tenant = Tenant::create(['name' => 'E2E Flowers', 'slug' => 'e2e-r-'.Str::random(6), 'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true]);
app(TenantContext::class)->set($tenant->id);
$shop = $web('shop', 'shop.e2e.localhost', true);
$closed = $web('closed', 'closed.e2e.localhost', false);

$product = Product::create(['name' => 'باقة ورد', 'name_en' => 'Rose Bouquet', 'sku' => 'E2E-'.Str::upper(Str::random(6)), 'unit' => 'piece', 'sale_price' => 15000, 'is_active' => true]);
foreach ([$shop, $closed] as $channel) {
    CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => true]);
}

echo json_encode([
    'password' => 'E2e-correct-horse-9',
    'hosts' => ['shop' => 'shop.e2e.localhost', 'closed' => 'closed.e2e.localhost'],
    'tenant_id' => $tenant->id,
    'channel_ids' => ['shop' => $shop->id, 'closed' => $closed->id],
    'product_id' => $product->id,
], JSON_PRETTY_PRINT)."\n";
