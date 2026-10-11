<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * AWJ-HORIZON-MEDIA-STORAGE S1 (Q13): مؤشّر مخزن صورة الموظف، صريحٌ لا مستنبَط من شكل
     * المفتاح. إضافيٌّ بحت وnullable بلا default ولا backfill: `null` = «قديم» ويُقرأ من القرص
     * المحلي بالسلوك الحالي حرفياً. القراءة والحذف يتبعان هذا العمود لا علم البيئة، فإغلاق
     * علم R2 لا يُضيّع صورة كُتبت على R2.
     */
    public function up(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->string('photo_disk', 50)->nullable()->after('photo_path');
        });
    }

    public function down(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->dropColumn('photo_disk');
        });
    }
};
