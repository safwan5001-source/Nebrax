<?php

namespace App\Console\Commands;

use App\Models\Tenant;
use App\Services\Accounting\PosSessionNotificationBridge;
use App\Tenancy\TenantContext;
use Illuminate\Console\Command;

class ScanPosSessionNotificationsCommand extends Command
{
    protected $signature = 'pos:scan-notifications {--tenant= : Tenant id}';
    protected $description = 'Projects actionable POS variance and handover states into the notification center';

    public function handle(PosSessionNotificationBridge $service, TenantContext $context): int
    {
        $tenants = $this->option('tenant')
            ? Tenant::whereKey($this->option('tenant'))->get()
            : Tenant::orderBy('name')->get();

        foreach ($tenants as $tenant) {
            $context->set($tenant->id);
            $result = $service->scanTenant($tenant->id);
            $this->line("{$tenant->name}: {$result['scanned']} actionable POS sessions evaluated.");
        }

        $context->forget();
        return self::SUCCESS;
    }
}
