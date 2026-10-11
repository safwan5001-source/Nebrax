<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * ═══════════════════════════════════════════════════════════════
     *  AWJ-TAX-REM-02 / ADR-E (الخيار A) — سياسة الإشعار الدائن المستقل
     * ═══════════════════════════════════════════════════════════════
     *  `sales.allow_standalone_credit_notes` سياسة عمل (CLAUDE.md قاعدة 6):
     *  الافتراض الجديد **`false`** (الإشعار الدائن يتطلب فاتورة مصدراً مرحَّلة)
     *  يحمي المستأجرين الجدد، أمّا المستأجرون **القائمون** — وقد كانوا يُصدرون
     *  إشعاراتٍ بلا مصدر — فيُثبَّتون هنا على `true` كي لا تتعطل مسوداتهم
     *  وتدفقاتهم بترقية صامتة؛ ويقرّرون بوعي من إعدادات المبيعات (سابقة 000088).
     *
     *  القواعد:
     *  - مستأجرٌ قرّر بالفعل (المفتاح مخزَّن) لا يُمسّ، لا بالتفعيل ولا بالإلغاء.
     *  - مستأجرٌ بلا قيمة مخزَّنة يُثبَّت على `true`، سواء أصدر إشعاراتٍ مستقلة
     *    أم لا: نتجنّب التخمين من الاستعمال التاريخي لأن غياب الاستعمال اليوم
     *    لا يعني غياب الحاجة غداً.
     *  - المستأجر المنشأ بعد هذه الهجرة لا يحمل مفتاحاً فيأخذ الافتراض `false`.
     *  - الإشعارات المرحَّلة سابقاً لا تُمسّ إطلاقاً (immutable).
     *  - لا يُجرى إلا تحديث JSON لعمود `settings`؛ لا مسّ لأي جدول محاسبي.
     */
    public function up(): void
    {
        foreach (DB::table('tenants')->get(['id', 'settings']) as $tenant) {
            $settings = $this->decode($tenant->settings);
            if (array_key_exists('allow_standalone_credit_notes', $settings['sales'] ?? [])) {
                continue;
            }

            $settings['sales']['allow_standalone_credit_notes'] = true;
            DB::table('tenants')->where('id', $tenant->id)
                ->update(['settings' => json_encode($settings, JSON_UNESCAPED_UNICODE)]);
        }
    }

    /**
     * يزيل المفتاح المثبَّت من كل مستأجر. مخصَّص للتراجع عن الحزمة كاملةً (الكود
     * الذي يقرأ الإعداد يُسحب معها)؛ لا يُستعمل لتشديد السياسة على مستأجرٍ حيّ.
     */
    public function down(): void
    {
        foreach (DB::table('tenants')->get(['id', 'settings']) as $tenant) {
            $settings = $this->decode($tenant->settings);
            if (! array_key_exists('allow_standalone_credit_notes', $settings['sales'] ?? [])) {
                continue;
            }

            unset($settings['sales']['allow_standalone_credit_notes']);
            if ($settings['sales'] === []) {
                unset($settings['sales']);
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
