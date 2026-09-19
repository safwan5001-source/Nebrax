<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * COM-CATALOG-2 — نشر التصنيفات حسب قناة البيع: يفصل حقيقة التصنيف الأساسية
 * (`ProductCategory` — بيانات رئيسية: اسم/شجرة/حالة دورة حياة `is_active`) عن
 * نشره التجاري حسب قناة بيع، بنفس منطق `commerce_listings` للمنتجات حرفياً.
 * جدولٌ إضافي بحت — لا `product_categories` ولا `sales_channels` يتغيّران.
 *
 * لماذا جدولٌ جديد؟ لا يوجد أي مصدر نشر قائم للتصنيفات يمكن إعادة استخدامه:
 * `CommerceListing` مرتبط بـ`product_id` حصرياً (نشر منتجات)، و`is_active` على
 * التصنيف حالة دورة حياة رئيسية لا علم نشر واجهة (المهمة تمنع استخدامه كذلك)،
 * ولا جدول Category × SalesChannel آخر في المخطط.
 *
 * `unique(['category_id', 'sales_channel_id'])`: **صفر أو حالة واحدة** لكل زوج
 * تصنيف×قناة — نفس منطق `commerce_listings` (منتج×قناة).
 *
 * التوافق الرجعي (حرج): قبل هذا الترحيل كانت كل التصنيفات النشطة ظاهرة على
 * كل القنوات (بنية تصفّح مشتركة). الترحيل يُدرج صفاً منشوراً (`is_published =
 * true`) لكل تصنيف قائم غير محذوف × كل قناة بيع قائمة، فلا يتغيّر أي سلوك
 * ظاهر لأي متجر حالي لحظة النشر. بعدها تكون القاعدة حتمية بلا أي fallback:
 * ظاهرٌ ⟺ يوجد صفٌّ منشور. تصنيف/قناة جديدان يبدآن غير منشورَين (الافتراضي
 * `false`) تماماً كما تبدأ المنتجات غير منشورة.
 *
 * الحذف: `category_id` → `restrictOnDelete()` بنفس اختيار
 * `commerce_listings.product_id`؛ `sales_channel_id` → `cascadeOnDelete()`
 * بنفس اختيار `commerce_listings.sales_channel_id`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('commerce_category_listings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('category_id')->constrained('product_categories')->restrictOnDelete();
            $table->foreignUuid('sales_channel_id')->constrained('sales_channels')->cascadeOnDelete();

            $table->boolean('is_published')->default(false);
            $table->timestamps();

            $table->unique(['category_id', 'sales_channel_id']);
            // بوابة الواجهة العامة تستعلم بـ(قناة، منشور) — فهرس مركّب ضئيل.
            $table->index(['sales_channel_id', 'is_published']);
        });

        // ── Backfill التوافق الرجعي: لا متجر حالي يفقد أي تصنيف ظاهر ──
        $now = now();
        DB::table('sales_channels')->select(['id', 'tenant_id'])->orderBy('id')
            ->chunk(100, function ($channels) use ($now): void {
                foreach ($channels as $channel) {
                    DB::table('product_categories')
                        ->where('tenant_id', $channel->tenant_id)
                        ->whereNull('deleted_at')
                        ->orderBy('id')
                        ->chunk(200, function ($categories) use ($channel, $now): void {
                            $rows = [];
                            foreach ($categories as $category) {
                                $rows[] = [
                                    'id' => (string) Str::uuid(),
                                    'tenant_id' => $category->tenant_id,
                                    'category_id' => $category->id,
                                    'sales_channel_id' => $channel->id,
                                    'is_published' => true,
                                    'created_at' => $now,
                                    'updated_at' => $now,
                                ];
                            }
                            if ($rows !== []) {
                                DB::table('commerce_category_listings')->insert($rows);
                            }
                        });
                }
            });
    }

    public function down(): void
    {
        Schema::dropIfExists('commerce_category_listings');
    }
};
