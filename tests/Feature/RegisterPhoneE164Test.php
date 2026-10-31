<?php

namespace Tests\Feature;

use App\Http\Requests\RegisterRequest;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * INTL-PHONE-V1 — جوال التسجيل: الواجهة ترسل E.164؛ الخادم يطبّع الأرقام العربية/الفارسية ويفحص شكل E.164
 * للقيم الدولية (`+…`) فقط، ويُبقي الأرقام المحلية القديمة كما كانت (توافق رجعي، بلا تخمين دولة).
 */
class RegisterPhoneE164Test extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        // مسار التسجيل محدود بـ3 طلبات/دقيقة لكل IP؛ الاختبار يسجّل عدة مرات عمداً.
        $this->withoutMiddleware(\Illuminate\Routing\Middleware\ThrottleRequests::class);
    }

    private function payload(string $slug, ?string $phone, bool $withPhone = true): array
    {
        $body = [
            'company_name' => 'شركة ' . $slug,
            'slug'         => $slug,
            'name'         => 'المالك',
            'email'        => "owner@{$slug}.test",
            'password'     => 'password123',
        ];
        if ($withPhone) {
            $body['phone'] = $phone;
        }

        return $body;
    }

    /** @test */
    public function it_stores_a_valid_e164_number_as_sent(): void
    {
        $this->postJson('/api/register', $this->payload('phone-sa', '+966512345678'))->assertCreated();
        $this->assertSame('+966512345678', User::withoutGlobalScopes()->where('email', 'owner@phone-sa.test')->value('phone'));
    }

    /** @test */
    public function it_accepts_other_countries_not_only_saudi(): void
    {
        foreach (['+971501234567', '+967712345678', '+201012345678', '+919876543210', '+12025550123'] as $i => $phone) {
            $this->postJson('/api/register', $this->payload("intl-{$i}", $phone))->assertCreated();
        }
    }

    /** @test */
    public function it_normalises_arabic_and_persian_digits_and_separators_of_international_numbers(): void
    {
        $this->postJson('/api/register', $this->payload('phone-ar', '+٩٦٦ ٥١ ٢٣٤ ٥٦٧٨'))->assertCreated();
        $this->assertSame('+966512345678', $this->storedPhone('phone-ar'));

        $this->postJson('/api/register', $this->payload('phone-fa', "\u{200E}＋۹۷۱ (۵۰) ۱۲۳-۴۵۶۷"))->assertCreated();
        $this->assertSame('+971501234567', $this->storedPhone('phone-fa'));
    }

    /**
     * Regression (PlatformTenantManagementTest): الرقم المحلي القديم كان مقبولاً ويُخزَّن حرفياً.
     * الخادم لا يعرف دولة الرقم المحلي فلا يخمّنها ولا يضيف +966 ولا يرفضه.
     *
     * @test
     */
    public function a_legacy_local_number_is_still_accepted_and_stored_verbatim(): void
    {
        foreach (['0500000000' => '0500000000', '500000000' => '500000000', '00971501234567' => '00971501234567'] as $sent => $expected) {
            $slug = 'legacy-' . $sent;
            $this->postJson('/api/register', $this->payload($slug, $sent))->assertCreated();
            $this->assertSame($expected, $this->storedPhone($slug), "legacy value {$sent} must not be re-interpreted");
        }
    }

    /** @test */
    public function a_legacy_local_number_still_gets_english_digits_only(): void
    {
        $this->postJson('/api/register', $this->payload('legacy-ar', '٠٥٠٠٠٠٠٠٠٠'))->assertCreated();
        $this->assertSame('0500000000', $this->storedPhone('legacy-ar'));
    }

    /** @test */
    public function it_rejects_malformed_international_numbers(): void
    {
        foreach (['+0123456789', '+966', '+123456', '+96651234567890123', '+966 5x', '+abc'] as $i => $phone) {
            $this->postJson('/api/register', $this->payload("bad-{$i}", $phone))
                ->assertStatus(422)->assertJsonValidationErrors(['phone']);
        }
    }

    /** @test */
    public function phone_stays_optional(): void
    {
        $this->postJson('/api/register', $this->payload('nophone', null, false))->assertCreated();
        $this->postJson('/api/register', $this->payload('blankphone', '  '))->assertCreated();
        $this->assertNull($this->storedPhone('blankphone'));
    }

    /** @test */
    public function normalize_helper_is_deterministic_and_never_guesses_a_country(): void
    {
        $this->assertSame('+966512345678', RegisterRequest::normalizePhone("\u{200E}+966 512-345-678"));
        $this->assertSame('0512345678', RegisterRequest::normalizePhone('0512345678'));
        $this->assertSame('00966512345678', RegisterRequest::normalizePhone('00966512345678'));
        $this->assertNull(RegisterRequest::normalizePhone('   '));
    }

    private function storedPhone(string $slug): ?string
    {
        return User::withoutGlobalScopes()->where('email', "owner@{$slug}.test")->value('phone');
    }
}
