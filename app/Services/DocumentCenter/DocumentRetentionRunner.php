<?php

namespace App\Services\DocumentCenter;

use App\Models\DocumentBatch;
use App\Models\DocumentFile;
use App\Models\DocumentGovernanceEvent;
use App\Models\DocumentRetentionPolicy;
use App\Models\DocumentRetentionRun;
use App\Models\PlatformAdministrator;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/** ينفذ purge يدوياً وبحدود ثابتة؛ لا يحتوي جدولة أو اتصال تخزين مباشر. */
final class DocumentRetentionRunner
{
    public const MAX_LIMIT = 500;

    public function __construct(
        private readonly DocumentRetentionPlanner $planner,
        private readonly DocumentStorageService $storage,
    ) {}

    public static function cutoff(?string $value): CarbonImmutable
    {
        if ($value === null) {
            return now('UTC')->toImmutable();
        }
        $cutoff = CarbonImmutable::parse($value);

        return preg_match('/^\d{4}-\d{2}-\d{2}$/', trim($value)) === 1 ? $cutoff->endOfDay() : $cutoff;
    }

    /** @return array{run:DocumentRetentionRun,results:array{scanned:int,eligible:int,purged:int,skipped:int}} */
    public function run(DocumentRetentionPolicy $policy, bool $dryRun, CarbonImmutable $cutoff, int $limit, ?PlatformAdministrator $actor = null, ?string $afterFileId = null): array
    {
        $limit = max(1, min(self::MAX_LIMIT, $limit));
        $run = DocumentRetentionRun::create([
            'document_retention_policy_id' => $policy->id,
            'platform_administrator_id' => $actor?->id,
            'dry_run' => $dryRun,
            'cutoff_at' => $cutoff,
            'limit_count' => $limit,
            'after_file_id' => $afterFileId,
            'status' => DocumentRetentionRun::STATUS_PLANNED,
            'started_at' => now('UTC'),
        ]);
        $counts = ['scanned' => 0, 'eligible' => 0, 'purged' => 0, 'skipped' => 0];
        $tenantContext = app(TenantContext::class);
        $branchContext = app(BranchContext::class);
        $previousTenant = $tenantContext->id();
        $previousBranch = $branchContext->id();

        try {
            // هذا التقرير عبر المستأجرين لا يستدعى إلا من controller منصة محروس؛ تعاد
            // إقامة contexts قبل أي write أو event حتى لا يتجاوز runner عزل الفرع.
            $candidates = DocumentFile::withoutGlobalScopes()
                ->when($afterFileId !== null, fn ($query) => $query->where('id', '>', $afterFileId))
                ->orderBy('id')
                ->limit($limit)
                ->get();
            foreach ($candidates as $candidate) {
                $counts['scanned']++;
                $run->fill(['last_file_id' => $candidate->id])->save();
                $tenantContext->set($candidate->tenant_id);
                $branchContext->set($candidate->branch_id);

                $outcome = $this->prepare($candidate, $policy, $cutoff, $dryRun, $run, $actor);
                if ($outcome['eligible']) {
                    $counts['eligible']++;
                }
                if ($outcome['pending']) {
                    $outcome = $this->purgePending($candidate->id, $policy, $cutoff, $run, $actor);
                }
                if ($outcome['purged']) {
                    $counts['purged']++;
                } elseif (! $outcome['eligible'] || ! $dryRun) {
                    $counts['skipped']++;
                }
            }
            $run->fill([
                'status' => DocumentRetentionRun::STATUS_COMPLETED,
                'scanned_count' => $counts['scanned'],
                'eligible_count' => $counts['eligible'],
                'purged_count' => $counts['purged'],
                'skipped_count' => $counts['skipped'],
                'finished_at' => now('UTC'),
            ])->save();
        } catch (\Throwable $exception) {
            $run->fill([
                'status' => DocumentRetentionRun::STATUS_FAILED,
                'error_code' => 'retention_run_failed',
                'error_message_safe' => 'تعذر إكمال تشغيل الاحتفاظ المحكوم.',
                'scanned_count' => $counts['scanned'],
                'eligible_count' => $counts['eligible'],
                'purged_count' => $counts['purged'],
                'skipped_count' => $counts['skipped'],
                'finished_at' => now('UTC'),
            ])->save();
            throw $exception;
        } finally {
            $previousTenant === null ? $tenantContext->forget() : $tenantContext->set($previousTenant);
            $previousBranch === null ? $branchContext->forget() : $branchContext->set($previousBranch);
        }

        return ['run' => $run->fresh(), 'results' => $counts];
    }

