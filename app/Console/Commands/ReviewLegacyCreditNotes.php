<?php

namespace App\Console\Commands;

use App\Models\Tenant;
use App\Services\Accounting\CreditNoteLegacyReviewService;
use App\Support\Money;
use App\Tenancy\TenantContext;
use Illuminate\Console\Command;

/**
 * AWJ-TAX-REM-02 — قراءة فقط: أسطر الإشعارات الدائنة المرحَّلة القديمة غير المحسومة التي تحظر
 * العكس الإضافي على فواتيرها. نطاقه مستأجرٌ واحد صريح. للحسم: `credit-notes:legacy-resolve`.
 */
final class ReviewLegacyCreditNotes extends Command
{
    protected $signature = 'credit-notes:legacy-review
        {--tenant= : Tenant UUID (required) — exact tenant scope, never crosses tenants}
        {--json : Emit JSON instead of a table}';

    protected $description = 'قراءة فقط: أسطر إشعارات دائنة مرحَّلة قديمة تحتاج مراجعة المالية (AWJ-TAX-REM-02)';

    public function handle(CreditNoteLegacyReviewService $service): int
    {
        $tenantId = LegacyCreditNoteCommandSupport::tenantOrFail($this);
        if ($tenantId === null) {
            return self::INVALID;
        }

        app(TenantContext::class)->set($tenantId);
        try {
            $rows = $service->unresolved();
        } finally {
            app(TenantContext::class)->forget();
        }

        if ($this->option('json')) {
            $this->line(json_encode($rows, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));

            return self::SUCCESS;
        }
        if ($rows === []) {
            $this->info('No unresolved legacy credit-note lines.');

            return self::SUCCESS;
        }

        $this->table(
            ['Invoice', 'Credit note', 'Line id', 'Qty', 'Net', 'VAT', 'Description'],
            array_map(fn (array $r) => [
                $r['invoice_number'], $r['credit_note_number'], $r['credit_note_line_id'], $r['quantity'],
                Money::toRiyal($r['net']), Money::toRiyal($r['tax']), (string) $r['description'],
            ], $rows)
        );
        $this->warn(count($rows).' line(s) block further credit notes/returns on their invoices. Resolve each with credit-notes:legacy-resolve (read-only report — nothing was changed).');

        return self::SUCCESS;
    }
}
