<?php
use App\Models\Tenant; use App\Support\ApplicationCatalog; use App\Services\EntitlementGrantService;
use App\Support\EntitlementAccessMode; use App\Support\EntitlementSourceType; use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable; use Illuminate\Support\Facades\DB; use Illuminate\Support\Str;
// Local audit fixture only: refuse anything but a local env on the dedicated h2-audit SQLite file.
if (!app()->environment('local') || config('database.default') !== 'sqlite'
    || !str_ends_with((string) config('database.connections.sqlite.database'), 'h2-audit.sqlite') || !getenv('TENANT_ID')) {
  fwrite(STDERR, "refusing: local h2-audit.sqlite only\n"); exit(1);
}
$id=getenv('TENANT_ID');
DB::table('tenants')->where('id',$id)->update(['created_at'=>'2026-01-01 00:00:00','plan'=>'enterprise']);
app(TenantContext::class)->set($id);
$t=Tenant::findOrFail($id); $n=0;
foreach (ApplicationCatalog::all() as $k=>$a) {
  if (($a['access']??null)===ApplicationCatalog::ACCESS_COMMERCIAL && $a['maturity']===ApplicationCatalog::MATURITY_BUILT) {
    app(EntitlementGrantService::class)->grant($t,$k,EntitlementAccessMode::FULL,EntitlementSourceType::LEGACY_GRANDFATHER,CarbonImmutable::now('UTC')->subMinute(),null,'h2-audit-fixture',(string)Str::uuid()); $n++;
  }
}
echo "granted $n\n";
