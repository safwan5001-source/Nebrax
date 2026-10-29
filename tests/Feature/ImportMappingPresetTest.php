<?php

namespace Tests\Feature;

use App\Models\ImportMappingPreset;
use App\Models\Role;
use App\Models\TenantApplicationState;
use App\Services\ImportMappingPresetService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * IMP-H8-S2a — مطابقات أعمدة محفوظة لكل مجال استيراد: الحفظ والقائمة والحذف والتطبيق على عناوين ملف، الاسم الفريد المطبَّع، الحدود، بوابات **المجال** (لا اتحاد صلاحيات)،
 * وعزل المستأجر. لا ملف ولا صفوف ولا أثر محاسبي أو مخزني.
 *
 * تشغيل: php artisan test --filter=ImportMappingPresetTest
 */
class ImportMappingPresetTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private array $auth;

    protected function setUp(): void
    {
        parent::setUp();
        $this->auth = $this->registerTenant();
        app(TenantContext::class)->set($this->auth['tenant_id']);
    }

    private function cols(): array
    {
        return [['header' => 'رمز الصنف', 'field' => 'sku'], ['header' => 'الكمية', 'field' => 'quantity'], ['header' => 'ملاحظة', 'field' => null]];
    }

    private function save(string $token, string $name = 'مورد أ', string $domain = 'stock_permit_import', ?array $columns = null)
    {
        return $this->withToken($token)->postJson('/api/import-mapping-presets', ['domain' => $domain, 'name' => $name, 'columns' => $columns ?? $this->cols()]);
    }

    private function role(string $slug, array $permissions, string $email): string
    {
        app(TenantContext::class)->set($this->auth['tenant_id']);
        Role::create(['slug' => $slug, 'name' => $slug, 'permissions' => $permissions, 'is_system' => false]);

        return $this->tokenForRole($this->auth['tenant_id'], $slug, $email);
    }

    /** @test */
    public function a_preset_is_saved_listed_and_deleted_by_the_domain_manager(): void
    {
        $token = $this->auth['token'];
        $created = $this->save($token)->assertCreated()->json('data');
        $this->assertSame(['stock_permit_import', 'مورد أ'], [$created['domain'], $created['name']]);
        $this->assertSame(['sku', 'quantity', null], array_column($created['columns'], 'field'));

        $listed = $this->withToken($token)->getJson('/api/import-mapping-presets?domain=stock_permit_import')->assertOk()->json('data');
        $this->assertSame([$created['id']], array_column($listed, 'id'));
        $this->assertSame([], $this->withToken($token)->getJson('/api/import-mapping-presets?domain=expense_import')->assertOk()->json('data'));

        $this->withToken($token)->deleteJson("/api/import-mapping-presets/{$created['id']}")->assertOk();
        $this->assertSame(0, ImportMappingPreset::query()->count());
    }

    /** @test */
    public function the_name_is_unique_per_domain_after_arabic_normalisation_and_may_repeat_in_another_domain(): void
    {
        $token = $this->auth['token'];
        $this->save($token, 'مورد أ')->assertCreated();
        // الألف والتاء المربوطة والمسافات وحالة الأحرف لا تصنع اسماً جديداً
        $this->save($token, ' مورد ا ')->assertStatus(422);
        $this->save($token, 'مورد-ا')->assertStatus(422);
        $this->save($token, 'مورد أ', 'expense_import')->assertCreated();
        $this->assertSame(2, ImportMappingPreset::query()->count());
    }

    /** @test */
    public function an_invalid_name_or_column_set_is_refused(): void
    {
        $token = $this->auth['token'];
        $this->save($token, '   ')->assertStatus(422);
        $this->save($token, '---')->assertStatus(422);
        $this->save($token, str_repeat('ب', 81))->assertStatus(422);
        $this->save($token, 'x', 'stock_permit_import', [])->assertStatus(422);
        $this->save($token, 'x', 'stock_permit_import', [['header' => 'a', 'field' => 'Bad Field']])->assertStatus(422);
        $this->save($token, 'x', 'stock_permit_import', [['header' => 'a', 'field' => 'sku'], ['header' => 'b', 'field' => 'sku']])->assertStatus(422);
        $this->save($token, 'x', 'no_such_domain')->assertStatus(422);
        $many = array_fill(0, ImportMappingPresetService::MAX_COLUMNS + 1, ['header' => 'h', 'field' => null]);
        $this->save($token, 'x', 'stock_permit_import', $many)->assertStatus(422);
        $this->assertSame(0, ImportMappingPreset::query()->count());
    }

    /** @test */
    public function ignored_columns_are_stored_as_no_field(): void
    {
        $columns = [['header' => 'a', 'field' => 'ignore'], ['header' => 'b', 'field' => ''], ['header' => 'c']];
        $created = $this->save($this->auth['token'], 'x', 'stock_permit_import', $columns)->assertCreated()->json('data');
        $this->assertSame([null, null, null], array_column($created['columns'], 'field'));
    }

    /** @test */
    public function the_per_domain_limit_holds_and_deleting_frees_a_slot(): void
    {
        $token = $this->auth['token'];
        for ($i = 1; $i <= ImportMappingPresetService::MAX_PER_DOMAIN; $i++) {
            $this->save($token, "p{$i}")->assertCreated();
        }
        $this->save($token, 'extra')->assertStatus(422);
        $this->save($token, 'extra', 'expense_import')->assertCreated();

        $first = ImportMappingPreset::query()->where('name', 'p1')->firstOrFail();
        $this->withToken($token)->deleteJson("/api/import-mapping-presets/{$first->id}")->assertOk();
        $this->save($token, 'extra')->assertCreated();
    }

    /** @test */
    public function match_applies_a_preset_by_normalised_header_not_by_position(): void
    {
        $token = $this->auth['token'];
        $id = $this->save($token, 'مورد أ', 'stock_permit_import', [
            ['header' => 'رمز الصنف', 'field' => 'sku'], ['header' => 'الكمية', 'field' => 'quantity'], ['header' => 'ملاحظة', 'field' => null],
        ])->json('data.id');

        // ترتيب مختلف، مسافات/تشكيل/حالة أحرف مختلفة، وعمودٌ جديد غير محفوظ
        $result = $this->withToken($token)->postJson("/api/import-mapping-presets/{$id}/match", ['headers' => ['  الكمية ', 'Extra', 'رمز  الصنف']])->assertOk()->json('data');
        $this->assertSame([0 => 'quantity', 1 => null, 2 => 'sku'], array_map(fn ($v) => $v, $result['mapping']));
        $this->assertSame(2, $result['matched']);
        $this->assertSame([1], $result['unmatched']);
    }

    /** @test */
    public function match_never_binds_one_saved_column_to_two_file_columns(): void
    {
        $token = $this->auth['token'];
        $id = $this->save($token, 'x', 'stock_permit_import', [['header' => 'qty', 'field' => 'quantity']])->json('data.id');
        $result = $this->withToken($token)->postJson("/api/import-mapping-presets/{$id}/match", ['headers' => ['qty', 'QTY']])->assertOk()->json('data');
        $this->assertSame(['quantity', null], $result['mapping']);
        $this->assertSame([1], $result['unmatched']);
    }

    /** @test */
    public function access_follows_the_domain_gates_not_a_union_of_import_permissions(): void
    {
        $partners = $this->role('partner_clerk', ['partners.manage', 'partners.view'], 'pc@acme.test');
        $viewer = $this->role('prod_viewer', ['products.view'], 'pv@acme.test');
        $ownerPreset = $this->save($this->auth['token'], 'x', 'stock_permit_import')->json('data.id');

        // مجال العملاء: يملكه، ومجال إذون المخزون: لا
        $this->save($partners, 'عملاء', 'partner_master')->assertCreated();
        $this->withToken($partners)->getJson('/api/import-mapping-presets?domain=stock_permit_import')->assertForbidden();
        $this->save($partners, 'x', 'stock_permit_import')->assertForbidden();
        $this->withToken($partners)->deleteJson("/api/import-mapping-presets/{$ownerPreset}")->assertForbidden();
        $this->withToken($partners)->postJson("/api/import-mapping-presets/{$ownerPreset}/match", ['headers' => ['a']])->assertForbidden();

        // عرض المنتجات لا يكفي للحفظ ولا للقائمة
        $this->withToken($viewer)->getJson('/api/import-mapping-presets?domain=product_catalog')->assertForbidden();
        $this->save($viewer, 'x', 'product_catalog')->assertForbidden();
        $this->assertSame(2, ImportMappingPreset::query()->count());
    }

    /** @test */
    public function a_disabled_application_blocks_the_presets_of_its_domain_only(): void
    {
        app(TenantContext::class)->set($this->auth['tenant_id']);
        TenantApplicationState::updateOrCreate(['application_key' => 'inventory.core'], ['requested_enabled' => false, 'status' => 'disabled']);

        $this->save($this->auth['token'], 'x', 'stock_permit_import')->assertStatus(403);
        $this->withToken($this->auth['token'])->getJson('/api/import-mapping-presets?domain=stock_permit_import')->assertStatus(403);
        $this->save($this->auth['token'], 'x', 'product_catalog')->assertCreated();
    }

    /** @test */
    public function another_tenant_never_sees_touches_or_matches_a_preset(): void
    {
        $id = $this->save($this->auth['token'], 'سري')->json('data.id');
        $other = $this->registerTenant('beta', 'owner@beta.test');

        $this->assertSame([], $this->withToken($other['token'])->getJson('/api/import-mapping-presets?domain=stock_permit_import')->assertOk()->json('data'));
        $this->withToken($other['token'])->deleteJson("/api/import-mapping-presets/{$id}")->assertNotFound();
        $this->withToken($other['token'])->postJson("/api/import-mapping-presets/{$id}/match", ['headers' => ['a']])->assertNotFound();
        // الاسم نفسه متاح للمستأجر الآخر (فريد لكل مؤسسة)
        $this->save($other['token'], 'سري')->assertCreated();
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $this->assertSame(1, ImportMappingPreset::query()->count());
    }

    /** @test */
    public function an_unauthenticated_request_is_refused(): void
    {
        $this->getJson('/api/import-mapping-presets?domain=stock_permit_import')->assertUnauthorized();
        $this->postJson('/api/import-mapping-presets', [])->assertUnauthorized();
    }
}
