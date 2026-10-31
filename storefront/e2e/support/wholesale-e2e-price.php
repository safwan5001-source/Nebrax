<?php

/**
 * H6 Quick Order — change one price-list entry in the THROWAWAY E2E database only, to simulate "the approved price
 * disappeared between review and submit". Same guard as the seed (needs E2E_ALLOW_SEED=1, SQLite, a path containing "e2e").
 *
 *   php wholesale-e2e-price.php <sku> none      remove the entry
 *   php wholesale-e2e-price.php <sku> <minor>   set the entry (minor units)
 *
 * The SKU is a product's or a variant's; the entry is changed in the list named `e2e-ws3`.
 */

use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;

require getcwd().'/vendor/autoload.php';
$app = require getcwd().'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$db = (string) config('database.connections.sqlite.database');
if (getenv('E2E_ALLOW_SEED') !== '1' || config('database.default') !== 'sqlite' || ! str_contains($db, 'e2e') || empty($argv[1]) || empty($argv[2])) {
    fwrite(STDERR, "refusing: needs E2E_ALLOW_SEED=1, a throwaway sqlite path containing 'e2e', a sku and a price|none\n");
    exit(1);
}

$list = DB::table('price_lists')->where('name', 'e2e-ws3')->first();
if (! $list) {
    fwrite(STDERR, "no e2e-ws3 list\n");
    exit(1);
}
$variant = DB::table('product_variants')->where('sku', $argv[1])->first();
$product = $variant ? DB::table('products')->where('id', $variant->product_id)->first() : DB::table('products')->where('sku', $argv[1])->first();
if (! $product) {
    fwrite(STDERR, "unknown sku\n");
    exit(1);
}

$query = DB::table('price_list_items')->where('price_list_id', $list->id)->where('product_id', $product->id)
    ->where('product_variant_id', $variant?->id);
if ($argv[2] === 'none') {
    $touched = $query->delete();
} else {
    $touched = $query->update(['price' => (int) $argv[2]]);
}

echo json_encode(['changed' => $touched])."\n";
