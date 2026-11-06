<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * FUEL-B3 — نطاق المحطة لمستخدم الوقود.
 *
 * بُعد ثالث بجانب الفرع (`branch_user`) والمستودع (`user_warehouse`): **أي محطات** يصل إليها المستخدم. يتقاطع مع الاثنين ولا يوسّعهما.
 *
 * ═══ السياسة الصريحة لغياب الإسناد (لا «الفراغ = الكلّ» الضمني) ═══
 *  عمود `users.fuel_station_scope` يحدد وضع المستخدم صراحةً:
 *    - NULL (الحالة الافتراضية لكل مستخدم قائم): **لا تقييد بمحطة** — سلوكه اليوم حرفياً (فروع/مخازن فقط)، فالأدوار القديمة والمستخدمون
 *      القائمون يعملون بلا أي إجراء، ولا يحتاج المستأجر لتهيئة.
 *    - 'assigned': مقيَّد بصفوف `fuel_station_user` **حصراً**؛ **بلا صفوف = لا وصول لأي محطة** (فشل مغلق). فموظف يُسنَد له قالب ولم تُسنَد له
 *      محطة بعد لا يرى شيئاً، لا كل شيء.
 *  الوضع لا يُكتب إلا عبر خدمة موظفي الوقود (محروسة ومدقَّقة)، ولا يدخل `User::$fillable` فلا يعدّله `PUT /users`.
 *
 * جدول الربط بمفتاح مركّب بلا `id` (علاقة لا كيان) كنمط `branch_user`/`user_warehouse`؛ حذف المستخدم أو المحطة يزيل الصف (حالة حالية لا تاريخ —
 * التاريخ في `access_change_events`).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fuel_station_user', function (Blueprint $table) {
            $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('fuel_station_id')->constrained('fuel_stations')->cascadeOnDelete();
            $table->timestamps();

            $table->primary(['user_id', 'fuel_station_id']);
            $table->index('fuel_station_id');
        });

        Schema::table('users', function (Blueprint $table) {
            $table->string('fuel_station_scope', 16)->nullable()->after('role');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('fuel_station_scope');
        });
        Schema::dropIfExists('fuel_station_user');
    }
};
