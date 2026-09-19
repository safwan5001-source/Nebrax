<?php

namespace Tests\Feature;

use App\Support\IcannRegistrableDomain;
use Tests\TestCase;

/**
 * CUSTOM-DOMAIN-EDGE-1 P1 — V1 hostnames are ICANN subdomains, not label-count.
 *
 * تشغيل: php artisan test --filter=IcannRegistrableDomainTest
 */
class IcannRegistrableDomainTest extends TestCase
{
    /** @test */
    public function shop_example_com_is_a_subdomain(): void
    {
        $this->assertTrue(IcannRegistrableDomain::isSubdomain('shop.example.com'));
        $this->assertSame('example.com', IcannRegistrableDomain::registrableDomain('shop.example.com'));
    }

    /** @test */
    public function example_com_apex_is_rejected(): void
    {
        $this->assertFalse(IcannRegistrableDomain::isSubdomain('example.com'));
        $this->assertSame('example.com', IcannRegistrableDomain::registrableDomain('example.com'));
    }

    /** @test */
    public function shop_co_uk_multi_label_public_suffix_apex_is_rejected(): void
    {
        $this->assertFalse(IcannRegistrableDomain::isSubdomain('shop.co.uk'));
        $this->assertSame('shop.co.uk', IcannRegistrableDomain::registrableDomain('shop.co.uk'));
    }

    /** @test */
    public function a_label_under_shop_co_uk_is_a_subdomain(): void
    {
        $this->assertTrue(IcannRegistrableDomain::isSubdomain('www.shop.co.uk'));
        $this->assertSame('shop.co.uk', IcannRegistrableDomain::registrableDomain('www.shop.co.uk'));
    }

    /** @test */
    public function shop_com_au_multi_label_public_suffix_apex_is_rejected(): void
    {
        $this->assertFalse(IcannRegistrableDomain::isSubdomain('shop.com.au'));
    }

    /** @test */
    public function public_suffix_itself_is_rejected(): void
    {
        $this->assertFalse(IcannRegistrableDomain::isSubdomain('co.uk'));
        $this->assertNull(IcannRegistrableDomain::registrableDomain('co.uk'));
        $this->assertFalse(IcannRegistrableDomain::isSubdomain('com'));
    }

    /** @test */
    public function empty_or_malformed_hostnames_fail_closed(): void
    {
        $this->assertFalse(IcannRegistrableDomain::isSubdomain(''));
        $this->assertFalse(IcannRegistrableDomain::isSubdomain('shop..example.com'));
        $this->assertFalse(IcannRegistrableDomain::isSubdomain('.'));
    }
}
