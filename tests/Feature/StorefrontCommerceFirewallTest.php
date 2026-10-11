<?php

namespace Tests\Feature;

use App\Support\Commerce\StorefrontPresentationNormalizer;
use Tests\TestCase;

/**
 * CUST-HV V9d-4 — جدار التجارة (V0 §14.3): لا حقل عرض يحدّد سعراً أو خصماً أو مخزوناً أو توفراً أو ضريبة أو مبلغاً.
 *
 * ثلاثة أبعاد: (١) وثيقة عدائية بمفاتيح تجارية في كل نطاق لا يبقى منها شيء بعد التطبيع، وتوأما TS يثبتان الشيء نفسه من
 * الملف المشترك؛ (٢) أي مفتاح مسموح في مخرجات التطبيع لا يطابق نمط المفاتيح التجارية؛ (٣) ساكن: طبقة العرض لا تستورد
 * خدمات السعر/العرض/السلة/المخزون ولا العكس (لا اقتران بين الطبقتين).
 *
 * تشغيل: php artisan test --filter=StorefrontCommerceFirewallTest
 */
class StorefrontCommerceFirewallTest extends TestCase
{
    /** @return array<string,mixed> */
    private function fixture(): array
    {
        return json_decode((string) file_get_contents(__DIR__.'/../Fixtures/presentation/commerce-firewall.json'), true, 512, JSON_THROW_ON_ERROR);
    }

    /**
     * @param  array<mixed>  $node
     * @return list<string>
     */
    private function keysOf(array $node): array
    {
        $keys = [];
        foreach ($node as $key => $value) {
            if (is_string($key)) {
                $keys[] = $key;
            }
            if (is_array($value)) {
                array_push($keys, ...$this->keysOf($value));
            }
        }

        return $keys;
    }

    /** The PHP source with comments removed by the tokenizer (a regex would also eat code that follows a `//` inside a string or URL). */
    private function withoutComments(string $source): string
    {
        $code = '';
        foreach (token_get_all($source) as $token) {
            if (is_array($token)) {
                if ($token[0] === T_COMMENT || $token[0] === T_DOC_COMMENT) {
                    continue;
                }
                $code .= $token[1];
            } else {
                $code .= $token;
            }
        }

        return $code;
    }

