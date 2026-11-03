<?php

namespace App\Console\Commands;

use App\Models\PlatformAdministrator;
use App\Services\TenantSlugChangeService;
use Illuminate\Console\Command;
use RuntimeException;

/**
 * إصلاح تشغيلي لمستأجر معرّفه (slug) لا يصلح hostname — انظر `TenantSlugChangeService`.
 *
 * **الافتراضي معاينة قراءة فقط.** التنفيذ يتطلب `--apply` مع مدير منصة نشط مسؤول (`--admin`)
 * وسبب (`--reason`) وتأكيداً حرفياً (`--confirm="{old}->{new}"`) كي لا يُنفَّذ بالخطأ.
 */
class TenantChangeSlugCommand extends Command
{
    protected $signature = 'tenant:change-slug
        {tenant : معرّف المستأجر (UUID) أو السلاج الحالي بالضبط}
        {new_slug : السلاج الجديد (a-z وأرقام وشرطة داخلية، حتى 63)}
        {--apply : تنفيذ فعلي (بدونه معاينة قراءة فقط)}
        {--admin= : بريد مدير منصة نشط مسؤول عن التغيير (مع --apply)}
        {--reason= : سبب التغيير للتدقيق (مع --apply)}
        {--confirm= : تأكيد حرفي بصيغة old->new (مع --apply)}';

    protected $description = 'إصلاح slug مستأجر لا يصلح hostname (معاينة افتراضياً؛ --apply للتنفيذ)';

    public function handle(TenantSlugChangeService $service): int
    {
        $tenantRef = (string) $this->argument('tenant');
        $newSlug = mb_strtolower(trim((string) $this->argument('new_slug')));

        $plan = $service->plan($tenantRef, $newSlug);
        $this->renderPlan($plan);

        if ($plan['blockers'] !== []) {
            $this->error('موانع قائمة — لم يُنفَّذ شيء: '.implode(', ', $plan['blockers']));

            return self::FAILURE;
        }

        if (! $this->option('apply')) {
            $this->info('معاينة فقط — لم يُكتب شيء. للتنفيذ أضف: --apply --admin=<email> --reason="..." --confirm="'.$plan['old_slug'].'->'.$newSlug.'"');

            return self::SUCCESS;
        }

        $expected = $plan['old_slug'].'->'.$newSlug;
        if ((string) $this->option('confirm') !== $expected) {
            $this->error("التأكيد غير مطابق. المطلوب حرفياً: --confirm=\"{$expected}\"");

            return self::FAILURE;
        }

        $email = mb_strtolower(trim((string) $this->option('admin')));
        $administrator = $email === '' ? null : PlatformAdministrator::where('email', $email)->where('is_active', true)->first();
        if ($administrator === null) {
            $this->error('--admin يجب أن يكون بريد مدير منصة نشط موجود.');

            return self::FAILURE;
        }

        try {
            $tenant = $service->apply($tenantRef, $newSlug, $administrator, (string) $this->option('reason'));
        } catch (RuntimeException $e) {
            $this->error('لم يُنفَّذ التغيير (تراجع كامل): '.$e->getMessage());

            return self::FAILURE;
        }

        $this->info("تم: {$plan['old_slug']} → {$tenant->slug} (المستأجر {$tenant->id}). سُجِّل التدقيق.");
        $this->line('تحقق ما بعد التنفيذ: افتح عنوان ERP الجديد، سجّل الدخول، ثم أنشئ المتجر من الواجهة.');

        return self::SUCCESS;
    }

    /** @param array<string, mixed> $plan */
    private function renderPlan(array $plan): void
    {
        $this->line('المستأجر: '.json_encode($plan['tenant'], JSON_UNESCAPED_UNICODE));
        $this->line("السلاج: {$plan['old_slug']} → {$plan['new_slug']}");
        foreach ($plan['checks'] as $check) {
            $this->line(sprintf('  [%s] %s — %s', $check['ok'] ? 'OK  ' : 'FAIL', $check['key'], $check['detail']));
        }
        foreach ($plan['warnings'] as $warning) {
            $this->warn('  ! '.$warning);
        }
        $this->line('عناوين: '.json_encode($plan['urls'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        $this->line('بيانات محفوظة (صفوف لكل جدول، لا تتغير): '.json_encode($plan['preserved'], JSON_UNESCAPED_UNICODE));
    }
}
