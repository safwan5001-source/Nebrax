<?php

namespace App\Console\Commands;

use App\Models\Tenant;
use App\Services\Accounting\ReceivablesNotificationService;
use App\Tenancy\TenantContext;
use Illuminate\Console\Command;

class ScanReceivablesNotificationsCommand extends Command
{
    protected $signature = 'receivables:scan-notifications {--tenant= : Tenant id}';
    protected $description = 'Scans posted sales receivables for due-soon, due-today and overdue notifications without financial mutation';

    public function handle(ReceivablesNotificationService $service, TenantContext $context): int
    {
        $tenants = $this->option('tenant')
            ? Tenant::whereKey($this->option('tenant'))->get()
            : Tenant::orderBy('name')->get();

        foreach ($tenants as $tenant) {
            $context->set($tenant->id);
            $result = $service->scanTenant($tenant->id);
            $this->line("{$tenant->name}: {$result['scanned']} receivables scanned, {$result['notified']} deliveries evaluated.");
        }

        $context->forget();
        return self::SUCCESS;
    }
}