    /** @test */
    public function no_commercial_key_survives_normalisation_in_any_scope(): void
    {
        $fixture = $this->fixture();
        $normalized = (new StorefrontPresentationNormalizer)->normalize($fixture['input']);
        $pattern = '/'.$fixture['forbiddenKeyPattern'].'/i';

        $offending = array_values(array_filter(array_unique($this->keysOf($normalized)), static fn (string $key): bool => preg_match($pattern, $key) === 1));
        $this->assertSame([], $offending, 'commercial keys leaked into the normalised presentation: '.implode(', ', $offending));

        $json = json_encode($normalized, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
        foreach ($fixture['forbiddenValues'] as $value) {
            $this->assertStringNotContainsString('"'.$value.'"', $json, "an injected commercial value is reachable: {$value}");
        }
    }

    /** @test */
    public function the_deny_pattern_matches_value_bearing_keys_and_never_an_allowed_presentation_control(): void
    {
        $fixture = $this->fixture();
        $pattern = '/'.$fixture['forbiddenKeyPattern'].'/i';

        foreach ($fixture['allowedKeys'] as $key) {
            $this->assertSame(0, preg_match($pattern, $key), "{$key} is an allowed presentation control but the deny pattern rejects it");
        }
        foreach (['price', 'salePrice', 'stockCount', 'shippingFee', 'offerStatus', 'grandTotal', 'unitPrice', 'taxAmount', 'shippingCost', 'checkoutTotal', 'subtotal'] as $key) {
            $this->assertSame(1, preg_match($pattern, $key), "{$key} must be denied");
        }
    }

    /** @test */
    public function the_legitimate_parts_of_the_hostile_document_still_normalise(): void
    {
        $normalized = (new StorefrontPresentationNormalizer)->normalize($this->fixture()['input']);
        $sections = $normalized['homepage']['sections'];

        $this->assertSame(['newArrivals', 'featured', 'offers', 'productShelf', 'hero', 'benefits', 'customContent'], array_column($sections, 'type'));
        $this->assertSame(['align' => 'center', 'imageRatio' => '1:1', 'imageFit' => 'contain', 'hover' => 'lift'], $sections[0]['design']['cards']);
        $this->assertSame(['offerIds' => ['o1'], 'showTitle' => false], $sections[2]['content']);

        // every scope the hostile document carried is still produced by the normaliser (the firewall strips keys, not scopes)
        foreach (['branding', 'header', 'footer', 'contact', 'whatsapp', 'social', 'verification', 'sbc', 'apps', 'navigation', 'pagePresentation', 'announcements', 'palette'] as $scope) {
            $this->assertArrayHasKey($scope, $normalized, "the {$scope} scope disappeared");
        }

        // ...and the nested, accepted items inside the variable-shape scopes were really processed (not merely replaced by defaults)
        $this->assertSame('x', $normalized['social'][0]['network']);
        $this->assertSame('nav-home', $normalized['header']['links'][0]['id']);
        $this->assertSame(['h', 'e'], array_column($normalized['navigation']['menus'][0]['items'], 'id'));
        $this->assertSame('a', $normalized['footer']['groups'][0]['links'][0]['id']);
        $this->assertSame('a', $normalized['announcements']['items'][0]['id']);
        $this->assertSame('price', $normalized['pagePresentation']['product']['regions'][0]['key']);
    }

    /** @test */
    public function the_presentation_layer_is_not_coupled_to_price_offer_cart_or_stock_services(): void
    {
        $root = dirname(__DIR__, 2).'/app/Support/Commerce';
        $files = array_merge(glob($root.'/Storefront*Normalizer.php') ?: [], glob($root.'/*Publish*.php') ?: [], glob($root.'/*Contrast.php') ?: []);
        $this->assertNotEmpty($files);

        // allow-list, not a deny-list: a presentation file may reference only its own namespace and these media / validation helpers
        // (none of which reads a price, offer, stock or tax value). Any other `App\...` reference — a model, a pricing / offer / cart
        // service, a ledger class — fails, whatever its name.
        $allowed = [
            'App\\Services\\Commerce\\StorefrontMediaTransform',
            'App\\Services\\Commerce\\StorefrontMediaPublishGate',
            'App\\Services\\Commerce\\StorefrontMediaContrastEvidence',
            'App\\Services\\Commerce\\PresentationPublishValidationException',
        ];

        foreach ($files as $file) {
            preg_match_all('/\bApp(?:\\\\[A-Za-z0-9_]+)+/', $this->withoutComments((string) file_get_contents($file)), $matches);
            foreach (array_unique($matches[0]) as $reference) {
                $this->assertTrue(
                    $reference === 'App\\Support\\Commerce' || str_starts_with($reference, 'App\\Support\\Commerce\\') || in_array($reference, $allowed, true),
                    basename($file)." references {$reference}, outside the presentation namespace and its allow-listed helpers",
                );
            }
        }
    }

    /** @test */
    public function the_commercial_services_do_not_read_the_presentation_layer(): void
    {
        $services = dirname(__DIR__, 2).'/app/Services/Commerce';
        foreach (['CommercePriceResolver.php', 'StorefrontOfferResolver.php', 'CommerceCartService.php', 'CommerceCheckoutService.php', 'CommerceOrderService.php'] as $name) {
            $source = (string) file_get_contents($services.'/'.$name);
            $this->assertStringNotContainsString('Support\\Commerce\\Storefront', $source, "{$name} must not depend on presentation normalisers");
            $this->assertStringNotContainsString('presentation', strtolower($this->withoutComments($source)), "{$name} must not read the presentation");
        }
    }
}
