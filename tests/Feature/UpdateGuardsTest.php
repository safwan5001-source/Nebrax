<?php

namespace Tests\Feature;

use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Product;
use App\Tenancy\BranchScope;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  حراسة التعديل — «الأفعال المحاسبية» لا تُعدَّل من شاشة بيانات
 * ═══════════════════════════════════════════════════════════════
 *  حقول تولّد قيداً عند الإنشاء (`opening_balance` للطرف،
 *  `initial_quantity` للمنتج) ليست أعمدةً في الجدول. كانت تُقبل في
 *  التعديل ثم تسقط خارج `$fillable` **صامتةً** — فيتلقّى العميل
 *  200 OK على عملية مالية لم تحدث.
 *
 *  الآن تُرفض بـ 422 برسالة تشرح البديل (قيد عكسي / حركة مخزون).
 *
 *  تشغيل: php artisan test --filter=UpdateGuardsTest
 */
class UpdateGuardsTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function partner(string $token, int $opening = 0): array
    {
        return $this->withToken($token)->postJson('/api/partners', [
            'name' => 'عميل', 'type' => 'customer',
            'opening_balance' => $opening ?: null,
        ])->assertCreated()['data'];
    }

    private function product(string $token, int $qty = 0): array
    {
        return $this->withToken($token)->postJson('/api/products', [
            'name' => 'منتج', 'type' => 'good',
            'purchase_price' => 10000, 'sale_price' => 20000,
            'track_inventory' => true, 'initial_quantity' => $qty,
        ])->assertCreated()['data'];
    }

    // ═══════════ الطرف ═══════════

    /** @test */
    public function updating_a_partner_with_an_opening_balance_is_rejected(): void
    {
        $auth = $this->registerTenant();
        $partner = $this->partner($auth['token']);

        $this->withToken($auth['token'])->putJson("/api/partners/{$partner['id']}", [
            'name' => 'عميل معدَّل', 'type' => 'customer',
            'opening_balance' => 500000,
        ])->assertStatus(422)->assertJsonValidationErrors('opening_balance');
    }

    /** @test */
    public function updating_a_partner_with_an_opening_balance_date_is_rejected(): void
    {
        $auth = $this->registerTenant();
        $partner = $this->partner($auth['token']);

        $this->withToken($auth['token'])->putJson("/api/partners/{$partner['id']}", [
            'name' => 'عميل', 'type' => 'customer',
            'opening_balance_date' => '2026-01-01',
        ])->assertStatus(422)->assertJsonValidationErrors('opening_balance_date');
    }

    /** صفر قيمةٌ فعلية لا غياب — كان يسقط صامتاً فيجب أن يُرفَض أيضاً. */
    /** @test */
    public function a_zero_opening_balance_is_rejected_too(): void
    {
        $auth = $this->registerTenant();
        $partner = $this->partner($auth['token']);

        $this->withToken($auth['token'])->putJson("/api/partners/{$partner['id']}", [
            'name' => 'عميل', 'type' => 'customer', 'opening_balance' => 0,
        ])->assertStatus(422);
    }

    /** @test */
    public function a_normal_partner_update_still_succeeds(): void
    {
        $auth = $this->registerTenant();
        $partner = $this->partner($auth['token']);

        $res = $this->withToken($auth['token'])->putJson("/api/partners/{$partner['id']}", [
            'name' => 'الاسم الجديد', 'type' => 'supplier',
            'city' => 'الخبر', 'credit_limit' => 250000,
        ])->assertOk();

        $this->assertSame('الاسم الجديد', $res['data']['name']);
        $this->assertSame('supplier', $res['data']['type']);
        $this->assertSame('2500.00', $res['data']['credit_limit']);
    }

    /** حذف الحقل من التعديل لا يمسّ قيد الرصيد الافتتاحي المولَّد عند الإنشاء. */
    /** @test */
    public function the_original_opening_entry_is_untouched_by_an_update(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $partner = $this->partner($auth['token'], 300000); // ٣٠٠٠ ريال

        $before = JournalLine::where('partner_type', Partner::class)
            ->where('partner_id', $partner['id'])->sum('debit');
        $this->assertSame(300000, (int) $before);

        $this->withToken($auth['token'])->putJson("/api/partners/{$partner['id']}", [
            'name' => 'اسم آخر', 'type' => 'customer',
        ])->assertOk();

        $after = JournalLine::where('partner_type', Partner::class)
            ->where('partner_id', $partner['id'])->sum('debit');
        $this->assertSame((int) $before, (int) $after, 'التعديل لا يمسّ القيد المرحّل.');
    }

    /** الإنشاء ما زال يقبل الرصيد الافتتاحي ويولّد قيده — لا انحدار. */
    /** @test */
    public function creating_a_partner_still_accepts_an_opening_balance(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $partner = $this->partner($auth['token'], 150000);

        $entry = JournalEntry::where('source_type', Partner::class)
            ->where('source_id', $partner['id'])->first();
        $this->assertNotNull($entry);
        $this->assertSame($entry->lines->sum('debit'), $entry->lines->sum('credit'));
    }

    // ═══════════ المنتج ═══════════

    /** @test */
    public function updating_a_product_with_an_initial_quantity_is_rejected(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);

        $this->withToken($auth['token'])->putJson("/api/products/{$product['id']}", [
            'name' => 'منتج معدَّل', 'type' => 'good', 'initial_quantity' => 50,
        ])->assertStatus(422)->assertJsonValidationErrors('initial_quantity');
    }

    /** @test */
    public function a_normal_product_update_still_succeeds(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);

        $res = $this->withToken($auth['token'])->putJson("/api/products/{$product['id']}", [
            'name' => 'منتج معدَّل', 'type' => 'good', 'sale_price' => 30000,
        ])->assertOk();

        $this->assertSame('منتج معدَّل', $res['data']['name']);
        $this->assertSame('300.00', $res['data']['sale_price']);
    }

    /** @test */
    public function the_product_quantity_is_untouched_by_an_update(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $product = $this->product($auth['token'], 20);
        $this->assertSame(20, Product::withoutGlobalScope(BranchScope::class)->find($product['id'])->quantity_on_hand);

        $this->withToken($auth['token'])->putJson("/api/products/{$product['id']}", [
            'name' => 'منتج معدَّل', 'type' => 'good', 'sale_price' => 30000,
        ])->assertOk();

        $this->assertSame(20, Product::withoutGlobalScope(BranchScope::class)->find($product['id'])->quantity_on_hand);
    }
}
