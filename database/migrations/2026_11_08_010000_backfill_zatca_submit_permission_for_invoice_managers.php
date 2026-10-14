<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * REM-37 / SEC-07 — انتقال `invoices.manage` → `zatca.submit` (قرار المالك: الخيار B).
 *
 * قبل REM-37 كان إنشاء محاولة الإرسال إلى ZATCA وإرسالها مرهونَين بـ`invoices.manage`.
 * بعده يلزم `zatca.submit` وحدها. ولأن صفوف `roles` المخزَّنة هي مصدر الحقيقة
 * (`Rbac::resolve()` لا يسقط على `MATRIX` إلا بغياب الصف)، فبلا هذه الهجرة يفقد كل
 * مستأجر قائم قدرة الإرسال لدورٍ كان يملكها (المحاسب النظامي وأي دور مخصَّص).
 *
 * القاعدة (إضافية، مرة واحدة):
 *   - كل دور مخزَّن (أي مستأجر، يشمل المحذوف ناعماً فلا تعود الاستعادة بلا الصلاحية)
 *     تحوي صلاحياته الصريحة `invoices.manage` ⇒ تُلحَق به `zatca.submit` في آخر القائمة.
 *   - الدور الذي يحوي `*` لا يُلمس إطلاقاً (يملك كل شيء أصلاً).
 *   - الدور بلا `invoices.manage` لا يُلمس.
 *   - الدور الذي يحوي `zatca.submit` أصلاً لا يُلمس ⇒ إعادة التشغيل لا تُكرّر المفتاح.
 *   - بقية المفاتيح تبقى كما هي حرفياً وبنفس ترتيبها؛ ولا يُكتب شيء لصفٍّ لم يتغيّر.
 *
 * التحديث صفاً صفاً بمعرّف الصف (UUID) — لا شرط على tenant_id، فلا يتسرّب تعديلٌ بين
 * المستأجرين: كل صف يُقرأ ويُكتب بمفرده.
 *
 * هذه الهجرة انتقالية فقط: **لا يبقى `invoices.manage` مساراً بديلاً** للإرسال بعدها
 * (مسارا الإرسال في `routes/api.php` يطلبان `zatca.submit` حصراً).
 *
 * `down()` بلا فعل عمداً: لا يمكن تمييز منحٍ أضافته هذه الهجرة عن منحٍ أضافه مدير لاحقاً
 * عن قصد، وحذفه جميعاً يسحب قدرةً مُنحت عمداً. مفتاحٌ زائد في دورٍ مخزَّن لا أثر له.
 */
return new class extends Migration
{
    private const SOURCE = 'invoices.manage';

    private const GRANT = 'zatca.submit';

    public function up(): void
    {
        $now = now();

        DB::table('roles')
            ->orderBy('id')
            ->get(['id', 'permissions'])
            ->each(function (object $role) use ($now): void {
                $stored = $this->decode($role->permissions);
                if ($stored === null) {
                    return; // JSON غير مفهوم: لا نخمّن ولا نعيد كتابته.
                }

                if (in_array('*', $stored, true)
                    || ! in_array(self::SOURCE, $stored, true)
                    || in_array(self::GRANT, $stored, true)) {
                    return;
                }

                $stored[] = self::GRANT;

                DB::table('roles')->where('id', $role->id)->update([
                    'permissions' => json_encode($stored),
                    'updated_at' => $now,
                ]);
            });
    }

    public function down(): void
    {
        // انظر التعليق أعلاه: لا عكس آمن.
    }

    /** @return array<int, mixed>|null */
    private function decode(mixed $stored): ?array
    {
        $decoded = is_array($stored) ? $stored : json_decode((string) $stored, true);

        return is_array($decoded) && array_is_list($decoded) ? $decoded : null;
    }
};
