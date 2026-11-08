<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * P1-3a (تسوية ورديات الوقود) — وسم نظامي للأطراف التي تنشئها المنصة لا المستخدم.
 *
 * عمود إضافي nullable بلا Backfill: `NULL` = طرف عادي (كل الصفوف القائمة). القيمة `fuel_walk_in` = «العميل النقدي لمحطة وقود» الذي يُعيَّن صراحةً
 * عبر `FuelStationWalkInPartnerService`. الوسم يستبعده من قائمة العملاء (`GET /partners`) كي لا يُختار يدوياً ولا يختلط بالعملاء المسمّين.
 *
 * ليس في `$fillable` ولا في أي FormRequest: لا يُكتب إلا بالخدمة. التراجع يرفض متى وُجد طرف موسوم (لا فقد للوسم بصمت).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('partners', function (Blueprint $table) {
            $table->string('system_kind', 32)->nullable()->after('type');
            $table->index(['tenant_id', 'system_kind'], 'partners_system_kind_index');
        });
    }

    public function down(): void
    {
        if (DB::table('partners')->whereNotNull('system_kind')->exists()) {
            throw new RuntimeException('لا يمكن التراجع: توجد أطراف نظامية (system_kind) مرتبطة بمحطات وقود.');
        }

        Schema::table('partners', function (Blueprint $table) {
            $table->dropIndex('partners_system_kind_index');
            $table->dropColumn('system_kind');
        });
    }
};
