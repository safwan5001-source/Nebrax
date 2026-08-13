<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * ═══════════════════════════════════════════════════════════════
     *  الشعار يرتفع من «تصميم المستندات» إلى مستوى الشركة
     * ═══════════════════════════════════════════════════════════════
     *  كان يعيش في `settings['sales_config']['designs']['logo']` — أي داخل
     *  **إعدادات تصميم مستندات المبيعات**، بجوار `show_logo` و`logo_height`
     *  اللذين يخصّان طباعة الفاتورة وحدها.
     *
     *  وحين صار الشعار يظهر في قشرة التطبيق (الشريط العلوي والجانبي) لكل
     *  مستخدم في كل صفحة، لم يعد موضعه ذاك صحيحاً:
     *
     *   • قراءته تمرّ بـ `sales-config/designs` المحمي بصلاحية `invoices.view`
     *     — فأيّ دور لا يفتح فاتورة (أمين مستودع، موظف موارد بشرية) كان يفقد
     *     هوية شركته من الشاشة كلّها لسبب لا علاقة له بالشعار.
     *   • ويلزم استدعاءً إضافياً في كل تحميل لجلب قالبٍ ونصوصٍ وختمٍ وتوقيع
     *     من أجل صورة واحدة.
     *
     *  فينتقل إلى `settings['company']['logo']` ويُعاد في `/me` مع بقية بيانات
     *  الشركة — بلا طلب زائد وبلا قيد صلاحية.
     *
     *  **الترحيل ينقل ولا يفقد:** كل مستأجر رفع شعاره يجده في مكانه الجديد،
     *  وشاشة تصميم المستندات تقرأ منه فلا يرى المستخدم فرقاً. والقيمة القديمة
     *  تُترك في موضعها احتياطاً لا تُحذف — حذفُ بيانات في هجرة نقلٍ مخاطرةٌ
     *  بلا مقابل، والمفتاح المهجور لا يقرؤه أحد.
     */
    public function up(): void
    {
        foreach (DB::table('tenants')->get(['id', 'settings']) as $tenant) {
            $settings = $this->decode($tenant->settings);
            $logo     = $settings['sales_config']['designs']['logo'] ?? '';

            // لا شعار، أو نُقل من قبل ⇒ لا شيء يُفعَل.
            if ($logo === '' || isset($settings['company']['logo'])) {
                continue;
            }

            $settings['company']['logo'] = $logo;

            DB::table('tenants')->where('id', $tenant->id)
                ->update(['settings' => json_encode($settings, JSON_UNESCAPED_UNICODE)]);
        }
    }

    /**
     * التراجع يزيل المفتاح المنقول وحده — والأصل باقٍ في موضعه، فلا يضيع شيء
     * في الاتجاهين.
     */
    public function down(): void
    {
        foreach (DB::table('tenants')->get(['id', 'settings']) as $tenant) {
            $settings = $this->decode($tenant->settings);

            if (! isset($settings['company']['logo'])) {
                continue;
            }

            unset($settings['company']['logo']);
            if (($settings['company'] ?? []) === []) {
                unset($settings['company']);
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
