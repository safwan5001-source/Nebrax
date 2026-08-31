<?php

namespace App\Jobs\Accounting;

use App\Models\ZatcaSubmissionAttempt;
use App\Services\Accounting\ZatcaSubmissionDispatcher;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

/** إرسال واحد فقط؛ إعادة المحاولة تنشئ سجل محاولة جديداً ولا يعيدها العامل خفيةً. */
final class SendZatcaSubmission implements ShouldBeUnique, ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 1;
    public int $timeout = 45;
    public int $uniqueFor = 300;
    public bool $failOnTimeout = true;

    public function __construct(
        public readonly string $tenantId,
        public readonly ?string $branchId,
        public readonly string $attemptId,
    ) {}

    public function uniqueId(): string
    {
        return "zatca-submission:{$this->tenantId}:{$this->attemptId}";
    }

    public function handle(
        TenantContext $tenant,
        BranchContext $branch,
        ZatcaSubmissionDispatcher $dispatcher,
    ): void {
        $tenant->forget();
        $branch->forget();

        try {
            $tenant->set($this->tenantId);
            $branch->set($this->branchId);
            $attempt = ZatcaSubmissionAttempt::query()->whereKey($this->attemptId)->firstOrFail();
            $dispatcher->dispatch($attempt);
        } finally {
            $branch->forget();
            $tenant->forget();
        }
    }
}
