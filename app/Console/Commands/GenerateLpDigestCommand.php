<?php

namespace App\Console\Commands;

use App\Models\Tenant;
use App\Services\Pos\PosLpDigestService;
use App\Tenancy\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;

/**
 * توليد الملخص الرقابي اليومي (Daily LP Digest) لكل مستأجر — نمط `finance:scan-controls`
 * نفسه: يلفّ المستأجرين، يضبط `TenantContext`، يستدعي الخدمة. لا يكتب أي قيد أو مستند مالي؛
 * منتج بيانات قراءة فقط فوق Phase 1/2/3 القائمة.
 */
class GenerateLpDigestCommand extends Command
{
    protected $signature = 'pos:generate-lp-digest {--tenant= : توليد لمستأجر واحد بمعرّفه} {--date= : تاريخ اليوم المُلخَّص (افتراضياً أمس بتوقيت المؤسسة)}';

    protected $description = 'يولّد الملخص الرقابي اليومي (Daily LP Digest) لكل مستأجر — قراءة/تجميع فقط، بلا أثر محاسبي';

    public function handle(PosLpDigestService $service, TenantContext $context): int
    {
        $tenants = $this->option('tenant')
            ? Tenant::whereKey($this->option('tenant'))->get()
            : Tenant::orderBy('name')->get();

        if ($tenants->isEmpty()) {
            $this->warn('لا يوجد مستأجرون للتوليد.');

            return self::SUCCESS;
        }

        $forDate = $this->option('date') ? Carbon::parse($this->option('date')) : null;

        foreach ($tenants as $tenant) {
            $context->set($tenant->id);
            $digest = $service->generate($tenant, $forDate);
            $this->line("{$tenant->name}: ملخص {$digest->digest_date->toDateString()} — استثناءات جديدة: {$digest->new_exceptions_count}، قضايا جديدة: {$digest->new_cases_count}.");
        }

        $context->forget();

        $this->newLine();
        $this->line('اكتمل توليد الملخص الرقابي اليومي.');

        return self::SUCCESS;
    }
}
