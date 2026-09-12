<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/**
 * COM-7-HOTFIX — production assemble must register the store/v1 catalog.
 *
 * CI already copies routes/api_storefront.php and registers
 * StorefrontApiServiceProvider (setup.sh / ci.yml). Production Docker uses
 * deploy/assemble.sh, which historically omitted both. This test fails if
 * the provider is not loaded in the running application.
 */
class StorefrontRoutesRegisteredTest extends TestCase
{
    /** @test */
    public function production_storefront_catalog_routes_are_registered(): void
    {
        $this->assertTrue(
            Route::has('storefront.v1.storefront.show'),
            'GET store/v1/storefront is not registered',
        );
        $this->assertTrue(
            Route::has('storefront.v1.products.index'),
            'GET store/v1/products is not registered',
        );
        $this->assertTrue(
            Route::has('storefront.v1.categories.index'),
            'GET store/v1/categories is not registered',
        );
    }

    /** @test */
    public function production_assemble_script_copies_and_registers_the_storefront_api(): void
    {
        $assemble = file_get_contents(base_path('../deploy/assemble.sh'));
        if ($assemble === false) {
            $assemble = file_get_contents(dirname(__DIR__, 2).'/deploy/assemble.sh');
        }

        $this->assertIsString($assemble);
        $this->assertStringContainsString(
            'routes/api_storefront.php',
            $assemble,
            'deploy/assemble.sh must copy routes/api_storefront.php',
        );
        $this->assertStringContainsString(
            'StorefrontApiServiceProvider',
            $assemble,
            'deploy/assemble.sh must register StorefrontApiServiceProvider',
        );
    }
}
