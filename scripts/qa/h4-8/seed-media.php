<?php
use App\Models\ProductMedia; use App\Tenancy\TenantContext;
require '/home/user/nibras-app/vendor/autoload.php';
$app = require '/home/user/nibras-app/bootstrap/app.php'; $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$seed = json_decode(file_get_contents(__DIR__.'/seed.json'), true);
$png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
Storage::disk('local')->put('qa/a.png', $png);
app(TenantContext::class)->set($seed['tenant']);
ProductMedia::query()->forceCreate(['id' => (string) Str::uuid(), 'tenant_id' => $seed['tenant'], 'product_id' => $seed['products']['A'], 'disk' => 'local', 'path' => 'qa/a.png', 'original_name' => 'a.png', 'mime_type' => 'image/png', 'size' => strlen($png), 'sort_order' => 0]);
echo "media added\n";
