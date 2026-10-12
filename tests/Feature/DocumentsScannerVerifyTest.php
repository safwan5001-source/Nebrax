<?php

namespace Tests\Feature;

use App\Contracts\DocumentSafetyScanner;
use App\Models\PlatformIntegrationSetting;
use App\Services\DocumentCenter\ClamAvTcpDocumentSafetyScanner;
use App\Services\PlatformIntegrationResolver;
use App\Support\DocumentScanStatus;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DocumentsScannerVerifyTest extends TestCase
{
    use RefreshDatabase;

    /** @test */
    public function a_healthy_scanner_passes_every_step_using_only_in_memory_data(): void
    {
        $this->enableScanner();
        $this->bindScanner(signatures: 28150, eicar: DocumentScanStatus::INFECTED, clean: DocumentScanStatus::CLEAN);

        $this->artisan('awj:documents-scanner-verify')
            ->expectsOutputToContain('ping:')
            ->expectsOutputToContain('eicar_detected:     PASS')
            ->expectsOutputToContain('PASS: الفاحص جاهز')
            ->assertSuccessful();
    }

    /** @test */
    public function an_empty_signature_database_or_a_missed_eicar_fails_the_verification(): void
    {
        $this->enableScanner();
        $this->bindScanner(signatures: 0, eicar: DocumentScanStatus::CLEAN, clean: DocumentScanStatus::CLEAN);

        $this->artisan('awj:documents-scanner-verify')
            ->expectsOutputToContain('signatures_loaded:  FAIL')
            ->expectsOutputToContain('eicar_detected:     FAIL')
            ->assertFailed();
    }

    /** @test */
    public function a_disabled_integration_fails_without_touching_the_scanner(): void
    {
        $this->bindScanner(signatures: 1, eicar: DocumentScanStatus::INFECTED, clean: DocumentScanStatus::CLEAN);

        $this->artisan('awj:documents-scanner-verify')->assertFailed();
    }

    private function enableScanner(): void
    {
        PlatformIntegrationSetting::create([
            'integration_key' => 'malware_scanner',
            'provider' => 'clamav_tcp',
            'enabled' => true,
            'configuration' => ['host' => 'awj-clamav.railway.internal', 'port' => 3310, 'timeout_seconds' => 10],
        ]);
    }

    private function bindScanner(int $signatures, DocumentScanStatus $eicar, DocumentScanStatus $clean): void
    {
        $this->app->bind(DocumentSafetyScanner::class, fn ($app) => new class($app->make(PlatformIntegrationResolver::class), $signatures, $eicar, $clean) extends ClamAvTcpDocumentSafetyScanner
        {
            public function __construct(PlatformIntegrationResolver $settings, private readonly int $signatures, private readonly DocumentScanStatus $eicar, private readonly DocumentScanStatus $clean)
            {
                parent::__construct($settings);
            }

            public function ping(): bool
            {
                return true;
            }

            public function signatureDatabaseVersion(): int
            {
                return $this->signatures;
            }

            public function scan($stream): DocumentScanStatus
            {
                return str_contains((string) stream_get_contents($stream), 'EICAR') ? $this->eicar : $this->clean;
            }
        });
    }
}
