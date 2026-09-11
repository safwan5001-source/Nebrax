<?php

namespace Tests\Feature;

use App\Support\HostnameNormalizer;
use App\Support\InvalidHostnameException;
use Tests\TestCase;

/**
 * COM-7-P2A — `HostnameNormalizer` مسار التطبيع/التحقّق المركزي الوحيد
 * (AWJ_COM_7_P2_STOREFRONT_DOMAIN_RESOLUTION_DECISION.md §3/§7).
 *
 * تشغيل: php artisan test --filter=HostnameNormalizerTest
 */
class HostnameNormalizerTest extends TestCase
{
    /** @test */
    public function it_lowercases_a_plain_hostname(): void
    {
        $this->assertSame('shop.example.com', HostnameNormalizer::normalize('Shop.Example.COM'));
    }

    /** @test */
    public function it_strips_a_scheme(): void
    {
        $this->assertSame('shop.example.com', HostnameNormalizer::normalize('https://shop.example.com'));
    }

    /** @test */
    public function it_strips_a_port(): void
    {
        $this->assertSame('shop.example.com', HostnameNormalizer::normalize('shop.example.com:8443'));
    }

    /** @test */
    public function it_strips_path_query_and_fragment(): void
    {
        $this->assertSame('shop.example.com', HostnameNormalizer::normalize('shop.example.com/path?x=1#frag'));
    }

    /** @test */
    public function it_strips_a_trailing_dot(): void
    {
        $this->assertSame('shop.example.com', HostnameNormalizer::normalize('shop.example.com.'));
    }

    /** @test */
    public function it_combines_all_of_the_above_at_once(): void
    {
        $this->assertSame(
            'shop.example.com',
            HostnameNormalizer::normalize('HTTPS://Shop.Example.COM:8080/a/b?x=1#y')
        );
    }

    /** @test */
    public function it_rejects_an_empty_host(): void
    {
        $this->expectException(InvalidHostnameException::class);
        HostnameNormalizer::normalize('   ');
    }

    /** @test */
    public function it_rejects_credentials_in_the_host(): void
    {
        $this->expectException(InvalidHostnameException::class);
        HostnameNormalizer::normalize('user:pass@shop.example.com');
    }

    /** @test */
    public function it_rejects_a_single_label_host(): void
    {
        $this->expectException(InvalidHostnameException::class);
        HostnameNormalizer::normalize('localhost');
    }

    /** @test */
    public function it_rejects_an_empty_label(): void
    {
        $this->expectException(InvalidHostnameException::class);
        HostnameNormalizer::normalize('shop..example.com');
    }

    /** @test */
    public function it_rejects_a_label_starting_with_a_hyphen(): void
    {
        $this->expectException(InvalidHostnameException::class);
        HostnameNormalizer::normalize('-shop.example.com');
    }

    /** @test */
    public function it_rejects_a_label_ending_with_a_hyphen(): void
    {
        $this->expectException(InvalidHostnameException::class);
        HostnameNormalizer::normalize('shop-.example.com');
    }

    /** @test */
    public function it_rejects_a_label_over_63_characters(): void
    {
        $this->expectException(InvalidHostnameException::class);
        HostnameNormalizer::normalize(str_repeat('a', 64).'.example.com');
    }

    /** @test */
    public function it_rejects_a_hostname_over_253_characters(): void
    {
        $this->expectException(InvalidHostnameException::class);
        $label = str_repeat('a', 63);
        HostnameNormalizer::normalize(implode('.', array_fill(0, 5, $label)).'.com');
    }

    /** @test */
    public function it_rejects_invalid_characters(): void
    {
        $this->expectException(InvalidHostnameException::class);
        HostnameNormalizer::normalize('shop example.com');
    }

    /** @test */
    public function it_accepts_a_valid_multi_label_subdomain(): void
    {
        $this->assertSame('a.b.example.com', HostnameNormalizer::normalize('a.b.example.com'));
    }
}
