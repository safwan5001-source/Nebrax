<?php

namespace Tests\Feature;

use Tests\TestCase;

/**
 * FUEL-LOCK-ORDER-2 — حارس ساكن (يعمل على SQLite أيضاً): كل مسار يكتب حالة تكلفة الوقود غير ERP يأخذ مِرساة المستأجر (`lockLedgerAnchor`) **قبل** أي قفل مجمّع.
 * يثبّت الترتيب في المصدر؛ إثبات عدم الجمود الفعلي في `FuelLockOrder2PostgresTest`. مسار ERP نفسه (`FuelSaleService`) يأخذ المِرساة عبر `InvoiceService::post` قبل رد التكلفة.
 */
class FuelLockOrder2StaticTest extends TestCase
{
    /** @return array<string, array{0:string, 1:list<string>}> */
    public static function paths(): array
    {
        return [
            'delivery approval' => ['Services/FuelSupplyReceivingService.php', ['costBasis->assertReady(']],
            'reconciliation approval' => ['Services/FuelReconciliationService.php', ['lockBookStock(', 'costBasis->quoteGain(', 'costBasis->quoteIssue(']],
            'opening balance post' => ['Services/FuelOpeningBalanceService.php', ['costBasis->assertReady(']],
        ];
    }

    /** @dataProvider paths */
    public function test_the_anchor_is_taken_before_any_pool_lock(string $file, array $poolCalls): void
    {
        $code = (string) file_get_contents(app_path($file));
        $anchor = strpos($code, 'lockLedgerAnchor()');
        $this->assertNotFalse($anchor, "{$file}: لا يأخذ المِرساة مبكراً");
        foreach ($poolCalls as $call) {
            $first = strpos($code, $call);
            $this->assertNotFalse($first, "{$file}: {$call}");
            $this->assertLessThan($first, $anchor, "{$file}: المِرساة يجب أن تسبق {$call}");
        }
    }

    public function test_the_guard_exposes_the_same_anchor_lock_ledger_uses(): void
    {
        $guard = (string) file_get_contents(app_path('Services/Accounting/AccountingDateGuard.php'));
        $this->assertStringContainsString('public function lockLedgerAnchor(): void', $guard);
        // نفس القفل الخاص بالمِرساة: صف المستأجر FOR UPDATE عبر lockAnchor، لا قفل ثانٍ.
        $this->assertSame(2, substr_count($guard, '$this->lockAnchor('), 'استدعاءان فقط: activeLockFor والمبكّر');
    }
}
