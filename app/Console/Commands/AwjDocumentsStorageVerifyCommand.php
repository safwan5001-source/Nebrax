<?php

namespace App\Console\Commands;

use App\Services\DocumentCenter\DocumentStorageService;
use Illuminate\Console\Command;

/**
 * تحقق إنتاجي **يدوي** من تخزين مركز المستندات الدائم قبل فتح `DOCUMENT_DURABLE_STORAGE_ENABLED`
 * (AWJ-HORIZON-MEDIA-STORAGE S2/S6). لا يُستدعى من التشغيل العادي ولا الجدولة ولا HTTP.
 *
 * يقرأ إعداد التكامل `document_storage` المحفوظ في شاشة المنصة **بمعزل عن القفل**، ويجري كتابة/وجود/
 * قراءة ومطابقة/حذف لكائن اصطناعي تحت `healthchecks/` — لا يلمس أي مستأجر ولا قاعدة بيانات المستندات.
 * يطبع الحالة فقط (علم/سائق/خطوات) — لا أسرار ولا رسائل استثناء.
 *
 *   php artisan awj:documents-storage-verify
 */
final class AwjDocumentsStorageVerifyCommand extends Command
{
    protected $signature = 'awj:documents-storage-verify';

    protected $description = 'تحقق يدوي من إعداد R2 لمركز المستندات قبل فتح قفل التخزين الدائم (كائن اصطناعي، بلا بيانات مستأجر)';

    public function handle(DocumentStorageService $storage): int
    {
        $this->line('flag DOCUMENT_DURABLE_STORAGE_ENABLED: '.($storage->persistentEnabled() ? 'ON' : 'OFF'));
        $this->line('runtime driver now: '.$storage->effectiveDriver());

        $report = $storage->verifyPlatformConfiguration();
        if ($report['endpoint_host'] !== null) {
            $this->line('endpoint host: '.$report['endpoint_host']);
        }
        if ($report['bucket'] !== null) {
            $this->line('bucket: '.$report['bucket']);
        }
        foreach ($report['steps'] as $step => $value) {
            $ok = $value === true;
            $this->line(sprintf('%s: %s', $step, $ok ? 'PASS' : ($value === false ? 'FAIL' : 'FAIL ('.$value.')')));
        }

        if (! $report['ok']) {
            $this->error('FAIL: إعداد التخزين غير جاهز — لا تفتح القفل.');

            return self::FAILURE;
        }

        $this->info('PASS: R2 جاهز لمركز المستندات (القفل لم يتغيّر).');

        return self::SUCCESS;
    }
}
