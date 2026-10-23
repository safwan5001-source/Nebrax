<?php

namespace App\Services;

use App\Models\AiAction;
use App\Models\AiActionApproval;
use App\Models\AiActionEvent;
use App\Models\AiActionExecution;
use App\Models\AiActionImage;
use App\Services\DocumentCenter\DocumentStorageService;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use LogicException;
use Throwable;

/**
 * AI-ACTIONS-07: the lifecycle of the private staged images (the bytes a preview named).
 *
 * There is no parallel state machine: whether an image may go is *derived* from the state the action already has —
 * its status, its approval, its execution and the time of its last activity. Only one fact is stored, `purged_at`.
 *
 *   draft / approved-but-lapsed .. kept while idle less than `draft_days` (default = the draft retention, 30)
 *   cancelled .................... kept `cancelled_days` (1): it can never be used again
 *   executed (all succeeded) ..... kept `executed_days` (7): the images were consumed into product media, which has its own copies
 *   failed / partially failed .... kept `repairable_days` (30): the repair window — a repair copies from these
 *   executing, or a live approval  never purged; nothing that a resumable run or an approval still needs is touched
 *
 * Final product images are `ProductMedia` rows with their own files; nothing here can reach them. Every decision is
 * taken again *under the action's row lock* — the lock the execution, retry, approval, preview and repair-start paths
 * already take — so a purge can never interleave with them. Object keys are validated against the exact staging
 * layout before anything is deleted, and an object still referenced by another live row is never removed.
 *
 * Where the job runs matters (AI-ACTIONS-08): an object on the *durable* profile (`platform-s3`) is reachable from any
 * host, so a missing object means "already gone". An object on the local `platform` profile lives on one container's
 * disk — a different host (the cron scheduler) cannot see it, and "missing" there proves nothing. Such a row is
 * reported `unverifiable` and left unpurged, so the database never claims a removal that did not happen.
 */
final class AiActionStagedImageRetention
{
    public const DEFAULTS = ['cancelled_days' => 1, 'executed_days' => 7, 'repairable_days' => 30];
    /** Floors: a window can be lengthened freely, but never shortened below these (cancelled may be 0). */
    private const FLOORS = ['draft_days' => 1, 'cancelled_days' => 0, 'executed_days' => 1, 'repairable_days' => 1];
    private const KEY_PATTERN = '#^ai-actions/(?<tenant>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/(?<action>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/images/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\.thumb)?\.(?:jpg|png|webp)$#';

    public function __construct(private readonly DocumentStorageService $storage) {}

    /** @return array{draft_days:int,cancelled_days:int,executed_days:int,repairable_days:int} */
    public function days(): array
    {
        $configured = (array) config('ai_actions.staging_retention', []);
        $defaults = ['draft_days' => max(1, (int) config('ai_actions.draft_retention_days', 30))] + self::DEFAULTS;
        $out = [];
        foreach ($defaults as $key => $default) {
            $value = $configured[$key] ?? null;
            $whole = is_int($value) || (is_string($value) && preg_match('/^\d{1,4}$/', $value) === 1);
            $out[$key] = max(self::FLOORS[$key], $whole ? (int) $value : $default);
        }

        return $out;
    }

