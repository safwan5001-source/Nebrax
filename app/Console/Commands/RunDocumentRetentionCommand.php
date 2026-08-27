<?php

namespace App\Console\Commands;

use App\Services\DocumentCenter\DocumentRetentionPolicyService;
use App\Services\DocumentCenter\DocumentRetentionRunner;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

final class RunDocumentRetentionCommand extends Command
{
    protected $signature = 'documents:retention-run
        {--cutoff= : ISO-8601/date cutoff; defaults to now UTC}
        {--limit=100 : Maximum files to inspect (1-500)}
        {--after-file-id= : Resume after this safe internal file UUID}
        {--apply : Execute governed object deletion; omitted means dry-run}';

    protected $description = 'Plan or execute a bounded, governed Document Center retention run.';

    public function handle(DocumentRetentionPolicyService $policies, DocumentRetentionRunner $runner): int
    {
        $cutoff = $this->option('cutoff');
        try {
            $cutoffAt = DocumentRetentionRunner::cutoff($cutoff === null ? null : (string) $cutoff);
        } catch (\Throwable) {
            $this->error('cutoff must be a valid ISO-8601 date/time.');

            return self::INVALID;
        }
        $limit = (int) $this->option('limit');
        if ($limit < 1 || $limit > DocumentRetentionRunner::MAX_LIMIT) {
            $this->error('limit must be between 1 and '.DocumentRetentionRunner::MAX_LIMIT.'.');

            return self::INVALID;
        }
        $effective = $policies->effective();
        if (! $effective['enabled']) {
            $this->error('The governed retention policy is disabled.');

            return self::FAILURE;
        }
        $policy = $effective['policy'] ?? $policies->update($effective['retention_days'], true, null);

        try {
            $afterFileId = $this->option('after-file-id');
            if ($afterFileId !== null && ! Str::isUuid((string) $afterFileId)) {
                $this->error('after-file-id must be a UUID.');

                return self::INVALID;
            }
            $result = $runner->run($policy, ! (bool) $this->option('apply'), $cutoffAt, $limit, null, $afterFileId);
        } catch (\Throwable) {
            $this->error('The governed retention run did not complete.');

            return self::FAILURE;
        }

        $this->line((string) json_encode([
            'run_id' => $result['run']->id,
            'dry_run' => $result['run']->dry_run,
            'status' => $result['run']->status,
            'cutoff_at' => $result['run']->cutoff_at?->toIso8601String(),
            'next_after_file_id' => $result['run']->last_file_id,
            'results' => $result['results'],
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

        return self::SUCCESS;
    }
}
