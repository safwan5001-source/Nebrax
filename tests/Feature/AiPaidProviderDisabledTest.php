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
    public function the_shipped_configuration_is_off_mock_default_and_ships_no_real_provider_price(): void
    {
        $config = require base_path('config/ai_assistant.php');

        $this->assertFalse($config['enabled']);
        $this->assertSame('mock', $config['provider']);
        // AI-07: the `anthropic` slot exists but is EMPTY by default (the owner supplies prices; an unpriced model is refused).
        $this->assertSame(['mock', 'anthropic'], array_keys($config['pricing']));
        $this->assertSame([], $config['pricing']['anthropic'], 'no real provider price is shipped');
        $this->assertFalse($config['pricing']['mock']['mock-1']['billable']);
        $this->assertSame(0, $config['pricing']['mock']['mock-1']['input_micro_usd_per_1k'] + $config['pricing']['mock']['mock-1']['output_micro_usd_per_1k']);
    }

    #[Test]
    public function only_the_mock_and_the_platform_anthropic_provider_implement_the_provider_contract(): void
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
                } elseif (str_ends_with($entry, '.php') && preg_match('/implements\s+[^{]*\bAi(?:External)?AssistantProvider\b/', (string) file_get_contents($path)) === 1) {
                    $implementers[] = basename($path);
                }
            }
        }

        sort($implementers);
        // AI-07: the only external implementation reuses the platform's Anthropic integration; any other provider is a new, reviewed decision.
        $this->assertSame(['AnthropicAssistantProvider.php', 'MockAiAssistantProvider.php'], $implementers);
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
