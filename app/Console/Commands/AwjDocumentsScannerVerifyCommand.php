<?php

namespace App\Console\Commands;

use App\Contracts\DocumentSafetyScanner;
use App\Services\DocumentCenter\ClamAvTcpDocumentSafetyScanner;
use App\Services\PlatformIntegrationResolver;
use App\Support\DocumentScanStatus;
use Illuminate\Console\Command;
use Throwable;

/**
 * يثبت من داخل بيئة التشغيل (Railway Console) أن الفاحص يعمل فعلاً قبل الاعتماد عليه:
 * PING، قاعدة تواقيع محمّلة، EICAR القياسي ⇒ INFECTED، عيّنة نظيفة ⇒ CLEAN.
 * يعمل بتدفقات في الذاكرة فقط: لا ملفات مستأجرين، لا تخزين، لا كتابة في قاعدة البيانات،
 * ولا يطبع أسراراً (المضيف الداخلي والمنفذ فقط).
 */
class AwjDocumentsScannerVerifyCommand extends Command
{
    protected $signature = 'awj:documents-scanner-verify';

    protected $description = 'Verify the malware scanner end-to-end (PING, signatures, EICAR, clean sample) with in-memory data only.';

    public function handle(PlatformIntegrationResolver $settings, DocumentSafetyScanner $scanner): int
    {
        $configuration = $settings->activeConfiguration('malware_scanner');
        $this->line('integration_enabled: ' . ($configuration !== [] ? 'PASS' : 'FAIL (malware_scanner integration is not enabled)'));
        if ($configuration === []) {
            return $this->failed();
        }
        $this->line('provider:   ' . (string) $settings->activeProvider('malware_scanner'));
        $this->line('endpoint:   ' . (string) ($configuration['host'] ?? '?') . ':' . (int) ($configuration['port'] ?? 3310));

        $steps = [];
        $steps['ping'] = $this->step(fn () => $scanner->ping());
        $steps['signatures_loaded'] = $this->step(
            fn () => $scanner instanceof ClamAvTcpDocumentSafetyScanner && $scanner->signatureDatabaseVersion() > 0
        );
        $steps['eicar_detected'] = $this->step(fn () => $scanner->scan($this->stream($this->eicar())) === DocumentScanStatus::INFECTED);
        $steps['clean_sample_clean'] = $this->step(fn () => $scanner->scan($this->stream('AWJ clean sample ' . bin2hex(random_bytes(8)))) === DocumentScanStatus::CLEAN);

        foreach ($steps as $name => $result) {
            $this->line(str_pad($name . ':', 20) . $result);
        }

        if (in_array(false, array_map(fn (string $r) => $r === 'PASS', $steps), true)) {
            return $this->failed();
        }
        $this->info('PASS: الفاحص جاهز (PING + تواقيع + EICAR + عيّنة نظيفة).');

        return self::SUCCESS;
    }

    private function failed(): int
    {
        $this->error('FAIL: الفاحص غير جاهز — لا تعتمد على الفحص الأمني.');

        return self::FAILURE;
    }

    private function step(\Closure $check): string
    {
        try {
            return $check() ? 'PASS' : 'FAIL';
        } catch (Throwable $e) {
            return 'FAIL: ' . mb_substr($e->getMessage(), 0, 120);
        }
    }

    /** @return resource */
    private function stream(string $contents)
    {
        $stream = fopen('php://memory', 'w+b');
        fwrite($stream, $contents);
        rewind($stream);

        return $stream;
    }

    /** سلسلة EICAR القياسية (غير ضارة بتصميمها)؛ مجزّأة كي لا يلتقطها فاحص الملفات. */
    private function eicar(): string
    {
        return 'X5O!P%@AP[4\PZX54(P^)7CC)7}$' . 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
    }
}