    /**
     * May this action's staged images be purged now? Pure reads. `$ignoreWindows` is for the explicit deletion of an
     * action (it asks only "is it safe", not "is it old enough").
     *
     * @return array{eligible:bool,reason:string}
     */
    public function decide(AiAction $action, CarbonInterface $now, bool $ignoreWindows = false): array
    {
        $days = $this->days();
        if ($action->status === AiAction::STATUS_EXECUTING) {
            return ['eligible' => false, 'reason' => 'running'];
        }
        $liveApproval = AiActionApproval::query()->withoutGlobalScopes()->where('ai_action_id', $action->id)
            ->whereNull('revoked_at')->where('expires_at', '>', $now)->exists();
        if ($liveApproval) {
            return ['eligible' => false, 'reason' => 'approval_active'];
        }

        $since = null;
        $window = null;
        if ($action->status === AiAction::STATUS_CANCELLED) {
            $since = $action->cancelled_at ?? $action->updated_at;
            $window = $days['cancelled_days'];
        } elseif (in_array($action->status, [AiAction::STATUS_EXECUTED, AiAction::STATUS_PARTIALLY_FAILED, AiAction::STATUS_FAILED], true)) {
            $execution = AiActionExecution::query()->withoutGlobalScopes()->where('ai_action_id', $action->id)->first();
            if ($execution === null || $execution->status === AiActionExecution::STATUS_RUNNING || $execution->finished_at === null) {
                return ['eligible' => false, 'reason' => 'execution_running'];
            }
            $since = $execution->finished_at;
            $window = $action->status === AiAction::STATUS_EXECUTED ? $days['executed_days'] : $days['repairable_days'];
        } else {
            // A draft nobody has touched: the newest of the action itself, its audit events and its images.
            $latestEvent = AiActionEvent::query()->withoutGlobalScopes()->where('ai_action_id', $action->id)->max('occurred_at');
            $latestImage = AiActionImage::query()->withoutGlobalScopes()->where('ai_action_id', $action->id)->max('created_at');
            $since = collect([$action->updated_at, $latestEvent, $latestImage])->filter()->map(fn ($t) => $t instanceof CarbonInterface ? $t : \Illuminate\Support\Carbon::parse($t, 'UTC'))->max();
            $window = $days['draft_days'];
        }

        if (! $ignoreWindows && $since !== null && $since->copy()->addDays($window)->isFuture()) {
            return ['eligible' => false, 'reason' => 'within_retention'];
        }

        return ['eligible' => true, 'reason' => 'eligible'];
    }

    /**
     * Sweeps every tenant (platform maintenance, like `imports:prune`).
     *
     * `$maxSeconds` bounds one run (no new action is started after it): a scheduled tick can never outlive its interval,
     * and what was not reached is reported as `remaining` and picked up by the next run.
     *
     * @return array{dry_run:bool,actions:int,images:int,bytes:int,failed:int,unsafe:int,unverifiable:int,remaining:int,duration_ms:int,skipped:array<string,int>}
     */
    public function run(bool $dryRun = false, ?string $tenantId = null, int $limit = 500, int $maxSeconds = 0): array
    {
        $totals = ['dry_run' => $dryRun, 'actions' => 0, 'images' => 0, 'bytes' => 0, 'failed' => 0, 'unsafe' => 0, 'unverifiable' => 0, 'remaining' => 0, 'duration_ms' => 0, 'skipped' => []];
        $started = microtime(true);
        $now = now('UTC');
        $ids = AiActionImage::query()->withoutGlobalScopes()->whereNull('purged_at')
            ->when($tenantId, fn ($q) => $q->where('tenant_id', $tenantId))
            ->select('ai_action_id')->distinct()->orderBy('ai_action_id')->limit(max(1, $limit))->pluck('ai_action_id');

        foreach ($ids as $position => $actionId) {
            if ($maxSeconds > 0 && microtime(true) - $started >= $maxSeconds) {
                $totals['remaining'] = count($ids) - $position;
                break;
            }
            $result = $this->purgeAction((string) $actionId, $dryRun, $now);
            if ($result['purged_actions'] > 0) {
                $totals['actions']++;
            }
            foreach (['images', 'bytes', 'failed', 'unsafe', 'unverifiable'] as $key) {
                $totals[$key] += $result[$key];
            }
            if ($result['reason'] !== 'eligible') {
                $totals['skipped'][$result['reason']] = ($totals['skipped'][$result['reason']] ?? 0) + 1;
            }
        }

        $totals['duration_ms'] = (int) round((microtime(true) - $started) * 1000);

        // Counts only: no ids, no object keys, no tenant data in the operational log.
        Log::info('ai_actions.staged_images.cleanup', ['dry_run' => $dryRun] + array_diff_key($totals, ['dry_run' => 1, 'skipped' => 1]) + ['skipped' => $totals['skipped']]);

        return $totals;
    }

