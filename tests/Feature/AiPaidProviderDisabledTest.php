<?php

namespace Tests\Feature;

use App\Contracts\AiAssistantProvider;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * بوابة دمج AI-02: الوصول إلى مزوّد مدفوع ما زال معطَّلاً بنيوياً. هذا الاختبار **حارسٌ مقصود**: إضافة مزوّد
 * حقيقي (AI-05) يجب أن تمرّ بمراجعة تُحدّثه صراحةً — لا تتسلل بصمت.
 *
 * تشغيل: php artisan test --filter=AiPaidProviderDisabledTest
 */
class AiPaidProviderDisabledTest extends TestCase
{
    #[Test]
    public function the_shipped_configuration_is_off_mock_only_and_prices_no_real_provider(): void
    {
        $config = require base_path('config/ai_assistant.php');

        $this->assertFalse($config['enabled']);
        $this->assertSame('mock', $config['provider']);
        $this->assertSame(['mock'], array_keys($config['pricing']), 'no real provider has a price entry');
        $this->assertFalse($config['pricing']['mock']['mock-1']['billable']);
        $this->assertSame(0, $config['pricing']['mock']['mock-1']['input_micro_usd_per_1k'] + $config['pricing']['mock']['mock-1']['output_micro_usd_per_1k']);
    }

    #[Test]
    public function the_mock_is_the_only_provider_implementation_in_the_codebase(): void
    {
        $implementers = [];
        $dirs = [base_path('app')];
        while ($dirs) {
            $dir = array_pop($dirs);
            foreach (scandir($dir) as $entry) {
                if ($entry === '.' || $entry === '..') {
                    continue;
                }
                $path = $dir . '/' . $entry;
                if (is_dir($path)) {
                    $dirs[] = $path;
                } elseif (str_ends_with($entry, '.php') && preg_match('/implements\s+[^{]*\bAiAssistantProvider\b/', (string) file_get_contents($path)) === 1) {
                    $implementers[] = basename($path);
                }
            }
        }

        $this->assertSame(['MockAiAssistantProvider.php'], $implementers);
        $this->assertTrue(interface_exists(AiAssistantProvider::class));
    }

    #[Test]
    public function no_environment_or_deployment_file_enables_the_assistant_or_selects_a_real_provider(): void
    {
        $files = ['.env.example', 'render.yaml', 'Dockerfile', 'deploy/DEPLOY.md', 'deploy/assemble.sh', 'setup.sh', '.github/workflows/ci.yml'];
        foreach ($files as $file) {
            $path = base_path($file);
            if (! is_file($path)) {
                continue;
            }
            $content = (string) file_get_contents($path);
            $this->assertDoesNotMatchRegularExpression('/AI_ASSISTANT_ENABLED\s*[:=]\s*["\']?(true|1|yes|on)\b/i', $content, "{$file} must not enable the assistant");
            $this->assertDoesNotMatchRegularExpression('/AI_ASSISTANT_PROVIDER\s*[:=]\s*["\']?(?!mock\b)\w+/i', $content, "{$file} must not select a real provider");
        }
    }

    #[Test]
    public function a_non_mock_provider_value_cannot_be_resolved_even_when_the_platform_is_enabled(): void
    {
        config(['ai_assistant.enabled' => true, 'ai_assistant.provider' => 'anthropic']);
        $gateway = new \ReflectionMethod(\App\Services\AiAssistantGateway::class, 'provider');

        $this->expectException(\App\Support\AiAssistantDenied::class);
        $gateway->invoke(app(\App\Services\AiAssistantGateway::class));
    }
}
