<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/**
 * COM-7-HOTFIX — store/v1 catalog routes must be registered.
 *
 * Fails if StorefrontApiServiceProvider is not loaded or
 * routes/api_storefront.php is missing from the running application.
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
}