    /**
     * Purges one action's staged images — or counts them, in a dry run. The decision is taken under the action's
     * row lock, the same lock execution / retry / approval / preview / repair-start hold, so it is final.
     *
     * @return array{reason:string,purged_actions:int,images:int,bytes:int,failed:int,unsafe:int,unverifiable:int}
     */
    public function purgeAction(string $actionId, bool $dryRun = false, ?CarbonInterface $now = null, bool $ignoreWindows = false): array
    {
        $now ??= now('UTC');
        $empty = ['reason' => 'gone', 'purged_actions' => 0, 'images' => 0, 'bytes' => 0, 'failed' => 0, 'unsafe' => 0, 'unverifiable' => 0];

        return DB::transaction(function () use ($actionId, $dryRun, $now, $ignoreWindows, $empty): array {
            $query = AiAction::query()->withoutGlobalScopes()->whereKey($actionId);
            $action = $dryRun ? $query->first() : $query->lockForUpdate()->first();
            if ($action === null) {
                return $empty;
            }
            $decision = $this->decide($action, $now, $ignoreWindows);
            if (! $decision['eligible']) {
                return ['reason' => $decision['reason']] + $empty;
            }

            $result = ['reason' => 'eligible'] + $empty;
            foreach (AiActionImage::query()->withoutGlobalScopes()->where('ai_action_id', $action->id)->whereNull('purged_at')->orderBy('id')->get() as $image) {
                $keys = $this->safeKeys($image);
                if ($keys === null) {
                    $result['unsafe']++; // an object outside the staging layout is never touched

                    continue;
                }
                try {
                    $doomed = array_values(array_filter($keys, fn (string $key): bool => ! $this->referencedElsewhere($image, $key))); // a shared object stays until its last live reference goes
                    // Local-disk objects are only provable from the host that holds the disk (see the class note).
                    $unreachable = $image->storage_profile !== DocumentStorageService::PROFILE_DURABLE
                        && array_filter($doomed, fn (string $key): bool => ! $this->storage->exists($image->storage_profile, $key)) !== [];
                    if (! $unreachable && ! $dryRun) {
                        foreach ($doomed as $key) {
                            $this->storage->delete($image->storage_profile, $key);
                        }
                    }
                } catch (Throwable) {
                    $result['failed']++; // left unpurged: the next run retries; nothing is claimed as removed

                    continue;
                }
                if ($unreachable) {
                    $result['unverifiable']++;

                    continue;
                }
                if ($dryRun) {
                    $result['images']++;
                    $result['bytes'] += (int) $image->size_bytes;

                    continue;
                }
                $image->forceFill(['purged_at' => $now])->save();
                $result['images']++;
                $result['bytes'] += (int) $image->size_bytes;
            }
            $result['purged_actions'] = $result['images'] > 0 ? 1 : 0;

            return $result;
        }, 3);
    }

    /**
     * Called when an action is about to be deleted: its private objects must go with it (the rows cascade away and
     * would orphan them), but never while something still needs them, and never if they cannot be removed.
     *
     * @throws LogicException
     */
    public function purgeBeforeDeleting(AiAction $action): void
    {
        $result = $this->purgeAction((string) $action->id, false, null, ignoreWindows: true);
        if ($result['reason'] !== 'eligible') {
            throw new LogicException('An AI action whose staged images are still needed cannot be deleted ('.$result['reason'].').');
        }
        if ($result['failed'] > 0 || $result['unsafe'] > 0 || $result['unverifiable'] > 0) {
            throw new LogicException('The staged images of this AI action could not all be removed; it was not deleted.');
        }
    }

    /**
     * The object keys of an image, only if they have exactly the layout staging writes — under the image's own tenant
     * and action. Anything else (a traversal, another tenant's path, a foreign prefix) yields null.
     *
     * @return list<string>|null
     */
    private function safeKeys(AiActionImage $image): ?array
    {
        $keys = array_values(array_filter([(string) $image->storage_key, $image->thumb_key === null ? null : (string) $image->thumb_key], static fn (?string $k): bool => $k !== null && $k !== ''));
        if ($keys === []) {
            return [];
        }
        foreach ($keys as $key) {
            if (str_contains($key, '..') || str_contains($key, "\0") || str_contains($key, '\\') || preg_match(self::KEY_PATTERN, $key, $m) !== 1
                || $m['tenant'] !== (string) $image->tenant_id || $m['action'] !== (string) $image->ai_action_id) {
                return null;
            }
        }

        return $keys;
    }

    private function referencedElsewhere(AiActionImage $image, string $key): bool
    {
        return AiActionImage::query()->withoutGlobalScopes()->where('id', '!=', $image->id)->whereNull('purged_at')
            ->where(fn ($q) => $q->where('storage_key', $key)->orWhere('thumb_key', $key))->exists();
    }
}
