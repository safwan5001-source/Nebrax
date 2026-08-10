<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\JournalLine;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  فخّ «الافتراض عند التعديل» — الغائب يبقى، لا يُمحى
 * ═══════════════════════════════════════════════════════════════
 *  `$data['x'] ?? <قيمة>` لا يفرّق بين «لم يُرسَل» و«أُرسل فارغاً». في مسار
 *  **الإنشاء** هذا صحيح (افتراض)، وفي مسار **التعديل** كارثة: كل حقل لا
 *  ترسله الشاشة يُمحى صامتاً.
 *
 *  في وحدة مالية يعني ذلك تغيّر مبلغ. ثلاث إصابات كانت في `InvoiceService`،
 *  كلٌّ منها مؤكَّدة تجريبياً قبل إصلاحها بتعديلٍ لا يمسّ مالاً — «تعديل
 *  الملاحظة» — وهو أخفّ تعديل ممكن:
 *
 *   ١. `tax_inclusive ?? false`      ⇒ الإجمالي ١١٥٠ ← ١٣٢٢٫٥٠
 *   ٢. `cost_center_id ?? null`      ⇒ الإيراد يسقط من تقرير مراكز التكلفة
 *   ٣. `shipping/discount/adjustment ?? 0` ⇒ الإجمالي ١٦٠٥ ← ١١٥٠
 *
 *  العلاج: `array_key_exists` يفصل الغياب عن الإفراغ الصريح — نفس علاج
 *  `branch_id` في `LedgerService` (#152).
 *
 *  تشغيل: php artisan test --filter=UpdateKeepsUntouchedFieldsTest
 */
class UpdateKeepsUntouchedFieldsTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private string $token;
    private string $partnerId;

    protected function setUp(): void
    {
        parent::setUp();

        $auth = $this->registerTenant();
        $this->token = $auth['token'];
        $this->partnerId = $this->withToken($this->token)
            ->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])
            ->assertCreated()['data']['id'];
    }

    private function create(array $extra = []): array
    {
        return $this->withToken($this->token)->postJson('/api/invoices', array_merge([
            'partner_id'   => $this->partnerId,
            'payment_type' => 'credit',
            'items'        => [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ], $extra))->assertCreated()['data'];
    }

    /** تعديلٌ لا يرسل إلا ما يخصّه — كما تفعل شاشةٌ جزئية أو عميل API. */
    private function touchNoteOnly(string $id): array
    {
        return $this->withToken($this->token)->putJson("/api/invoices/{$id}", [
            'partner_id' => $this->partnerId,
            'notes'      => 'تعديل الملاحظة',
            'items'      => [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertOk()['data'];
    }

    /**
     * **الإصابة ١:** وضع الضريبة كان يعود «غير شامل» فيتضخّم الإجمالي ١٥٪.
     *
     * @test
     */
    public function editing_a_note_keeps_the_tax_mode_and_the_total(): void
    {
        $invoice = $this->create([
            'tax_inclusive' => true,
            'items' => [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 115000, 'tax_rate' => 15]],
        ]);
        $this->assertSame('1150.00', $invoice['total']);

        $after = $this->withToken($this->token)->putJson("/api/invoices/{$invoice['id']}", [
            'partner_id' => $this->partnerId, 'notes' => 'تعديل الملاحظة',
            'items' => [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 115000, 'tax_rate' => 15]],
        ])->assertOk()['data'];

        $this->assertSame('1150.00', $after['total']);
        $this->assertTrue(Invoice::findOrFail($invoice['id'])->tax_inclusive);
    }

    /**
     * **الإصابة ٢:** مركز التكلفة وتاريخ الاستحقاق والمندوب كانت تُمحى.
     * مركز التكلفة يوسم سطر الإيراد في القيد، فمحوُه يُسقِط الإيراد من
     * تقرير ربحية مراكز التكلفة بلا أثر.
     *
     * @test
     */
    public function editing_a_note_keeps_the_optional_references(): void
    {
        $cc = $this->withToken($this->token)
            ->postJson('/api/cost-centers', ['name' => 'فرع الدمام', 'code' => 'CC-1'])
            ->assertCreated()['data'];

        $invoice = $this->create(['due_date' => '2026-03-01', 'cost_center_id' => $cc['id']]);

        $this->touchNoteOnly($invoice['id']);

        $after = Invoice::findOrFail($invoice['id']);
        $this->assertSame('2026-03-01', $after->due_date->toDateString());
        $this->assertSame($cc['id'], $after->cost_center_id);
    }

    /**
     * **الإصابة ٣:** الشحن والخصم والتسوية كانت تُصفَّر — أكبرها أثراً.
     *
     * @test
     */
    public function editing_a_note_keeps_shipping_discount_and_adjustment(): void
    {
        $invoice = $this->create(['shipping' => 50000, 'discount' => 10000, 'adjustment' => -500]);
        $this->assertSame('1605.00', $invoice['total']);

        $after = $this->touchNoteOnly($invoice['id']);

        $this->assertSame('500.00', $after['shipping']);
        $this->assertSame('100.00', $after['discount']);
        $this->assertSame('-5.00', $after['adjustment']);
        $this->assertSame('1605.00', $after['total'], 'تعديل الملاحظة لا يمسّ الإجمالي.');
    }

    /**
     * **الوجه الآخر:** الإفراغ الصريح ما زال يعمل. «الغائب يبقى» لا يعني
     * «لا يُمحى شيء أبداً» — من يرسل صفراً أو فراغاً يقصده.
     *
     * @test
     */
    public function an_explicit_empty_value_still_clears_the_field(): void
    {
        $invoice = $this->create(['shipping' => 50000, 'due_date' => '2026-03-01']);

        $after = $this->withToken($this->token)->putJson("/api/invoices/{$invoice['id']}", [
            'partner_id' => $this->partnerId,
            'shipping'   => 0,
            'due_date'   => null,
            'items'      => [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertOk()['data'];

        $this->assertSame('0.00', $after['shipping']);
        $this->assertNull(Invoice::findOrFail($invoice['id'])->due_date);
    }

    /**
     * الأثر المحاسبي النهائي: الفاتورة المعدَّلة تُرحَّل بإجماليها الصحيح،
     * فالقيد يحمل المبلغ الذي وافق عليه المستخدم لا مبلغاً محرَّفاً.
     *
     * @test
     */
    public function the_posted_entry_carries_the_amount_the_user_approved(): void
    {
        $invoice = $this->create(['shipping' => 50000, 'discount' => 10000, 'adjustment' => -500]);
        $this->touchNoteOnly($invoice['id']);

        $this->withToken($this->token)->postJson("/api/invoices/{$invoice['id']}/post")->assertOk();

        $posted = Invoice::with('lines')->findOrFail($invoice['id']);
        $this->assertSame(160500, (int) $posted->total);

        // ذمّة العميل تساوي إجمالي الفاتورة بالضبط، والقيد متوازن.
        // (التسوية السالبة تُقيَّد سطراً مستقلاً في 5170، فمجموع المدين
        //  يتجاوز الإجمالي بمقدارها — والتوازن هو المِحكّ لا المجموع.)
        $lines = JournalLine::with('account')
            ->where('journal_entry_id', $posted->journal_entry_id)->get();

        $receivable = $lines->first(fn (JournalLine $l) => $l->account->code === '1130');
        $this->assertSame(160500, (int) $receivable->debit, 'الذمّة = إجمالي الفاتورة المعتمَد.');
        $this->assertSame((int) $lines->sum('debit'), (int) $lines->sum('credit'));
    }

    /**
     * الإنشاء لم يتغيّر: الغياب هناك **يعني** الافتراض (صفر/فارغ) — وهو
     * الفرق الذي كان ضائعاً حين خدمت دالةٌ واحدة المسارين بـ `??`.
     *
     * @test
     */
    public function creation_still_defaults_absent_money_fields_to_zero(): void
    {
        $invoice = $this->create();

        $this->assertSame('0.00', $invoice['shipping']);
        $this->assertSame('0.00', $invoice['discount']);
        $this->assertSame('1150.00', $invoice['total']);
    }
}
