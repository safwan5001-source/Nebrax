<?php

namespace App\Console\Commands;

use App\Services\AttachmentStorage;
use App\Services\AttachmentStorageException;
use App\Services\R2StorageService;
use App\Tenancy\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Http\UploadedFile;
use Throwable;

/**
 * تحقق إنتاجي **يدوي** من مسار المرفقات الدائم (AWJ-HORIZON-MEDIA-STORAGE S1): لا يُستدعى من التشغيل
 * العادي ولا الجدولة ولا HTTP. لا يلمس قاعدة البيانات ولا أي مستأجر حقيقي: كل الكائنات تحت مستأجرَين
 * **وهميين** ثابتَين (UUID لا يطابق أي مستأجر)، ويرفض الأمر أي مفتاح خارجهما.
 *
 *   php artisan awj:attachments-verify --put           (1) يكتب كائناً عبر AttachmentStorage ويُثبت العزل
 *   ... أعد النشر ...
 *   php artisan awj:attachments-verify --check=<path> --cleanup   (2) يقرؤه بعد إعادة النشر ويحذفه
 *
 * يطبع الحالة فقط (علم/قرص/نجاح) — لا أسرار ولا اعتماد.
 */
final class AwjAttachmentsVerifyCommand extends Command
{
    private const TENANT_A = 'aaaaaaaa-0000-4000-8000-00000000f0a1';
    private const TENANT_B = 'bbbbbbbb-0000-4000-8000-00000000f0b2';
    private const MARKER = 'awj-attachments-verify';

    protected $signature = 'awj:attachments-verify
        {--put : اكتب كائن تحقق ثم أثبت العزل بين مستأجرَين وهميين}
        {--check= : مفتاح كائن كُتب بـ--put للتحقق منه (بعد إعادة النشر)}
        {--cleanup : مع --check: احذف الكائن بعد التحقق}';

    protected $description = 'تحقق يدوي من دوام المرفقات على R2 وعزل المستأجر (مستأجرون وهميون، بلا قاعدة بيانات)';

    public function handle(AttachmentStorage $storage, R2StorageService $r2, TenantContext $tenant): int
    {
        $this->line('flag AWJ_ATTACHMENTS_R2_ENABLED: '.($storage->r2Enabled() ? 'ON' : 'OFF'));
        $this->line('write disk: '.$storage->writeDisk());

        try {
            if ($this->option('put')) {
                return $this->put($storage, $tenant);
            }
            if (is_string($this->option('check')) && $this->option('check') !== '') {
                return $this->check($storage, $r2, $tenant, (string) $this->option('check'));
            }
        } catch (AttachmentStorageException $e) {
            $this->error('FAIL: storage error ('.($e->getPrevious() ? class_basename($e->getPrevious()) : 'AttachmentStorageException').')');

            return self::FAILURE;
        } finally {
            $tenant->forget();
        }

        $this->error('اختر --put أو --check=<path>.');

        return self::INVALID;
    }

    private function put(AttachmentStorage $storage, TenantContext $tenant): int
    {
        if (! $storage->r2Enabled()) {
            $this->error('FAIL: العلم مغلق — الكتابة ستذهب إلى القرص المحلي. لا شيء كُتب.');

            return self::FAILURE;
        }

        $tmp = tempnam(sys_get_temp_dir(), 'awjv');
        file_put_contents($tmp, self::MARKER.' '.now('UTC')->toIso8601String());
        try {
            $tenant->set(self::TENANT_A);
            $stored = $storage->put(
                AttachmentStorage::DOMAIN_EXPENSE, $storage->newResourceId(),
                new UploadedFile($tmp, 'verify.txt', 'text/plain', null, true), 'unused-when-r2',
            );
        } finally {
            @unlink($tmp);
        }
        if ($stored['disk'] !== 'r2') {
            $this->error('FAIL: الكتابة لم تذهب إلى R2.');

            return self::FAILURE;
        }
        $this->line('put: PASS (disk=r2)');
        $this->line('exists as tenant A: '.($storage->exists('r2', $stored['path']) ? 'PASS' : 'FAIL'));

        // العزل: مستأجر آخر لا يرى الكائن ولا يستطيع حذفه.
        $tenant->set(self::TENANT_B);
        $hidden = ! $storage->exists('r2', $stored['path']);
        $this->line('tenant B cannot see it: '.($hidden ? 'PASS' : 'FAIL'));
        $blocked = false;
        try {
            $storage->delete('r2', $stored['path']);
        } catch (AttachmentStorageException) {
            $blocked = true;
        }
        $this->line('tenant B cannot delete it: '.($blocked ? 'PASS' : 'FAIL'));
        $tenant->set(self::TENANT_A);
        $intact = $storage->exists('r2', $stored['path']);
        $this->line('object intact after tenant B attempts: '.($intact ? 'PASS' : 'FAIL'));

        $this->line('path: '.$stored['path']);
        $this->line('الخطوة التالية: أعد النشر ثم نفّذ --check=<path> --cleanup');

        return ($hidden && $blocked && $intact) ? self::SUCCESS : self::FAILURE;
    }

    private function check(AttachmentStorage $storage, R2StorageService $r2, TenantContext $tenant, string $path): int
    {
        $parts = explode('/', $path);
        // يرفض أي مفتاح خارج المستأجرَين الوهميين — الأمر لا يعمل على بيانات حقيقية أبداً.
        if (count($parts) !== 5 || $parts[0] !== 'tenant' || ! in_array($parts[1], [self::TENANT_A, self::TENANT_B], true)) {
            $this->error('REFUSED: المفتاح ليس لمستأجر تحقق وهمي.');

            return self::FAILURE;
        }
        $tenant->set($parts[1]);
        if (! $storage->exists('r2', $path)) {
            $this->error('FAIL: الكائن غير موجود بعد إعادة النشر.');

            return self::FAILURE;
        }
        $body = (string) $r2->get($parts[2], $parts[3], $parts[4]);
        $ok = str_starts_with($body, self::MARKER);
        $this->line('exists after redeploy: PASS');
        $this->line('content intact: '.($ok ? 'PASS' : 'FAIL'));
        if ($this->option('cleanup')) {
            $storage->delete('r2', $path);
            $gone = ! $storage->exists('r2', $path);
            $this->line('cleanup: '.($gone ? 'PASS' : 'FAIL'));
            $ok = $ok && $gone;
        }

        return $ok ? self::SUCCESS : self::FAILURE;
    }
}
