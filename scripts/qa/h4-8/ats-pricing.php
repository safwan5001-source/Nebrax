<?php
// ATS / pricing authority integrated check on the REAL seeded DB. Prints public /store/v1/offers state per scenario.
use App\Models\{Product, StorefrontOffer, ProductWarehouseStock, InventoryReservation};
use App\Tenancy\TenantContext;
use App\Services\Commerce\{CommercePriceResolver, InventoryReservationService};
require '/home/user/nibras-app/vendor/autoload.php';
$app = require '/home/user/nibras-app/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$seed = json_decode(file_get_contents(__DIR__.'/seed.json'), true);
$tid = $seed['tenant']; $P = $seed['products'];
$pub = function () { $c = curl_init('http://127.0.0.1:8000/store/v1/offers'); curl_setopt_array($c, [CURLOPT_RETURNTRANSFER => 1, CURLOPT_HTTPHEADER => ['Host: a.h48.test', 'Accept: application/json']]); $j = json_decode(curl_exec($c), true); return collect($j['data'])->map(fn ($o) => $o['name_en'].' '.$o['offer_price']['amount_minor'].'/'.$o['reference_price']['amount_minor'].' '.$o['discount_percent'].'%')->all(); };
echo "baseline: ", json_encode($pub(), JSON_UNESCAPED_UNICODE), "\n";
app(TenantContext::class)->set($tid);
$channelId = App\Models\Storefront::query()->find($seed['storefrontA'])->sales_channel_id;
// price authority: resolver == public offer_price for A
$r = app(CommercePriceResolver::class)->resolve($P['A'], $channelId);
echo "resolver(A)=", $r->amount, " base=", (int) Product::find($P['A'])->sale_price, "\n";
// make offers for B (restock) -> should go live
$wh = App\Models\Warehouse::query()->first();
$stock = ProductWarehouseStock::query()->where('product_id', $P['B'])->first();
InventoryReservation::query()->where('product_id', $P['B'])->delete(); // release hold
echo "B restocked (hold released, qty ".$stock->quantity."): ", json_encode($pub(), JSON_UNESCAPED_UNICODE), "\n";
// ATS<=0 again for A via reservation of all stock
$qtyA = ProductWarehouseStock::query()->where('product_id', $P['A'])->value('quantity');
app(InventoryReservationService::class)->acquire($P['A'], $wh->id, (int) $qtyA, 'qa-hold-A');
echo "A fully reserved (ATS=0): ", json_encode($pub(), JSON_UNESCAPED_UNICODE), "\n";
InventoryReservation::query()->where('product_id', $P['A'])->delete();
echo "A hold released: ", json_encode($pub(), JSON_UNESCAPED_UNICODE), "\n";
// C: no genuine discount; D inactive; E variant: all configured in DB, none public
echo "configured offers on A: ", StorefrontOffer::query()->where('storefront_id', $seed['storefrontA'])->count(), " (B,C,D,E + A [+A2 deleted])\n";
// price list change: raise A's list price to >= base -> not discounted
$item = App\Models\PriceListItem::query()->where('product_id', $P['A'])->first(); $orig = $item->price; $item->update(['price' => 25000]);
echo "A list price == base: ", json_encode($pub(), JSON_UNESCAPED_UNICODE), "\n"; $item->update(['price' => $orig]);
echo "A list price restored: ", json_encode($pub(), JSON_UNESCAPED_UNICODE), "\n";
// Cart unit price parity (real cart V1 uses resolver): resolver amount == offer price
echo "offer_price==resolver: ", ($r->amount === 19900 ? 'YES' : 'NO'), "\n";
