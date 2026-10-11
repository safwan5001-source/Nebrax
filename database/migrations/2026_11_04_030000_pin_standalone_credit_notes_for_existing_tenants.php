<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    private const MARKER = '_allow_standalone_credit_notes_pinned_by_rem02';

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
     *  - `down()` يزيل المثبَّت بهذه الهجرة وحده (علامة مرافقة)، فلا يضيع قرارٌ سابق.
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
            // علامة «ثبّتتها هذه الهجرة»: تمكّن `down()` من إزالة ما أضافته وحده دون مسّ قرارٍ
            // سابق. `Settings` يُهمل المفاتيح المجهولة عند القراءة، ويسقطها أول حفظٍ لإعدادات
            // المبيعات — فيصير الثابت عندها قرار المستأجر نفسه ولا يُمسّ عند التراجع.
            $settings['sales'][self::MARKER] = true;
            DB::table('tenants')->where('id', $tenant->id)
                ->update(['settings' => json_encode($settings, JSON_UNESCAPED_UNICODE)]);
        }
    }

    /**
     * يزيل ما ثبّتته هذه الهجرة وحدها (المعلَّم بالعلامة)، ولا يمسّ قراراً سابقاً —
     * صريحاً كان (`false`/`true`) أو محفوظاً بعد الهجرة من شاشة الإعدادات. فتراجُعٌ
     * ثم إعادة نشر لا يقلب سياسة مستأجر. مخصَّص للتراجع عن الحزمة كاملةً.
     */
    public function down(): void
    {
        foreach (DB::table('tenants')->get(['id', 'settings']) as $tenant) {
            $settings = $this->decode($tenant->settings);
            if (empty($settings['sales'][self::MARKER])) {
                continue;
            }

            unset($settings['sales']['allow_standalone_credit_notes'], $settings['sales'][self::MARKER]);
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
