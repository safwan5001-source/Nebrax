<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class DocumentCenterReadinessTest extends TestCase
{
    use RefreshDatabase;

    /** @test */
    public function readiness_reports_the_inert_stage_without_disclosing_storage_settings_or_making_network_requests(): void
    {
        config()->set('document_center.ai.provider_network_enabled', false);
        config()->set('document_center.storage.persistent_enabled', false);
        config()->set('document_center.storage.key', 'storage-key-must-not-appear');
        config()->set('document_center.storage.secret', 'storage-secret-must-not-appear');
        config()->set('document_center.storage.endpoint', 'https://storage.internal-must-not-appear');
        Http::fake();

        $exit = Artisan::call('documents:readiness', ['--json' => true]);
        $output = Artisan::output();

        $this->assertSame(0, $exit);
        $this->assertStringContainsString('ready_for_inert_code', $output);
        $this->assertStringContainsString('"provider_network_locked": true', $output);
        $this->assertStringContainsString('"external_activation_configured": false', $output);
        $this->assertStringNotContainsString('storage-key-must-not-appear', $output);
        $this->assertStringNotContainsString('storage-secret-must-not-appear', $output);
        $this->assertStringNotContainsString('storage.internal-must-not-appear', $output);
        Http::assertNothingSent();
    }
}
