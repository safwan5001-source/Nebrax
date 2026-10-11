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

        if (in_array($key, $fixture['selectorKeys'], true)) {
            return false;
        }

        // commerce CONTENT (product names / images, invented badges, urgency copy) is denied by word combination, whatever the value type
        foreach ($fixture['forbiddenWordSets'] as $set) {
            if (array_diff($set, $words) === []) {
                // ...unless it only positions / colours / sizes a REAL one (badgeTextColor, saleBadgePosition), and nothing hides or scales it
                return array_intersect($words, $fixture['hidingVerbs']) !== [] || ! in_array(end($words), $fixture['presentationSuffixes'], true);
            }
        }

        if (array_intersect($words, $fixture['commerceWords']) === []) {
            return false;
        }

        // a hiding / scaling verb anywhere in the key denies it, whatever its suffix (hidePricePosition, hideStockPlacement…)
        return array_intersect($words, $fixture['hidingVerbs']) !== [] || ! in_array(end($words), $fixture['presentationSuffixes'], true);
    }

    /**
     * @param  array<mixed>  $node
     * @param  array<string,mixed>  $fixture
     * @return list<string>
     */
    private function numericCommerceKeys(array $node, array $fixture): array
    {
        $found = [];
        foreach ($node as $key => $value) {
            if (is_string($key) && ! in_array($key, $fixture['selectorKeys'], true) && (is_int($value) || is_float($value) || is_bool($value) || (is_array($value) && array_filter($value, static fn ($v): bool => is_int($v) || is_float($v) || is_bool($v)) !== []))) {
                $words = array_map('strtolower', preg_split('/[\s_\-]+|(?<=[a-z0-9])(?=[A-Z])/', $key, -1, PREG_SPLIT_NO_EMPTY) ?: []);
                if (array_intersect($words, $fixture['commerceWords']) !== []) {
                    $found[] = $key;
                }
            }
            if (is_array($value)) {
                array_push($found, ...$this->numericCommerceKeys($value, $fixture));
            }
        }

        return $found;
    }

    /** @test */
    public function no_commercial_key_survives_normalisation_in_any_scope(): void
    {
        $fixture = $this->fixture();
        $normalized = (new StorefrontPresentationNormalizer)->normalize($fixture['input']);

        $offending = array_values(array_filter(array_unique($this->keysOf($normalized)), fn (string $key): bool => $this->denies($key, $fixture)));
        $this->assertSame([], $offending, 'commercial keys leaked into the normalised presentation: '.implode(', ', $offending));

        // value check for the suffix-exempt controls: a key that contains a commerce word never carries a number (V0 §14.3 schema assertion)
        $this->assertSame([], $this->numericCommerceKeys($normalized, $fixture), 'a commerce-named presentation key accepted a number or boolean');

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

        $this->assertSame(
            ['newArrivals', 'featured', 'offers', 'productShelf', 'hero', 'benefits', 'customContent', 'categories', 'wholesale', 'banner', 'appPromo', 'discovery', 'deliveryPromise', 'slider', 'gallery'],
            array_column($sections, 'type'),
            'every accepted homepage section type must be present in the hostile document and survive normalisation',
        );
        // the distinct normalisation branches really processed their (hostile) content rather than dropping it
        $byType = array_column($sections, null, 'type');
        $this->assertSame('خصم الصيف', $byType['banner']['content']['title']);
        $this->assertSame('color', $byType['discovery']['content']['dimension']);
        $this->assertSame('نوصل اليوم', $byType['deliveryPromise']['content']['body']);
        $this->assertSame('sl1', $byType['slider']['content']['slides'][0]['id']);
        $this->assertSame('g1', $byType['gallery']['content']['images'][0]['id']);
        // every custom-content block kind (and the nested column blocks) was processed, not dropped
        $kinds = array_column($byType['customContent']['content']['blocks'], 'kind');
        $this->assertSame(['heading', 'button', 'paragraph', 'image', 'divider', 'spacer', 'callout', 'columns'], $kinds);
        $columns = $byType['customContent']['content']['blocks'][7]['columns'];
        $this->assertSame(['heading', 'paragraph'], array_column($columns[0], 'kind'));
        $this->assertSame(['button', 'callout'], array_column($columns[1], 'kind'));
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
        // the hostile document tried to HIDE the required price region (`visible: false`): presentation data cannot hide authoritative price
        $this->assertTrue($normalized['pagePresentation']['product']['regions'][0]['visible']);
        // ...and the category document's required product grid (a separate branch) is forced visible too
        $this->assertSame('product_grid', $normalized['pagePresentation']['category']['regions'][0]['key']);
        $this->assertTrue($normalized['pagePresentation']['category']['regions'][0]['visible']);
    }

    /** @return list<string> */
    private function presentationFiles(): array
    {
        $root = dirname(__DIR__, 2).'/app/Support/Commerce';

        return array_merge(glob($root.'/Storefront*Normalizer.php') ?: [], glob($root.'/*Publish*.php') ?: [], glob($root.'/*Contrast.php') ?: []);
    }

    /**
     * Every model and service is a potential commerce-truth owner (deny-by-default on NAMES, not on a keyword list); so is any
     * App\Support\Commerce class that itself reaches into a model or service, directly or through another owner (fixed point), e.g.
     * DeliverTodayFilter → CommerceDeliveryPromiseService.
     *
     * @param  array<string,int>  $allowed  class short names that are NOT owners (the presentation layer and what it may call)
     * @return array<string,true>
     */
    private function commerceTruthOwners(array $allowed): array
    {
        $app = dirname(__DIR__, 2).'/app';
        $owners = [];
        foreach ([$app.'/Models', $app.'/Services'] as $dir) {
            foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS)) as $file) {
                if ($file->getExtension() === 'php' && ! isset($allowed[$file->getBasename('.php')])) {
                    $owners[$file->getBasename('.php')] = true;
                }
            }
        }
        // support-namespace classes: an owner when it reaches a model / service directly OR names another owner (fixed point = transitive)
        $support = [];
        foreach (glob($app.'/Support/Commerce/*.php') ?: [] as $file) {
            $name = basename($file, '.php');
            if (! isset($allowed[$name])) {
                $support[$name] = $this->withoutComments((string) file_get_contents($file));
            }
        }
        do {
            $grew = false;
            foreach ($support as $name => $code) {
                if (isset($owners[$name])) {
                    continue;
                }
                $reaches = preg_match('/\bApp\\\\(Models|Services)\\\\/', $code) === 1;
                foreach (array_keys($owners) as $owner) {
                    $reaches = $reaches || preg_match('/\b'.preg_quote($owner, '/').'\b/', $code) === 1;
                }
                if ($reaches) {
                    $owners[$name] = true;
                    $grew = true;
                }
            }
        } while ($grew);

        return $owners;
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

        $owners = $this->commerceTruthOwners($allowed);
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
    public function the_presentation_owning_services_name_no_commerce_truth_owner(): void
    {
        $services = dirname(__DIR__, 2).'/app/Services/Commerce';
        // the services that persist / publish / index the presentation document (draft → published path, versions, media references);
        // StorefrontVerticalSetupService is excluded because it SETS UP a store (creating its fulfilment policy), it does not persist presentation values
        $owning = [
            'StorefrontPresentationService', 'StorefrontPresentationVersionService', 'StorefrontPresentationVersionBackfillService',
            'ScheduledPresentationDispatcher', 'StorefrontMediaReferenceScanner', 'StorefrontPublishedMediaIndex',
        ];
        // what a presentation-owning service may legitimately name: its own models / helpers (no price, offer, stock, tax or shipping value)
        $presentationSide = [
            'Storefront', 'StorefrontPresentation', 'StorefrontPresentationVersion', 'StorefrontMedia', 'StorefrontMediaDerivative',
            'StorefrontPublishedMedia', 'StorefrontDomain', 'StorefrontBusinessProfile', 'Tenant', 'User', 'BaseModel',
            'PresentationDocumentTooLargeException', 'PresentationPublishValidationException', 'StorefrontMediaTransform',
            'StorefrontMediaPublishGate', 'StorefrontMediaContrastEvidence', 'ForwardSchemaVersionException', 'ActiveVersionImmutableException',
            // the draft / version lifecycle's own exceptions (they carry no price, offer, stock, tax or shipping value)
            'NothingToPublishException', 'StaleDraftRevisionException', 'StaleVersionRevisionException', 'StalePublicationHeadException',
            'VersionLifecycleConflictException', 'StaleScheduleTokenException', 'SourceVersionNotFoundException', 'InvalidScheduleTimeException',
        ];
        $allowed = array_flip(array_merge(
            $presentationSide,
            $owning,
            array_map(static fn (string $file): string => basename($file, '.php'), $this->presentationFiles()),
        ));
        $owners = $this->commerceTruthOwners($allowed);
        $violations = [];

        foreach ($owning as $name) {
            $this->assertFileExists("{$services}/{$name}.php");
            foreach (token_get_all((string) file_get_contents("{$services}/{$name}.php")) as $token) {
                if (! is_array($token) || ! in_array($token[0], [T_STRING, T_NAME_QUALIFIED, T_NAME_FULLY_QUALIFIED], true)) {
                    continue;
                }
                $short = ltrim(strrchr('\\'.$token[1], '\\'), '\\');
                if (isset($owners[$short])) {
                    $violations[$name.' → '.$short] = true;
                }
            }
        }

        $this->assertSame([], array_keys($violations), 'a presentation-owning service names a class that may own commerce truth');
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
            'StorefrontPresentationVersionService', 'StorefrontPublishedMediaIndex', 'StorefrontVerticalSetupService',
        ];
        // scanned for qualified presentation dependencies only: CommerceListingService's bare `$presentation` parameter is the listing's title /
        // description copy, and PosSettings' CATEGORY_PRESENTATION_* constants are the POS tile display modes (neither is the storefront document)
        $bareWordExempt = ['CommerceListingService', 'PosSettings'];
        $files = [$app.'/Services/PriceListService.php', $app.'/Services/ProductPricingService.php'];
        // ...and every service / support class the price and offer resolvers import (e.g. the partner price-list resolver, unit conversion):
        // a presentation lookup there would change the resolved price just as surely as one in the resolver itself
        $queue = [$app.'/Services/Commerce/CommercePriceResolver.php', $app.'/Services/Commerce/StorefrontOfferResolver.php', $app.'/Services/PriceListService.php', $app.'/Services/ProductPricingService.php'];
        $visited = [];
        while ($queue !== []) {
            $current = array_shift($queue);
            if (isset($visited[$current]) || ! is_file($current)) {
                continue;
            }
            $visited[$current] = true;
            $files[] = $current;
            // fixed point: follow the service / support imports of every file reached, not just the two roots
            preg_match_all('/^use (App\\\\(?:Services|Support)\\\\[A-Za-z0-9_\\\\]+);/m', (string) file_get_contents($current), $imports);
            foreach ($imports[1] as $import) {
                $queue[] = $app.'/'.str_replace('\\', '/', substr($import, 4)).'.php';
            }
        }
        $files = array_values(array_unique($files));
        foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($app.'/Services/Commerce', \FilesystemIterator::SKIP_DOTS)) as $file) {
            if ($file->getExtension() === 'php') {
                $files[] = $file->getPathname();
            }
        }
        $checked = 0;

        foreach ($files as $file) {
            $name = basename($file, '.php');
            if (in_array($name, $presentationSide, true)) {
                continue;
            }
            $checked++;
            $source = $this->withoutComments((string) file_get_contents($file));
            $this->assertStringNotContainsString('Support\\Commerce\\Storefront', $source, "{$name} must not depend on presentation normalisers");
            $this->assertStringNotContainsString('Commerce\\StorefrontPresentation', $source, "{$name} must not depend on the presentation services or models");
            $this->assertStringNotContainsString('Models\\StorefrontPresentation', $source, "{$name} must not read the presentation models");
            if (! in_array($name, $bareWordExempt, true)) {
                $this->assertStringNotContainsString('presentation', strtolower($source), "{$name} must not read the presentation");
            }
        }
        $this->assertGreaterThan(60, $checked, 'the scan must cover the commerce services broadly (sub-namespaces included), not a handful');
        foreach (['ShippingRateService', 'CommerceDeliveryPromiseService', 'InventoryReservationService', 'FulfillmentPolicyService', 'CommercePriceResolver', 'StorefrontOfferResolver', 'PosCustomerPriceListResolver', 'UnitConversion', 'PosSettings'] as $named) {
            $this->assertContains($named, array_map(static fn (string $f): string => basename($f, '.php'), $files), "{$named} must be in the scan");
        }
    }
}
