<?php

namespace App\Console\Commands;

use App\Models\Tenant;
use App\Services\Reporting\ReturnVatDiscrepancyReport;
use App\Support\Money;
use App\Tenancy\TenantContext;
use Illuminate\Console\Command;

/**
 * AWJ-TAX-REM-01 — تقرير قراءة فقط لمرتجعات مرحَّلة تخالف سطر مصدرها.
 * لا يكتب ولا يُصحّح ولا ينشئ قيداً؛ نطاقه مستأجرٌ واحد صريح لا يعبر المستأجرين.
 */
final class ReportReturnVatDiscrepancies extends Command
{
    protected $signature = 'returns:vat-discrepancies
        {--tenant= : Tenant UUID (required) — exact tenant scope, never crosses tenants}
        {--json : Emit JSON instead of a table}';

    protected $description = 'قراءة فقط: مرتجعات مرحَّلة بأساس/ضريبة تخالف ما يشتقه سطر مصدرها (AWJ-TAX-REM-01)';

    public function handle(ReturnVatDiscrepancyReport $report): int
    {
        $tenantId = $this->option('tenant');
        if (! is_string($tenantId) || ! preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $tenantId)) {
            $this->error('The --tenant option must be a UUID.');

            return self::INVALID;
        }
        if (Tenant::query()->find($tenantId) === null) {
            $this->error('Tenant not found.');

            return self::FAILURE;
        }

        app(TenantContext::class)->set($tenantId);
        try {
            $rows = $report->forCurrentTenant();
        } finally {
            app(TenantContext::class)->forget();
        }

        if ($this->option('json')) {
            $this->line(json_encode($rows, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));

            return self::SUCCESS;
        }

        if ($rows === []) {
            $this->info('No discrepancies found.');

            return self::SUCCESS;
        }

        $this->table(
            ['Return', 'Type', 'Source', 'Date', 'Recorded VAT', 'Expected VAT', 'VAT Δ', 'Total Δ'],
            array_map(fn (array $r) => [
                $r['return_number'], $r['type'], $r['source_number'], $r['return_date'],
                Money::toRiyal($r['recorded_tax']), Money::toRiyal($r['expected_tax']),
                Money::toRiyal($r['tax_delta']), Money::toRiyal($r['total_delta']),
            ], $rows)
        );
        $this->warn(count($rows).' return(s) differ from what their source line implies. Read-only report — nothing was changed.');

        return self::SUCCESS;
    }
}
