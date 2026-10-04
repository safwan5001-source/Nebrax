<?php
// H4-8 deterministic integrated-QA seed — runs against the REAL nibras-app DB. Usage: php seed_h4_8.php
use App\Models\{Product, User, StorefrontOffer, StorefrontDomain};
use App\Tenancy\TenantContext;

require '/home/user/nibras-app/vendor/autoload.php';
require '/home/user/Nebrax/tests/Feature/SeedsStorefrontOffers.php';
$app = require '/home/user/nibras-app/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$s = new class { use Tests\Feature\SeedsStorefrontOffers { offerStore as public; publicTenant as public; offerProduct as public; channelPriceList as public; makeOffer as public; variantOfferProduct as public; fulfillmentWarehouse as public; stockAt as public; } };

// ── Tenant 1 (merchant under test) ─────────────────────────────────
$t = $s->publicTenant('h48');
$tid = $t->id;
app(TenantContext::class)->set($tid);
$user = User::create(['tenant_id' => $tid, 'name' => 'QA Owner', 'email' => 'qa-owner@h48.test', 'password' => 'Passw0rd!QA', 'role' => 'owner', 'is_active' => true]);
app(TenantContext::class)->forget();

$A = $s->offerStore($tid, 'a.h48.test', 'web');           // Storefront A
$B = $s->offerStore($tid, 'b.h48.test', 'web2');          // Storefront B (same tenant, sibling)
$wh = $s->fulfillmentWarehouse($tid, $A['channel']);

$pA = $s->offerProduct($tid, $A['channel'], ['name' => 'منتج أ — خصم حقيقي وبالمخزون', 'name_en' => 'Product A live', 'sale_price' => 25000, 'track_inventory' => true]);
$pB = $s->offerProduct($tid, $A['channel'], ['name' => 'منتج ب — خصم لكن نفد المخزون', 'name_en' => 'Product B out of stock', 'sale_price' => 30000, 'track_inventory' => true]);
$pC = $s->offerProduct($tid, $A['channel'], ['name' => 'منتج ج — بلا خصم حقيقي', 'name_en' => 'Product C no discount', 'sale_price' => 12000]);
$pD = $s->offerProduct($tid, $A['channel'], ['name' => 'منتج د — سيُعطَّل', 'name_en' => 'Product D unavailable', 'sale_price' => 9000]);
$pA2 = $s->offerProduct($tid, $A['channel'], ['name' => 'منتج أ٢ — خصم حقيقي وبالمخزون', 'name_en' => 'Product A2 live', 'sale_price' => 18000, 'track_inventory' => true]);
[$pE] = $s->variantOfferProduct($tid, $A['channel']);
$s->stockAt($tid, $wh, $pA, 10);
$s->stockAt($tid, $wh, $pA2, 4);
$s->stockAt($tid, $wh, $pB, 3, 3);                         // ATS = 0
$s->channelPriceList($tid, $A['channel'], [$pA2->id => 13500, $pA->id => 19900, $pB->id => 21000, $pC->id => 12000, $pD->id => 6000]);

// Pre-seeded hidden candidates (Offer A is created by the merchant through the UI).
$oB = $s->makeOffer($tid, $A['storefront'], $pB);
$oC = $s->makeOffer($tid, $A['storefront'], $pC);
$oD = $s->makeOffer($tid, $A['storefront'], $pD);
app(TenantContext::class)->set($tid);
Product::query()->whereKey($pD->id)->update(['is_active' => false]);   // deactivated after configuration
// Offer E: variant-managed — API rejects at config time, so insert directly to prove public fail-closed.
$oE = StorefrontOffer::create(['storefront_id' => $A['storefront']->id, 'product_id' => $pE->id]);
app(TenantContext::class)->forget();

// Storefront B (same tenant) — its own product + genuine offer, must never leak to A.
$whB = $s->fulfillmentWarehouse($tid, $B['channel']);
$pBB = $s->offerProduct($tid, $B['channel'], ['name' => 'منتج المتجر ب', 'name_en' => 'Storefront B product', 'sale_price' => 40000, 'track_inventory' => true]);
$s->stockAt($tid, $whB, $pBB, 5);
$s->channelPriceList($tid, $B['channel'], [$pBB->id => 30000]);
$oBB = $s->makeOffer($tid, $B['storefront'], $pBB);

// ── Tenant 2 (foreign) ─────────────────────────────────────────────
$t2 = $s->publicTenant('h48foreign');
$F = $s->offerStore($t2->id, 'foreign.h48.test', 'web');
$whF = $s->fulfillmentWarehouse($t2->id, $F['channel']);
$pF = $s->offerProduct($t2->id, $F['channel'], ['name' => 'منتج مستأجر غريب', 'name_en' => 'Foreign tenant product', 'sale_price' => 50000, 'track_inventory' => true]);
$s->stockAt($t2->id, $whF, $pF, 9);
$s->channelPriceList($t2->id, $F['channel'], [$pF->id => 25000]);
$oF = $s->makeOffer($t2->id, $F['storefront'], $pF);
// unverified domain on tenant 1 (wrong-host case)
app(TenantContext::class)->set($tid);
StorefrontDomain::create(['storefront_id' => $A['storefront']->id, 'hostname' => 'unverified.h48.test', 'type' => 'custom', 'is_active' => true, 'verification_status' => 'pending']);
app(TenantContext::class)->forget();

echo json_encode([
  'tenant' => $tid, 'email' => 'qa-owner@h48.test', 'password' => 'Passw0rd!QA',
  'storefrontA' => $A['storefront']->id, 'storefrontB' => $B['storefront']->id, 'storefrontF' => $F['storefront']->id,
  'products' => ['A' => $pA->id, 'A2' => $pA2->id, 'B' => $pB->id, 'C' => $pC->id, 'D' => $pD->id, 'E' => $pE->id, 'BB' => $pBB->id, 'F' => $pF->id],
  'offers' => ['B' => $oB->id, 'C' => $oC->id, 'D' => $oD->id, 'E' => $oE->id, 'BB' => $oBB->id, 'F' => $oF->id],
], JSON_PRETTY_PRINT), "\n";
