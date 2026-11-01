<?php

namespace App\Console\Commands;

use App\Models\BuilderPublishedExperienceVersion;
use App\Models\Tenant;
use App\Services\AppBuilder\BuilderLivePointerService;
use App\Services\AppBuilder\LivePointerBackfillPlanner;
use App\Tenancy\TenantContext;
use Illuminate\Console\Command;
use Throwable;

/**
 * AD-06 — هجرة المؤشرات الحيّة: «آخر نسخة حالية ⇒ المؤشر». **Dry-run افتراضياً: لا يكتب شيئاً.** يطبع تقريراً JSON-lines بما كان
 * سيُنشأ لكل مستأجر وملخصاً بالأعداد.
 *
 *   php artisan app-builder:backfill-live-pointers                 (معاينة لكل المستأجرين)
 *   php artisan app-builder:backfill-live-pointers --tenant=<uuid> (مستأجر واحد)
 *   php artisan app-builder:backfill-live-pointers --apply          (كتابة فعلية — **بموافقة منفصلة فقط**)
 *
 * `--apply` يُرفض ما دامت بوابة المؤشر مغلقة (`app_builder.live_pointer_enabled`): لا مؤشرات تُكتب لمستأجرين وميزة غير مفعّلة.
 * يكتب عبر `BuilderLivePointerService::promote` (قفل + تدقيق ثابت بسبب `backfill`)، وidempotent: مستأجر له مؤشر يُتخطّى.
 */
final class BackfillBuilderLivePointersCommand extends Command
{
    protected $signature = 'app-builder:backfill-live-pointers
        {--tenant= : مستأجر واحد (UUID)}
        {--apply : كتابة فعلية (الافتراضي معاينة بلا كتابة)؛ يشترط بوابة المؤشر مفتوحة}';

    protected $description = 'Preview (default) or explicitly apply the App Builder live-pointer backfill: current legacy selection becomes the pointer.';

    public function handle(LivePointerBackfillPlanner $planner, BuilderLivePointerService $pointers, TenantContext $context): int
    {
        $apply = (bool) $this->option('apply');
        if ($apply && ! BuilderLivePointerService::enabled()) {
            $this->error('رُفض: بوابة المؤشر الحيّ مغلقة (APP_BUILDER_LIVE_POINTER_ENABLED=false). لا تُكتب مؤشرات لميزة غير مفعّلة.');

            return self::INVALID;
        }

        $query = Tenant::query()->orderBy('created_at');
        $only = $this->option('tenant');
        if ($only !== null) {
            if (! is_string($only) || ! preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $only)) {
                $this->error('The --tenant option must be a UUID.');

                return self::INVALID;
            }
            $query->whereKey($only);
        }

        $counts = [];
        $failures = 0;
        foreach ($query->cursor() as $tenant) {
            $row = $planner->plan($tenant);
            $outcome = $row['status'];

            if ($apply && $row['status'] === 'would_create') {
                try {
                    $context->set($tenant->id);
                    $version = BuilderPublishedExperienceVersion::query()->whereKey($row['version_id'])->firstOrFail();
                    // create-only: مؤشر أنشأه كاتب آخر بين المعاينة والتنفيذ (ترقية مدير) يُترك كما هو ولا يُمحى.
                    $outcome = $pointers->createIfAbsent($version, null, 'backfill: pinned to the current legacy selection')
                        ? 'created'
                        : 'already_pointed';
                } catch (Throwable $e) {
                    $outcome = 'failed';
                    $row['error'] = $e->getMessage();
                    $failures++;
                } finally {
                    $context->forget();
                }
            }

            $row['outcome'] = $outcome;
            $counts[$outcome] = ($counts[$outcome] ?? 0) + 1;
            $this->line(json_encode($row, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        }

        ksort($counts);
        $this->line(json_encode(['mode' => $apply ? 'apply' : 'dry-run', 'summary' => $counts], JSON_UNESCAPED_UNICODE));

        return $failures > 0 ? self::FAILURE : self::SUCCESS;
    }
}
