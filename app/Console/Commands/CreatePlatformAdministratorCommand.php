<?php

namespace App\Console\Commands;

use App\Models\PlatformAdministrator;
use Illuminate\Console\Command;

/**
 * ينشئ أو يحدّث حساب تشغيل داخلي للمنصة خارج أي مستأجر.
 *
 * لا يوجد مسار API أو واجهة عامة لإنشاء هذا الحساب، لمنع أي تصعيد صلاحيات ذاتي.
 */
class CreatePlatformAdministratorCommand extends Command
{
    protected $signature = 'platform:administrator
        {email : البريد الإلكتروني الفريد لمدير المنصة}
        {--name= : الاسم الظاهر}
        {--password= : كلمة مرور قوية؛ سيُطلب إدخالها إن لم تمرّر الخيار}';

    protected $description = 'إنشاء أو تحديث حساب مدير منصة داخلي';

    public function handle(): int
    {
        $email = mb_strtolower((string) $this->argument('email'));
        $name = (string) ($this->option('name') ?: 'مدير المنصة');
        $password = (string) ($this->option('password') ?: $this->secret('كلمة المرور'));

        if (! filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $this->error('البريد الإلكتروني غير صالح.');

            return self::FAILURE;
        }

        if (mb_strlen($password) < 12) {
            $this->error('كلمة المرور يجب ألا تقل عن 12 حرفاً.');

            return self::FAILURE;
        }

        $administrator = PlatformAdministrator::withTrashed()->where('email', $email)->first();

        if ($administrator) {
            $administrator->fill([
                'name'      => $name,
                'password'  => $password,
                'is_active' => true,
            ]);
            $administrator->restore();
            $administrator->save();
            $this->info('تم تحديث وتفعيل حساب مدير المنصة.');

            return self::SUCCESS;
        }

        PlatformAdministrator::create([
            'name'      => $name,
            'email'     => $email,
            'password'  => $password,
            'is_active' => true,
        ]);

        $this->info('تم إنشاء حساب مدير المنصة.');

        return self::SUCCESS;
    }
}
