<?php

namespace Tests\Feature;

use App\Http\Requests\RegisterRequest;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * INTL-PHONE-V1 — جوال التسجيل يُحفظ بصيغة E.164 بأرقام إنجليزية فقط.
 * الواجهة ترسل E.164؛ الخادم يطبّع الأرقام العربية/الفارسية والمسافات ويرفض ما ليس E.164.
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
    public function it_normalises_arabic_and_persian_digits_spaces_and_double_zero(): void
    {
        $this->postJson('/api/register', $this->payload('phone-ar', '+٩٦٦ ٥١ ٢٣٤ ٥٦٧٨'))->assertCreated();
        $this->assertSame('+966512345678', User::withoutGlobalScopes()->where('email', 'owner@phone-ar.test')->value('phone'));

        $this->postJson('/api/register', $this->payload('phone-fa', '۰۰۹۷۱ ۵۰ ۱۲۳ ۴۵۶۷'))->assertCreated();
        $this->assertSame('+971501234567', User::withoutGlobalScopes()->where('email', 'owner@phone-fa.test')->value('phone'));
    }

    /** @test */
    public function it_rejects_numbers_that_are_not_e164(): void
    {
        foreach (['0512345678', '512345678', '+0123456789', '+966', '+96651234567890123', 'abc', '+966 5x'] as $i => $phone) {
            $this->postJson('/api/register', $this->payload("bad-{$i}", $phone))
                ->assertStatus(422)->assertJsonValidationErrors(['phone']);
        }
    }

    /** @test */
    public function phone_stays_optional(): void
    {
        $this->postJson('/api/register', $this->payload('nophone', null, false))->assertCreated();
        $this->postJson('/api/register', $this->payload('blankphone', '  '))->assertCreated();
    }

    /** @test */
    public function normalize_helper_is_deterministic(): void
    {
        $this->assertSame('+966512345678', RegisterRequest::normalizePhone("\u{200E}+966 512-345-678"));
        $this->assertNull(RegisterRequest::normalizePhone('   '));
    }
}
