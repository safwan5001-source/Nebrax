<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontPresentation;
use App\Models\StorefrontPresentationVersion;
use App\Services\Commerce\StorefrontPresentationVersionBackfillService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * CUST-H1-1 — هجرة/تعبئة `storefront_presentation_versions` من صفوف
 * `storefront_presentations` القديمة (الحالات A/B/C/D).
 *
 * تُنشئ صفوفاً "قديمة" مباشرة عبر `DB::table()` (تتجاوز أحداث Eloquent)
 * لمحاكاة بيانات موجودة قبل CUST-H1-1، ثم تستدعي
 * `StorefrontPresentationVersionBackfillService` مباشرة — بمعزل عن توقيت
 * الهجرة نفسها (التي تعمل فعلياً على `migrate:fresh` بلا صفوف موجودة).
 *
 * تشغيل: php artisan test --filter=StorefrontPresentationVersionBackfillTest
 */
class StorefrontPresentationVersionBackfillTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function seedWebStorefront(string $tenantId, array $overrides = []): Storefront
    {
        app(TenantContext::class)->set($tenantId);

        $channel = SalesChannel::query()->where('slug', 'web')->first()
            ?? SalesChannel::create([
                'slug' => 'web',
                'name' => 'ويب',
                'type' => SalesChannel::TYPE_WEB,
                'is_active' => true,
            ]);

        $storefront = Storefront::create([
            'slug' => $overrides['slug'] ?? 'main',
            'name' => $overrides['name'] ?? 'المتجر الرئيسي',
            'sales_channel_id' => $channel->id,
            'is_active' => true,
        ]);

        app(TenantContext::class)->forget();

        return $storefront;
    }

    /**
     * يُدرج صفّ `storefront_presentations` مباشرة عبر الاستعلام الخام —
     * يحاكي صفّاً قديماً قبل CUST-H1-1 (بلا مؤشرات إصدارات إطلاقاً).
     */
    private function insertLegacyRow(Storefront $storefront, array $overrides = []): string
    {
        $id = (string) Str::uuid();

        DB::table('storefront_presentations')->insert(array_merge([
            'id' => $id,
            'tenant_id' => $storefront->tenant_id,
            'storefront_id' => $storefront->id,
            'schema_version' => 2,
            'draft_config' => json_encode(['version' => 2, 'themePreset' => 'navy']),
            'draft_revision' => 3,
            'published_config' => null,
            'published_revision' => null,
            'published_at' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));

        return $id;
    }

    private function backfill(): StorefrontPresentationVersionBackfillService
    {
        return app(StorefrontPresentationVersionBackfillService::class);
    }

    /** @test */
    public function no_presentation_row_creates_no_version_and_no_head(): void
    {
        $auth = $this->registerTenant('backfill-case-a', 'owner@backfill-case-a.test');
        $storefront = $this->seedWebStorefront($auth['tenant_id']);

        $created = $this->backfill()->backfillAll();

        $this->assertSame(0, $created);
        $this->assertDatabaseCount('storefront_presentations', 0);
        $this->assertDatabaseCount('storefront_presentation_versions', 0);
    }

    /** @test */
    public function case_b_published_equals_draft_creates_one_version_and_sets_both_pointers(): void
    {
        $auth = $this->registerTenant('backfill-case-b', 'owner@backfill-case-b.test');
        $storefront = $this->seedWebStorefront($auth['tenant_id']);

        $document = json_encode(['version' => 2, 'themePreset' => 'navy']);
        $publishedAt = now()->subDays(3);

        $rowId = $this->insertLegacyRow($storefront, [
            'draft_config' => $document,
            'draft_revision' => 5,
            'published_config' => $document,
            'published_revision' => 5,
            'published_at' => $publishedAt,
        ]);

        $created = $this->backfill()->backfillAll();
        $this->assertSame(1, $created);

        $head = StorefrontPresentation::withoutGlobalScopes()->find($rowId);
        $this->assertNotNull($head->active_version_id);
        $this->assertSame($head->active_version_id, $head->compatibility_working_version_id);

        $version = StorefrontPresentationVersion::withoutGlobalScopes()->find($head->active_version_id);
        $this->assertNotNull($version);
        $this->assertSame($storefront->id, $version->storefront_id);
        $this->assertSame(5, (int) $version->revision);
        $this->assertSame('navy', $version->config['themePreset']);
        $this->assertNotNull($version->last_published_at);

        $this->assertDatabaseCount('storefront_presentation_versions', 1);
    }

    /** @test */
    public function case_c_published_differs_from_draft_creates_two_versions_with_correct_pointers(): void
    {
        $auth = $this->registerTenant('backfill-case-c', 'owner@backfill-case-c.test');
        $storefront = $this->seedWebStorefront($auth['tenant_id']);

        $publishedDoc = json_encode(['version' => 2, 'themePreset' => 'navy']);
        $draftDoc = json_encode(['version' => 2, 'themePreset' => 'burgundy']);
        $publishedAt = now()->subDay();

        $rowId = $this->insertLegacyRow($storefront, [
            'draft_config' => $draftDoc,
            'draft_revision' => 7,
            'published_config' => $publishedDoc,
            'published_revision' => 4,
            'published_at' => $publishedAt,
        ]);

        $created = $this->backfill()->backfillAll();
        $this->assertSame(1, $created);

        $head = StorefrontPresentation::withoutGlobalScopes()->find($rowId);
        $this->assertNotNull($head->active_version_id);
        $this->assertNotNull($head->compatibility_working_version_id);
        $this->assertNotSame($head->active_version_id, $head->compatibility_working_version_id);

        $published = StorefrontPresentationVersion::withoutGlobalScopes()->find($head->active_version_id);
        $draft = StorefrontPresentationVersion::withoutGlobalScopes()->find($head->compatibility_working_version_id);

        $this->assertSame('navy', $published->config['themePreset']);
        $this->assertNotNull($published->last_published_at);

        $this->assertSame('burgundy', $draft->config['themePreset']);
        $this->assertSame(7, (int) $draft->revision);
        $this->assertNull($draft->last_published_at);

        $this->assertDatabaseCount('storefront_presentation_versions', 2);
    }

    /** @test */
    public function case_d_draft_only_creates_one_draft_version_with_null_active_pointer(): void
    {
        $auth = $this->registerTenant('backfill-case-d', 'owner@backfill-case-d.test');
        $storefront = $this->seedWebStorefront($auth['tenant_id']);

        $rowId = $this->insertLegacyRow($storefront, [
            'draft_config' => json_encode(['version' => 2, 'themePreset' => 'sand']),
            'draft_revision' => 2,
            'published_config' => null,
            'published_revision' => null,
            'published_at' => null,
        ]);

        $created = $this->backfill()->backfillAll();
        $this->assertSame(1, $created);

        $head = StorefrontPresentation::withoutGlobalScopes()->find($rowId);
        $this->assertNull($head->active_version_id);
        $this->assertNotNull($head->compatibility_working_version_id);

        $draft = StorefrontPresentationVersion::withoutGlobalScopes()->find($head->compatibility_working_version_id);
        $this->assertSame(2, (int) $draft->revision);
        $this->assertSame('sand', $draft->config['themePreset']);

        $this->assertDatabaseCount('storefront_presentation_versions', 1);
    }

    /** @test */
    public function backfill_is_idempotent_and_does_not_duplicate_versions_on_rerun(): void
    {
        $auth = $this->registerTenant('backfill-idempotent', 'owner@backfill-idempotent.test');
        $storefront = $this->seedWebStorefront($auth['tenant_id']);

        $this->insertLegacyRow($storefront, [
            'draft_config' => json_encode(['version' => 2, 'themePreset' => 'navy']),
            'draft_revision' => 1,
        ]);

        $first = $this->backfill()->backfillAll();
        $second = $this->backfill()->backfillAll();

        $this->assertSame(1, $first);
        $this->assertSame(0, $second);
        $this->assertDatabaseCount('storefront_presentation_versions', 1);
    }

    /** @test */
    public function public_snapshot_is_unchanged_by_backfill(): void
    {
        $auth = $this->registerTenant('backfill-public-snapshot', 'owner@backfill-public-snapshot.test');
        $storefront = $this->seedWebStorefront($auth['tenant_id']);

        $publishedDoc = ['version' => 2, 'themePreset' => 'burgundy'];

        $rowId = $this->insertLegacyRow($storefront, [
            'draft_config' => json_encode($publishedDoc),
            'draft_revision' => 1,
            'published_config' => json_encode($publishedDoc),
            'published_revision' => 1,
            'published_at' => now(),
        ]);

        $before = DB::table('storefront_presentations')->where('id', $rowId)->first();

        $this->backfill()->backfillAll();

        $after = DB::table('storefront_presentations')->where('id', $rowId)->first();

        $this->assertSame($before->published_config, $after->published_config);
        $this->assertSame($before->published_revision, $after->published_revision);
        $this->assertSame((string) $before->published_at, (string) $after->published_at);
    }

    /** @test */
    public function backfill_across_multiple_storefronts_only_touches_rows_with_data(): void
    {
        $auth = $this->registerTenant('backfill-multi', 'owner@backfill-multi.test');
        $untouched = $this->seedWebStorefront($auth['tenant_id'], ['slug' => 'untouched']);
        $withDraft = $this->seedWebStorefront($auth['tenant_id'], ['slug' => 'with-draft']);

        $this->insertLegacyRow($withDraft, [
            'draft_config' => json_encode(['version' => 2, 'themePreset' => 'slate']),
            'draft_revision' => 1,
        ]);

        $created = $this->backfill()->backfillAll();

        $this->assertSame(1, $created);
        $this->assertDatabaseCount('storefront_presentation_versions', 1);

        $version = StorefrontPresentationVersion::withoutGlobalScopes()->first();
        $this->assertSame($withDraft->id, $version->storefront_id);
    }

    /**
     * Round-8 review: حذف متجرٍ ناعماً (`SoftDeletes`) قبل هذا الترحيل يترك
     * صفّ عرضه كما هو — الحذف الناعم UPDATE لا DELETE حقيقياً، فلا يُفعِّل
     * `cascadeOnDelete()` إطلاقاً. بلا استبعاد صريح، كان `backfillAll()` غير
     * المقيَّد بنطاق (`withoutGlobalScopes()`) يلتقط هذا الصفّ اليتيم، فيحاول
     * إنشاء نسخة له تفشل بنيوياً في `StorefrontPresentationVersion::booted()`
     * (لأن بحثها عن المتجر عبر `Storefront::withoutGlobalScope(TenantScope::class)`
     * لا يزال يطبّق `SoftDeletingScope` فيُعيد null) — فيُفشِل الهجرة الجماعية
     * كلّها بدل تجاهل هذا الصفّ وحده.
     */
    /** @test */
    public function backfill_all_skips_a_presentation_whose_storefront_was_soft_deleted_instead_of_aborting(): void
    {
        $auth = $this->registerTenant('backfill-skips-trashed', 'owner@backfill-skips-trashed.test');
        $live = $this->seedWebStorefront($auth['tenant_id'], ['slug' => 'live']);
        $trashed = $this->seedWebStorefront($auth['tenant_id'], ['slug' => 'trashed']);

        $liveRowId = $this->insertLegacyRow($live, [
            'draft_config' => json_encode(['version' => 2, 'themePreset' => 'navy']),
            'draft_revision' => 1,
        ]);
        $trashedRowId = $this->insertLegacyRow($trashed, [
            'draft_config' => json_encode(['version' => 2, 'themePreset' => 'sand']),
            'draft_revision' => 1,
        ]);

        $trashed->delete();
        $this->assertSoftDeleted('storefronts', ['id' => $trashed->id]);
        // تأكيد أن صفّ العرض اليتيم بقي قائماً فعلاً (لا cascade حقيقي).
        $this->assertDatabaseHas('storefront_presentations', ['id' => $trashedRowId]);

        $created = $this->backfill()->backfillAll();

        $this->assertSame(1, $created, 'يجب أن يُهاجَر صفّ المتجر الحيّ وحده — لا استثناء يُفشِل الدفعة كلّها.');

        $liveHead = StorefrontPresentation::withoutGlobalScopes()->find($liveRowId);
        $this->assertNotNull($liveHead->compatibility_working_version_id);

        $trashedHead = StorefrontPresentation::withoutGlobalScopes()->find($trashedRowId);
        $this->assertNull($trashedHead->compatibility_working_version_id, 'صفّ المتجر المحذوف ناعماً يجب ألا يُهاجَر ضمن الدفعة الجماعية.');
        $this->assertNull($trashedHead->active_version_id);
    }

    /**
     * Round-8 review: التصالح (`reconcileWithLegacyHead`) كان يكتب
     * `draft_schema_version` **عمود الرأس** حرفياً إلى النسخة، لا الوسم
     * المضمَّن في `draft_config` نفسه. كاتبٌ قديم يكتب `draft_config` مباشرة
     * لا يعرف هذا العمود إطلاقاً فيتركه متخلّفاً (1) رغم أن المحتوى v2 —
     * فتُوسَم النسخة المُصالَحة/المُشوَّكة خطأً بمخطط قديم، وقراءتها لاحقاً
     * عبر واجهة النسخ الدقيقة تُحيي أقساماً افتراضية محذوفة عمداً.
     */
    /** @test */
    public function reconciling_a_drifted_head_preserves_the_embedded_draft_tag_even_when_the_column_is_stale(): void
    {
        $auth = $this->registerTenant('reconcile-embedded-draft-tag', 'owner@reconcile-embedded-draft-tag.test');
        $storefront = $this->seedWebStorefront($auth['tenant_id']);

        $rowId = $this->insertLegacyRow($storefront, [
            'draft_config' => json_encode(['version' => 2, 'themePreset' => 'navy']),
            'draft_revision' => 1,
            'draft_schema_version' => 2,
        ]);

        $this->backfill()->backfillAll();
        $head = StorefrontPresentation::withoutGlobalScopes()->find($rowId);
        $compatId = $head->compatibility_working_version_id;
        $this->assertNotNull($compatId);

        // كاتبٌ قديم يعدّل draft_config مباشرة إلى مستند v2 (يحمل 'version' => 2
        // مضمَّناً) لكنه لا يعرف عمود draft_schema_version إطلاقاً فيتركه
        // متخلّفاً عند 1 رغم أن المحتوى v2 فعلياً.
        DB::table('storefront_presentations')->where('id', $head->id)->update([
            'draft_config' => json_encode(['version' => 2, 'themePreset' => 'burgundy']),
            'draft_revision' => 2,
            'draft_schema_version' => 1,
        ]);

        DB::transaction(function () use ($rowId) {
            $locked = StorefrontPresentation::withoutGlobalScopes()->whereKey($rowId)->lockForUpdate()->first();
            $this->backfill()->ensureCompatibilityWorkingVersion($locked);
        });

        $reconciled = StorefrontPresentationVersion::withoutGlobalScopes()->find($compatId);
        $this->assertSame(2, (int) $reconciled->schema_version, 'الوسم المضمَّن (v2) يجب أن يُستعمل عند التصالح، لا عمود draft_schema_version المتخلّف.');
        $this->assertSame('burgundy', $reconciled->config['themePreset']);
    }

    /**
     * Round-10 review: هجرة الحالتين B/C كانت تستعمل عمود `schema_version`
     * المشترك حرفياً لكلا النسختين المُنشأتين (المنشورة والمسودة معاً).
     * كاتبٌ قديم يحفظ مسودة v2 أثناء نافذة نشر متدرّج قصيرة بين هجرتَي
     * إضافة الأعمدة وهذه الهجرة يُقدّم العمود المشترك وحده إلى 2، بينما
     * `published_schema_version` المستقلّ يبقى 1 (يعكس منشوراً v1 لم
     * يتغيّر فعلياً) — فكانت النسخة المنشورة المُهاجَرة تُوسَم خطأً v2.
     */
    /** @test */
    public function case_c_backfill_tags_the_published_version_from_its_own_column_not_the_drifted_shared_one(): void
    {
        $auth = $this->registerTenant('backfill-independent-tags', 'owner@backfill-independent-tags.test');
        $storefront = $this->seedWebStorefront($auth['tenant_id']);

        // منشور v1 ناقص الأقسام الافتراضية عمداً (قسم "hero" فقط) — لإثبات
        // أن النسخة المُهاجَرة تُقرأ لاحقاً بدلالة v1 الصحيحة (استعادة
        // الأقسام الناقصة) لا v2 (الغياب حذفٌ حقيقي).
        $v1Published = ['homepage' => ['sections' => [['id' => 'hero', 'type' => 'hero', 'visible' => true]]]];

        $rowId = $this->insertLegacyRow($storefront, [
            // العمود المشترك "منجرف": كاتبٌ قديم حفظ مسودة v2 فرفعه إلى 2،
            // بينما published_schema_version المستقلّ ما يزال يعكس الحقيقة (1).
            'schema_version' => 2,
            'draft_config' => json_encode(['version' => 2, 'themePreset' => 'burgundy']),
            'draft_revision' => 2,
            'draft_schema_version' => 2,
            'published_config' => json_encode($v1Published),
            'published_revision' => 1,
            'published_at' => now(),
            'published_schema_version' => 1,
        ]);

        $created = $this->backfill()->backfillAll();
        $this->assertSame(1, $created);

        $head = StorefrontPresentation::withoutGlobalScopes()->find($rowId);
        $published = StorefrontPresentationVersion::withoutGlobalScopes()->find($head->active_version_id);
        $draft = StorefrontPresentationVersion::withoutGlobalScopes()->find($head->compatibility_working_version_id);

        $this->assertSame(1, (int) $published->schema_version, 'النسخة المنشورة يجب أن تُوسَم من عمودها المستقلّ (1)، لا العمود المشترك المنجرف (2).');
        $this->assertSame(2, (int) $draft->schema_version, 'النسخة المسودة يجب أن تُوسَم v2 كما تُقرّ وثيقتها ووسمها المستقلّ.');
    }
}
