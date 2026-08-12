<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * ═══════════════════════════════════════════════════════════════
     *  سياسة المخزون السالب — المستأجر القائم يُبقى على سلوكه
     * ═══════════════════════════════════════════════════════════════
     *  `inventory.allow_negative_stock` افتراضه `false`: البيع بلا رصيد يُرفض،
     *  لأن رصيداً دائناً على حساب أصل خطأ لا سياسة.
     *
     *  لكن المستأجرين **القائمين** يبيعون اليوم بلا هذا القيد، وبعضهم لديه
     *  مخزون سالب فعلاً. لو سرى الافتراض عليهم فجأةً لتوقّفت مبيعاتهم بترقية
     *  لم يطلبوها — **تغيير سلوك صامت على بيانات إنتاج**، وهو ما لا يُقبل
     *  مهما كان الجديد أصحّ.
     *
     *  فتُثبَّت لهم `true` صراحةً هنا. من أراد التشديد يفعله من إعدادات
     *  المخزون بقرارٍ واعٍ، بعد أن يرى تقرير `inventory:diagnose`.
     *
     *  **المستأجرون الجدد** يبدؤون بـ `false` — أي بالسلوك الصحيح من أول يوم.
     */
    public function up(): void
    {
        foreach (DB::table('tenants')->get(['id', 'settings']) as $tenant) {
            $settings = $this->decode($tenant->settings);

            // من ضبطها صراحةً من قبل لا تُمسّ.
            if (isset($settings['inventory']['allow_negative_stock'])) {
                continue;
            }

            $settings['inventory']['allow_negative_stock'] = true;

            DB::table('tenants')->where('id', $tenant->id)
                ->update(['settings' => json_encode($settings, JSON_UNESCAPED_UNICODE)]);
        }
    }

    /**
     * التراجع يزيل المفتاح وحده لا مجموعة `inventory` كلها — قد تحمل تفضيلات
     * أخرى أُضيفت لاحقاً، وحذفها كان سيمحو ما لا يخصّ هذه الهجرة.
     */
    public function down(): void
    {
        foreach (DB::table('tenants')->get(['id', 'settings']) as $tenant) {
            $settings = $this->decode($tenant->settings);

            if (! isset($settings['inventory']['allow_negative_stock'])) {
                continue;
            }

            unset($settings['inventory']['allow_negative_stock']);
            if ($settings['inventory'] === []) {
                unset($settings['inventory']);
            }

            DB::table('tenants')->where('id', $tenant->id)
                ->update(['settings' => json_encode($settings, JSON_UNESCAPED_UNICODE)]);
        }
    }

    /** `settings` عمود json — قد يصل نصّاً أو مصفوفةً حسب السائق. */
    private function decode(mixed $raw): array
    {
        if (is_array($raw)) {
            return $raw;
        }

        return json_decode((string) $raw, true) ?: [];
    }
};