    /** @return array{eligible:bool,pending:bool,purged:bool} */
    private function prepare(DocumentFile $candidate, DocumentRetentionPolicy $policy, CarbonImmutable $cutoff, bool $dryRun, DocumentRetentionRun $run, ?PlatformAdministrator $actor): array
    {
        return DB::transaction(function () use ($candidate, $policy, $cutoff, $dryRun, $run, $actor): array {
            // ترتيب القفل batch ثم file يطابق إنشاء hold، فيمنع hold/purge المتزامنين من تجاوز planner.
            $batch = DocumentBatch::query()->whereKey($candidate->document_batch_id)->lockForUpdate()->first();
            $file = DocumentFile::query()->whereKey($candidate->id)->lockForUpdate()->first();
            if ($batch === null || $file === null) {
                return ['eligible' => false, 'pending' => false, 'purged' => false];
            }

            $decision = $this->planner->decide($file, $policy->retention_days, $cutoff);
            if (! $decision['eligible']) {
                if ($file->purge_pending_at !== null) {
                    $file->fill(['purge_pending_at' => null])->save();
                }
                $this->event($file, $run, $actor, DocumentGovernanceEvent::ACTION_RETENTION_SKIPPED, $decision['reason_code']);

                return ['eligible' => false, 'pending' => false, 'purged' => false];
            }
            if ($dryRun) {
                $this->event($file, $run, $actor, DocumentGovernanceEvent::ACTION_RETENTION_DRY_RUN_ELIGIBLE, 'eligible');

                return ['eligible' => true, 'pending' => false, 'purged' => false];
            }
            if ($file->purge_pending_at !== null) {
                return ['eligible' => true, 'pending' => true, 'purged' => false];
            }

            $file->fill(['purge_pending_at' => now('UTC')])->save();
            $this->event($file, $run, $actor, DocumentGovernanceEvent::ACTION_PURGE_PENDING, 'purge_pending');

            return ['eligible' => true, 'pending' => true, 'purged' => false];
        }, 3);
    }

