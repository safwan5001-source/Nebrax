<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * COPS-H4-3 (ADR-29 §2.5، قرارات D-OPS-7/8 وD-H4-01) — امتداد إعدادات تشغيل القناة بتحكّمات استقبال الطلبات:
 * إيقاف يدوي (`accepting_orders`، `paused_until`، `pause_message`)، سياسة ما خارج ساعات العمل (`outside_hours_policy`)، والحد الأدنى للطلب
 * (`min_order_minor`، `min_order_scope`)؛ وجدول ساعات العمل الأسبوعية `commerce_channel_opening_hours`.
 *
 * **الافتراضيات = السلوك الحالي حرفياً** (مفتوح دائماً، سياسة `accept`، بلا حد أدنى، بلا ساعات = 24/7): أعمدة بافتراضيات ولا backfill ولا صف يُدرج
 * لأي قناة. **لا إنفاذ في هذه الشريحة** — لا Checkout ولا دفع ولا إلغاء يقرأ شيئاً من هذا (الإنفاذ H4-4 خلف بوابة مغلقة).
 *
 * القيود تُفرض في PostgreSQL بـCHECK (الإنتاج) وفي الخدمة على المحرّكين. الساعات: صف لكل فترة (يوم 0=الأحد..6=السبت، بداية/نهاية «HH:MM» بتوقيت
 * القناة، النهاية حتى «24:00»، بداية < نهاية)، فريد على (قناة، يوم، بداية).
 *
 * Rollback: `down()` يرفض متى وُجدت ساعات عمل أو قيمة غير افتراضية في أعمدة الإيقاف/السياسة/الحد الأدنى (إعداد مُهيَّأ بقرار بشري).
 */
return new class extends Migration
{
    private const TABLE = 'commerce_channel_operation_settings';

    private const COLUMNS = ['accepting_orders', 'paused_until', 'pause_message', 'outside_hours_policy', 'min_order_minor', 'min_order_scope'];

    public function up(): void
    {
        Schema::table(self::TABLE, function (Blueprint $table) {
            $table->boolean('accepting_orders')->default(true);
            $table->timestamp('paused_until')->nullable();
            $table->string('pause_message', 200)->nullable();
            $table->string('outside_hours_policy', 16)->default('accept');
            $table->unsignedBigInteger('min_order_minor')->nullable();
            $table->string('min_order_scope', 16)->default('all');
        });

        Schema::create('commerce_channel_opening_hours', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('sales_channel_id')->constrained('sales_channels')->cascadeOnDelete();
            $table->unsignedTinyInteger('weekday');
            $table->string('opens_at', 5);
            $table->string('closes_at', 5);
            $table->timestamps();

            $table->unique(['sales_channel_id', 'weekday', 'opens_at'], 'commerce_channel_opening_hours_period_unique');
            $table->index('tenant_id', 'commerce_channel_opening_hours_tenant_idx');
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE commerce_channel_operation_settings ADD CONSTRAINT commerce_ops_settings_intake_chk CHECK (
                outside_hours_policy IN ('accept', 'block')
                AND min_order_scope IN ('all', 'delivery_only')
                AND (min_order_minor IS NULL OR min_order_minor BETWEEN 1 AND 100000000000)
                AND (pause_message IS NULL OR char_length(pause_message) <= 200)
                AND (paused_until IS NULL OR accepting_orders = false)
            )");
            DB::statement("ALTER TABLE commerce_channel_opening_hours ADD CONSTRAINT commerce_channel_opening_hours_shape_chk CHECK (
                weekday BETWEEN 0 AND 6
                AND opens_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
                AND closes_at ~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'
                AND opens_at < closes_at
            )");
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('commerce_channel_opening_hours') && DB::table('commerce_channel_opening_hours')->exists()) {
            throw new \RuntimeException('Refusing to roll back: channel opening hours exist (a human configured them).');
        }
        if (Schema::hasTable(self::TABLE) && Schema::hasColumn(self::TABLE, 'accepting_orders')
            && DB::table(self::TABLE)->where(function ($q) {
                $q->where('accepting_orders', false)->orWhereNotNull('paused_until')->orWhereNotNull('pause_message')
                    ->orWhere('outside_hours_policy', '<>', 'accept')->orWhereNotNull('min_order_minor')->orWhere('min_order_scope', '<>', 'all');
            })->exists()) {
            throw new \RuntimeException('Refusing to roll back: channel intake controls are configured (a human configured them).');
        }

        Schema::dropIfExists('commerce_channel_opening_hours');

        if (Schema::hasTable(self::TABLE) && Schema::hasColumn(self::TABLE, 'accepting_orders')) {
            if (DB::getDriverName() === 'pgsql') {
                DB::statement('ALTER TABLE commerce_channel_operation_settings DROP CONSTRAINT IF EXISTS commerce_ops_settings_intake_chk');
            }
            Schema::table(self::TABLE, function (Blueprint $table) {
                $table->dropColumn(self::COLUMNS);
            });
        }
    }
};
