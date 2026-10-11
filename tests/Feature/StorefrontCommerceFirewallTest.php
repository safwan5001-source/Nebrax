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

    /**
     * The deny rule shared with the TS suites (see the fixture note): split the key into lower-cased words; denied when any word is a commerce
     * word and the LAST word is not a presentation suffix (position / role / size / shape / placement of real data, or an id selector).
     *
     * @param  array<string,mixed>  $fixture
     */
    private function denies(string $key, array $fixture): bool
    {
        $words = array_map('strtolower', preg_split('/[\s_\-]+|(?<=[a-z0-9])(?=[A-Z])/', $key, -1, PREG_SPLIT_NO_EMPTY) ?: []);

        return array_intersect($words, $fixture['commerceWords']) !== [] && ! in_array(end($words), $fixture['presentationSuffixes'], true);
    }

    /** @test */
    public function no_commercial_key_survives_normalisation_in_any_scope(): void
    {
        $fixture = $this->fixture();
        $normalized = (new StorefrontPresentationNormalizer)->normalize($fixture['input']);

        $offending = array_values(array_filter(array_unique($this->keysOf($normalized)), fn (string $key): bool => $this->denies($key, $fixture)));
        $this->assertSame([], $offending, 'commercial keys leaked into the normalised presentation: '.implode(', ', $offending));

        $json = json_encode($normalized, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
        foreach ($fixture['forbiddenValues'] as $value) {
            $this->assertStringNotContainsString('"'.$value.'"', $json, "an injected commercial value is reachable: {$value}");
        }
    }

    /** @test */
    public function the_deny_rule_rejects_value_bearing_scaling_and_hiding_keys_and_never_an_allowed_presentation_control(): void
    {
        $fixture = $this->fixture();

        foreach ($fixture['allowedKeys'] as $key) {
            $this->assertFalse($this->denies($key, $fixture), "{$key} is an allowed presentation control but the deny rule rejects it");
        }
        foreach ($fixture['deniedKeys'] as $key) {
            $this->assertTrue($this->denies($key, $fixture), "{$key} must be denied");
        }
        // control: the raw hostile document carries many denied keys, so the scan can see them
        $this->assertGreaterThanOrEqual(10, count(array_filter(array_unique($this->keysOf($fixture['input'])), fn (string $key): bool => $this->denies($key, $fixture))));
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

    /** @return list<string> */
    private function presentationFiles(): array
    {
        $root = dirname(__DIR__, 2).'/app/Support/Commerce';

        return array_merge(glob($root.'/Storefront*Normalizer.php') ?: [], glob($root.'/*Publish*.php') ?: [], glob($root.'/*Contrast.php') ?: []);
    }

    /** @test */
    public function the_presentation_layer_names_no_class_that_owns_commerce_truth(): void
    {
        $app = dirname(__DIR__, 2).'/app';
        $files = $this->presentationFiles();
        $this->assertNotEmpty($files);

        // the presentation layer's own classes and the media / validation helpers it is allowed to call (none reads a price, offer, stock or tax value)
        $presentation = array_map(static fn (string $file): string => basename($file, '.php'), $files);
        $helpers = ['StorefrontMediaTransform', 'StorefrontMediaPublishGate', 'StorefrontMediaContrastEvidence', 'PresentationPublishValidationException'];
        $allowed = array_flip(array_merge($presentation, $helpers));

        // every model and service is a potential commerce-truth owner (deny-by-default on NAMES, not on a keyword list); so is any
        // App\Support\Commerce class that itself reaches into a model or service (e.g. DeliverTodayFilter → CommerceDeliveryPromiseService)
        $owners = [];
        foreach ([$app.'/Models', $app.'/Services'] as $dir) {
            foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS)) as $file) {
                if ($file->getExtension() === 'php' && ! isset($allowed[$file->getBasename('.php')])) {
                    $owners[$file->getBasename('.php')] = true;
                }
            }
        }
        foreach (glob($app.'/Support/Commerce/*.php') ?: [] as $file) {
            $name = basename($file, '.php');
            if (! isset($allowed[$name]) && preg_match('/\\bApp\\\\(Models|Services)\\\\/', $this->withoutComments((string) file_get_contents($file))) === 1) {
                $owners[$name] = true;
            }
        }
        $this->assertArrayHasKey('DeliverTodayFilter', $owners, 'control: the known commerce reader inside the support namespace is detected');

        foreach ($files as $file) {
            foreach (token_get_all((string) file_get_contents($file)) as $token) {
                if (! is_array($token) || ! in_array($token[0], [T_STRING, T_NAME_QUALIFIED, T_NAME_FULLY_QUALIFIED], true)) {
                    continue;
                }
                $short = ltrim(strrchr('\\'.$token[1], '\\'), '\\');
                $this->assertArrayNotHasKey($short, $owners, basename($file)." names {$token[1]}, a class outside the presentation layer (it may own price, offer, stock, tax or shipping truth)");
            }
        }
    }

    /** @test */
    public function the_commercial_services_do_not_read_the_presentation_layer(): void
    {
        $app = dirname(__DIR__, 2).'/app';

        // every service in the commerce namespace (price, offer, cart, checkout, order, inventory, delivery, shipping, tax, payment…) plus the
        // two pricing services that live outside it — EXCEPT the services whose job is the presentation itself (their own versions, publishing,
        // media references) and CommerceListingService, whose `$presentation` parameter is the product listing's title / description copy.
        $presentationSide = [
            'PresentationDocumentTooLargeException', 'PresentationPublishValidationException', 'ScheduledPresentationDispatcher',
            'StorefrontMediaReferenceScanner', 'StorefrontPresentationService', 'StorefrontPresentationVersionBackfillService',
            'StorefrontPresentationVersionService', 'StorefrontPublishedMediaIndex', 'StorefrontVerticalSetupService', 'CommerceListingService',
        ];
        $files = array_merge(glob($app.'/Services/Commerce/*.php') ?: [], [$app.'/Services/PriceListService.php', $app.'/Services/ProductPricingService.php']);
        $checked = 0;

        foreach ($files as $file) {
            $name = basename($file, '.php');
            if (in_array($name, $presentationSide, true)) {
                continue;
            }
            $checked++;
            $source = $this->withoutComments((string) file_get_contents($file));
            $this->assertStringNotContainsString('Support\\Commerce\\Storefront', $source, "{$name} must not depend on presentation normalisers");
            $this->assertStringNotContainsString('presentation', strtolower($source), "{$name} must not read the presentation");
        }
        $this->assertGreaterThan(60, $checked, 'the scan must cover the commerce services broadly, not a handful');
        foreach (['ShippingRateService', 'CommerceDeliveryPromiseService', 'InventoryReservationService', 'FulfillmentPolicyService', 'CommercePriceResolver', 'StorefrontOfferResolver'] as $named) {
            $this->assertContains($named, array_map(static fn (string $f): string => basename($f, '.php'), $files), "{$named} must be in the scan");
        }
    }
}
