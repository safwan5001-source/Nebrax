<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * البندان الأولان من قائمة «المؤجَّل عمداً» في
     * design-system/foundations/hr-users-architecture.md: صورة الموظف
     * والعنوانان الكاملان (حالي/دائم). كلّها `nullable` فلا يُكسَر موظفٌ قائم.
     *
     * حقول العنوان تكرّر أسماء أعمدة `partners` حرفياً (address, city,
     * building_no, street, district, postal_code, country) — نمطٌ عنوانٍ
     * وطنيٍّ قائمٌ فعلاً في الكود، لا صيغة جديدة تُخترَع لكل نموذج.
     */
    public function up(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            // صورة الموظف — مسار التخزين فقط؛ يُدار حصراً عبر مسارَي الرفع/الحذف
            // المخصَّصين (لا عبر تحديث الموظف العادي) فلا يُقبل مساراً حرّاً من العميل.
            $table->string('photo_path')->nullable()->after('notes');

            $after = 'photo_path';
            foreach (['current', 'permanent'] as $prefix) {
                foreach (['address', 'city', 'building_no', 'street', 'district', 'postal_code', 'country'] as $field) {
                    $table->string("{$prefix}_{$field}")->nullable()->after($after);
                    $after = "{$prefix}_{$field}";
                }
            }
        });
    }

    public function down(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->dropColumn([
                'photo_path',
                'current_address', 'current_city', 'current_building_no', 'current_street',
                'current_district', 'current_postal_code', 'current_country',
                'permanent_address', 'permanent_city', 'permanent_building_no', 'permanent_street',
                'permanent_district', 'permanent_postal_code', 'permanent_country',
            ]);
        });
    }
};