    /** @return array{eligible:bool,pending:bool,purged:bool} */
    private function purgePending(string $fileId, DocumentRetentionPolicy $policy, CarbonImmutable $cutoff, DocumentRetentionRun $run, ?PlatformAdministrator $actor): array
    {
        // المرحلة الأولى قصيرة وقابلة لإعادة المحاولة: تقفل batch → file، تعيد planner، وتقرأ
        // claim المحفوظ. لا توجد فيها عملية تخزين خارجية أو أثر غير قابل للـrollback.
        $claim = DB::transaction(function () use ($fileId, $policy, $cutoff, $run, $actor): array {
            $candidate = DocumentFile::query()->whereKey($fileId)->first();
            if ($candidate === null) {
                return ['action' => 'skip', 'outcome' => ['eligible' => false, 'pending' => false, 'purged' => false]];
            }
            $batch = DocumentBatch::query()->whereKey($candidate->document_batch_id)->lockForUpdate()->first();
            $file = DocumentFile::query()->whereKey($fileId)->lockForUpdate()->first();
            if ($batch === null || $file === null) {
                return ['action' => 'skip', 'outcome' => ['eligible' => false, 'pending' => false, 'purged' => false]];
            }
            if ($file->purged_at !== null) {
                return ['action' => 'skip', 'outcome' => ['eligible' => true, 'pending' => false, 'purged' => true]];
            }

            $decision = $this->planner->decide($file, $policy->retention_days, $cutoff);
            if (! $decision['eligible']) {
                $file->fill(['purge_pending_at' => null])->save();
                $this->event($file, $run, $actor, DocumentGovernanceEvent::ACTION_RETENTION_SKIPPED, $decision['reason_code']);

                return ['action' => 'skip', 'outcome' => ['eligible' => false, 'pending' => false, 'purged' => false]];
            }
            if ($file->purge_pending_at === null) {
                return ['action' => 'skip', 'outcome' => ['eligible' => false, 'pending' => false, 'purged' => false]];
            }

            return [
                'action' => 'delete',
                'storage_profile' => $file->storage_profile,
                'object_key' => $file->object_key,
            ];
        }, 3);

        if ($claim['action'] === 'skip') {
            return $claim['outcome'];
        }

        // لا نحتفظ بقفل DB أثناء I/O. يبقى claim durable، ورفض إنشاء hold جديد أثناءه يحمي
        // القرار من السباق حتى يكتمل finalize أو تسترده المصالحة التالية.
        try {
            $objectWasPresent = $this->storage->exists($claim['storage_profile'], $claim['object_key']);
            if ($objectWasPresent) {
                $this->storage->delete($claim['storage_profile'], $claim['object_key']);
            }
        } catch (\Throwable) {
            $this->recordStorageFailure($fileId, $run, $actor);

            return ['eligible' => true, 'pending' => true, 'purged' => false];
        }

        // المرحلة النهائية قابلة لإعادة المحاولة لأنها لا تعيد أثر التخزين. إن فشلت DB بعد
        // نجاح الحذف يبقى claim، ويصالح التنفيذ التالي object الغائب دون حذف ثانٍ.
        return DB::transaction(function () use ($fileId, $policy, $run, $actor, $objectWasPresent): array {
            $candidate = DocumentFile::query()->whereKey($fileId)->first();
            if ($candidate === null) {
                return ['eligible' => false, 'pending' => false, 'purged' => false];
            }
            $batch = DocumentBatch::query()->whereKey($candidate->document_batch_id)->lockForUpdate()->first();
            $file = DocumentFile::query()->whereKey($fileId)->lockForUpdate()->first();
            if ($batch === null || $file === null) {
                return ['eligible' => false, 'pending' => false, 'purged' => false];
            }
            if ($file->purged_at !== null) {
                return ['eligible' => true, 'pending' => false, 'purged' => true];
            }
            if ($file->purge_pending_at === null) {
                return ['eligible' => false, 'pending' => false, 'purged' => false];
            }

            $reason = $objectWasPresent ? 'eligible' : 'object_missing_reconciled';
            $file->fill([
                'purged_at' => now('UTC'),
                'purge_pending_at' => null,
                'purge_reason_code' => $reason,
                'document_retention_policy_id' => $policy->id,
            ])->save();
            $this->event($file, $run, $actor, $objectWasPresent ? DocumentGovernanceEvent::ACTION_PURGED : DocumentGovernanceEvent::ACTION_PURGE_RECONCILED, $reason);

            return ['eligible' => true, 'pending' => false, 'purged' => true];
        }, 3);
    }

    private function recordStorageFailure(string $fileId, DocumentRetentionRun $run, ?PlatformAdministrator $actor): void
    {
        DB::transaction(function () use ($fileId, $run, $actor): void {
            $candidate = DocumentFile::query()->whereKey($fileId)->first();
            if ($candidate === null) {
                return;
            }
            $batch = DocumentBatch::query()->whereKey($candidate->document_batch_id)->lockForUpdate()->first();
            $file = DocumentFile::query()->whereKey($fileId)->lockForUpdate()->first();
            if ($batch === null || $file === null || $file->purged_at !== null) {
                return;
            }
            $this->event($file, $run, $actor, DocumentGovernanceEvent::ACTION_PURGE_STORAGE_FAILED, 'storage_delete_failed');
        }, 3);
    }

    private function event(DocumentFile $file, DocumentRetentionRun $run, ?PlatformAdministrator $actor, string $action, string $reason): void
    {
        DocumentGovernanceEvent::create([
            'document_batch_id' => $file->document_batch_id,
            'document_file_id' => $file->id,
            'document_retention_run_id' => $run->id,
            'action' => $action,
            'status' => match ($action) {
                DocumentGovernanceEvent::ACTION_PURGE_PENDING => 'purge_pending',
                DocumentGovernanceEvent::ACTION_PURGE_STORAGE_FAILED => 'storage_failed',
                DocumentGovernanceEvent::ACTION_RETENTION_SKIPPED => 'skipped',
                DocumentGovernanceEvent::ACTION_RETENTION_DRY_RUN_ELIGIBLE => 'eligible',
                default => 'purged',
            },
            'reason_code' => $reason,
            'actor_type' => $actor === null ? 'system' : 'platform_administrator',
            'actor_id' => $actor?->id,
            'metadata' => ['policy_key' => $run->policy()->value('policy_key')],
        ]);
    }
}
