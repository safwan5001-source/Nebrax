<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** AWJ-HORIZON-MEDIA-STORAGE S1b — أمر التحقق اليدوي: آمن، وهمي المستأجر، بلا قاعدة بيانات. */
class AwjAttachmentsVerifyCommandTest extends TestCase
{
    use RefreshDatabase;

    /** @test */
    public function put_refuses_to_run_when_the_flag_is_closed_and_writes_nothing(): void
    {
        $bucket = (new FakeR2Bucket())->install(false);

        $this->artisan('awj:attachments-verify --put')->expectsOutputToContain('OFF')->assertFailed();
        $this->assertSame([], $bucket->keys());
    }

    /** @test */
    public function put_then_check_with_cleanup_proves_durability_and_isolation(): void
    {
        $bucket = (new FakeR2Bucket())->install(true);

        $this->artisan('awj:attachments-verify --put')
            ->expectsOutputToContain('put: PASS')
            ->expectsOutputToContain('tenant B cannot see it: PASS')
            ->expectsOutputToContain('tenant B cannot delete it: PASS')
            ->expectsOutputToContain('object intact after tenant B attempts: PASS')
            ->assertSuccessful();
        $this->assertCount(1, $bucket->keys());
        $path = $bucket->keys()[0];
        $this->assertStringStartsWith('tenant/aaaaaaaa-0000-4000-8000-00000000f0a1/expense-attachments/', $path);

        $this->artisan("awj:attachments-verify --check={$path} --cleanup")
            ->expectsOutputToContain('content intact: PASS')
            ->expectsOutputToContain('cleanup: PASS')
            ->assertSuccessful();
        $this->assertSame([], $bucket->keys());
    }

    /** @test */
    public function check_refuses_any_key_outside_the_synthetic_tenants(): void
    {
        $bucket = (new FakeR2Bucket())->install(true);
        $realLooking = 'tenant/11111111-2222-4333-8444-555555555555/expense-attachments/r/f.pdf';
        $bucket->objects[$realLooking] = 'real customer file';

        $this->artisan("awj:attachments-verify --check={$realLooking} --cleanup")
            ->expectsOutputToContain('REFUSED')->assertFailed();
        $this->assertArrayHasKey($realLooking, $bucket->objects, 'a real-looking key must never be touched');
    }
}
