<?php

namespace App\Console\Commands;

use App\Services\R2SmokeTestService;
use Illuminate\Console\Command;

final class AwjR2SmokeTestCommand extends Command
{
    protected $signature = 'awj:r2-smoke-test';

    protected $description = 'تشخيص يدوي محصور لـ R2: كتابة/قراءة/حذف كائن مؤقت بلا بيانات مستأجرين';

    public function handle(R2SmokeTestService $smokeTest): int
    {
        $result = $smokeTest->run();
        if ($result['success']) {
            $this->line('R2 smoke test: PASS');
            foreach ($result['steps'] as $step => $status) {
                $this->line("{$step}: {$status}");
            }
            return self::SUCCESS;
        }

        $this->error('R2 smoke test: FAIL');
        $this->line('category: ' . $result['category']);
        foreach ($result['steps'] as $step => $status) {
            if ($status !== 'NOT_RUN') {
                $this->line("{$step}: {$status}");
            }
        }
        if ($result['key'] !== null && $result['steps']['cleanup'] === 'FAIL') {
            $this->line('temporary object key: ' . $result['key']);
            $this->line('The temporary object MAY remain.');
        }

        return self::FAILURE;
    }
}
