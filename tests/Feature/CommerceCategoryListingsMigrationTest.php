<?php

namespace Tests\Feature;

use App\Models\ProductCategory;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * COM-CATALOG-2 — backfill التوافق الرجعي في ترحيل
 * `2026_10_05_010000_create_commerce_category_listings_table`.
 *
 * يحاكي متجراً قائماً قبل الترحيل (تصنيفات + قنوات بلا أي صفوف نشر) بإسقاط
 * الجدول ثم تشغيل `up()` من جديد، ويثبت أن كل تصنيف قائم غير محذوف يحصل على
 * صفٍّ منشور لكل قناة قائمة — فلا يفقد أي متجر حالي أي تصنيف ظاهر لحظة
 * النشر — وأن التصنيفات المحذوفة (soft-deleted) لا تُستحدث لها صفوف.
 */
class CommerceCategoryListingsMigrationTest extends TestCase
{
    use RefreshDatabase;

    private const MIGRATION = '2026_10_05_010000_create_commerce_category_listings_table.php';

    #[Test]
    public function up_backfills_published_rows_for_every_existing_category_and_channel(): void
    {
        // حالة «ما قبل الترحيل»: الجدول غير موجود أصلاً.
        Schema::dropIfExists('commerce_category_listings');

        $tenant = Tenant::create([
            'name' => 'مستأجر ترحيل تصنيفات', 'slug' => 'cat-migration-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);

        $web = SalesChannel::create([
            'slug' => 'web', 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $mobile = SalesChannel::create([
            'slug' => 'mobile', 'name' => 'Mobile', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true,
        ]);

        $active = ProductCategory::create(['name' => 'تصنيف نشط', 'is_active' => true]);
        $inactive = ProductCategory::create(['name' => 'تصنيف معطّل', 'is_active' => false]);
        $deleted = ProductCategory::create(['name' => 'تصنيف محذوف', 'is_active' => true]);
        $deleted->delete(); // soft delete — كان محذوفاً قبل الترحيل.
        app(TenantContext::class)->forget();

        $migration = require database_path('migrations/'.self::MIGRATION);
        $migration->up();

        // كل تصنيف قائم غير محذوف × كل قناة قائمة = صف منشور (حتى المعطّل —
        // إخفاؤه شأن is_active كما قبل الترحيل تماماً، وإعادة تفعيله لاحقاً
        // تبقيه ظاهراً بلا تغيير سلوك).
        foreach ([$web, $mobile] as $channel) {
            foreach ([$active, $inactive] as $category) {
                $row = DB::table('commerce_category_listings')
                    ->where('category_id', $category->id)
                    ->where('sales_channel_id', $channel->id)
                    ->first();
                $this->assertNotNull($row, 'صف النشر الرجعي مفقود لتصنيف قائم على قناة قائمة.');
                $this->assertSame($tenant->id, $row->tenant_id);
                $this->assertTrue((bool) $row->is_published);
            }
        }

        // التصنيف المحذوف قبل الترحيل لا تُستحدث له صفوف.
        $this->assertSame(0, DB::table('commerce_category_listings')
            ->where('category_id', $deleted->id)->count());

        // الإجمالي: 2 تصنيفات × 2 قناة = 4 صفوف بالضبط — لا صفوف زائدة.
        $this->assertSame(4, DB::table('commerce_category_listings')->count());

        // والقيد الفريد فعّال: لا ازدواج لزوج تصنيف×قناة.
        $this->expectException(\Illuminate\Database\QueryException::class);
        DB::table('commerce_category_listings')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenant->id,
            'category_id' => $active->id,
            'sales_channel_id' => $web->id,
            'is_published' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    #[Test]
    public function fresh_rows_default_to_unpublished(): void
    {
        $tenant = Tenant::create([
            'name' => 'مستأجر افتراضي', 'slug' => 'cat-default-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create([
            'slug' => 'web', 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $category = ProductCategory::create(['name' => 'تصنيف جديد', 'is_active' => true]);
        app(TenantContext::class)->forget();

        $id = (string) Str::uuid();
        DB::table('commerce_category_listings')->insert([
            'id' => $id,
            'tenant_id' => $tenant->id,
            'category_id' => $category->id,
            'sales_channel_id' => $channel->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // التصنيفات/القنوات الجديدة بعد الترحيل تبدأ غير منشورة — نفس منطق
        // commerce_listings للمنتجات، ولا fallback غامض.
        $this->assertFalse((bool) DB::table('commerce_category_listings')->where('id', $id)->value('is_published'));
    }
}
