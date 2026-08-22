<?php

namespace Tests\Feature;

use App\Services\ApplicationOperationClassifier;
use App\Support\ApplicationOperationClass;
use Illuminate\Http\Request;
use Illuminate\Routing\Route;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

class ApplicationOperationClassifierTest extends TestCase
{
    #[Test]
    #[DataProvider('verifiedReadActions')]
    public function verified_read_actions_are_classified_as_read(string $action): void
    {
        $this->assertSame(ApplicationOperationClass::READ, $this->classify($action));
    }

    public static function verifiedReadActions(): array
    {
        return array_map(fn (string $action) => [$action], [
            'products', 'heldSales', 'returnableInvoice', 'returnableInvoices',
            'report', 'cashMovements', 'events',
            'accounting', 'inventory', 'payments', 'notes', 'zatca',
            'indexAttachments', 'indexContracts', 'indexLeaveRequests', 'indexRequests',
            'leaveBalances', 'showPhoto', 'movements',
            'profile', 'contract', 'payrollItems', 'attendances', 'stock',
        ]);
    }

    #[Test]
    public function known_transition_and_destructive_actions_keep_their_existing_semantics(): void
    {
        $this->assertSame(ApplicationOperationClass::TRANSITION, $this->classify('post'));
        $this->assertSame(ApplicationOperationClass::TRANSITION, $this->classify('checkout'));
        $this->assertSame(ApplicationOperationClass::DESTRUCTIVE, $this->classify('destroy'));
    }

    #[Test]
    public function attachment_downloads_are_explicit_exports(): void
    {
        $this->assertSame(ApplicationOperationClass::EXPORT, $this->classify('downloadAttachment'));
        $this->assertSame(ApplicationOperationClass::EXPORT, $this->classify('downloadNoteAttachment'));
    }

    #[Test]
    public function unknown_actions_fail_conservative_as_write_even_over_get(): void
    {
        $this->assertSame(ApplicationOperationClass::WRITE, $this->classify('futureReadEndpoint', 'GET'));
    }

    private function classify(string $action, string $httpMethod = 'GET'): ApplicationOperationClass
    {
        $request = Request::create('/test', $httpMethod);
        $route = new Route([$httpMethod], '/test', [
            'uses' => 'TestController@'.$action,
            'controller' => 'TestController@'.$action,
        ]);
        $request->setRouteResolver(fn () => $route);

        return app(ApplicationOperationClassifier::class)->classify($request);
    }
}
