<?php

namespace App\Console\Commands;

use App\Models\CreditNoteLegacyReview;
use App\Services\Accounting\CreditNoteLegacyReviewService;
use App\Tenancy\TenantContext;
use Illuminate\Console\Command;
use RuntimeException;

/**
 * AWJ-TAX-REM-02 — قرار مراجعة المالية لسطر إشعارٍ دائن تاريخي غير محسوم. يكتب صف مراجعة
 * (إلحاق فقط) ولا يعدّل أي مستند مرحَّل. مستأجرٌ واحد صريح، سببٌ ومراجِعٌ إلزاميان.
 */
final class ResolveLegacyCreditNote extends Command
{
    protected $signature = 'credit-notes:legacy-resolve
        {line : credit_note_lines.id of the unresolved legacy line}
        {--tenant= : Tenant UUID (required)}
        {--attribute-to= : invoice_lines.id (same invoice) the credit consumed}
        {--not-applicable : the credit does not consume an invoice line (no quantity)}
        {--reason= : Mandatory justification (min 10 chars)}
        {--by= : Reviewer e-mail (a user of this tenant)}';

    protected $description = 'قرار مراجعة المالية لسطر إشعار دائن تاريخي غير محسوم (AWJ-TAX-REM-02)';

    public function handle(CreditNoteLegacyReviewService $service): int
    {
        $tenantId = LegacyCreditNoteCommandSupport::tenantOrFail($this);
        if ($tenantId === null) {
            return self::INVALID;
        }

        $attributeTo = $this->option('attribute-to');
        $notApplicable = (bool) $this->option('not-applicable');
        if (($attributeTo === null) === ! $notApplicable) {
            // أحدهما بالضبط.
            $this->error('Pass exactly one of --attribute-to=<invoice line id> or --not-applicable.');

            return self::INVALID;
        }

        app(TenantContext::class)->set($tenantId);
        try {
            $review = $service->resolve(
                (string) $this->argument('line'),
                $notApplicable ? CreditNoteLegacyReview::NOT_APPLICABLE : CreditNoteLegacyReview::ATTRIBUTED,
                is_string($attributeTo) ? $attributeTo : null,
                (string) $this->option('reason'),
                (string) $this->option('by'),
            );
        } catch (RuntimeException $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        } finally {
            app(TenantContext::class)->forget();
        }

        $this->info("Recorded review {$review->id} ({$review->outcome}). No posted document was modified.");

        return self::SUCCESS;
    }
}
