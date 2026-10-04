<?php
// CUST-H4-8b — visual-QA variant of seed-media.php: attaches a visibly
// distinct checkerboard PNG (not the 1x1 pixel used for the assertion-only
// run) so screenshots actually show something to the human eye.
use App\Models\ProductMedia; use App\Tenancy\TenantContext;
require '/home/user/nibras-app/vendor/autoload.php';
$app = require '/home/user/nibras-app/bootstrap/app.php'; $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$seed = json_decode(file_get_contents(__DIR__.'/seed.json'), true);
$png = file_get_contents(__DIR__.'/checker.png');
Storage::disk('local')->put('qa/a.png', $png);
app(TenantContext::class)->set($seed['tenant']);
ProductMedia::query()->forceCreate(['id' => (string) Str::uuid(), 'tenant_id' => $seed['tenant'], 'product_id' => $seed['products']['A'], 'disk' => 'local', 'path' => 'qa/a.png', 'original_name' => 'a.png', 'mime_type' => 'image/png', 'size' => strlen($png), 'sort_order' => 0]);
echo "visible media added\n";
