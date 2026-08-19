<?php

namespace App\Console\Commands;

use App\Models\Account;
use App\Models\AccountBalance;
use App\Models\Tenant;
use App\Tenancy\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * يضيف بيانات عرض وتجربة إلى دليل حسابات مستأجر محدد.
 *
 * لا ينشئ أي قيد يومية ولا يغيّر رصيداً أو حساباً قائماً؛ يضيف فقط حسابات مخصصة
 * معلّمة بوضوح تحت مجموعات المصروفات القائمة. الأمر مقيد بخيار tenant كي لا يلمس كل المستأجرين.
 */
class SeedChartOfAccountsDemoCommand extends Command
{
    protected $signature = 'accounts:seed-demo {--tenant= : معرّف المستأجر المستهدف (إلزامي)}';

    protected $description = 'إضافة حسابات اختبار واضحة تحت مجموعات المصروفات لمستأجر واحد';

    public function handle(): int
    {
        $tenantId = $this->option('tenant');
        if (! is_string($tenantId) || $tenantId === '') {
            $this->error('مرّر --tenant=<UUID> لتحديد المستأجر. لم يُغيَّر شيء.');

            return self::FAILURE;
        }

        $tenant = Tenant::find($tenantId);
        if ($tenant === null) {
            $this->error('المستأجر المطلوب غير موجود. لم يُغيَّر شيء.');

            return self::FAILURE;
        }

        app(TenantContext::class)->set($tenant->id);

        try {
            $accounts = DB::transaction(function (): array {
                $expenses = Account::where('code', '5')->first();
                if ($expenses === null || ! $expenses->is_group || $expenses->type !== 'expense') {
                    throw new RuntimeException('لم يُعثر على الحساب التجميعي 5 للمصروفات بالشكل المتوقع.');
                }

                $groups = [
                    ['51', 'تكلفة المبيعات — بيانات اختبار', 'Cost of Sales — Test Data'],
                    ['52', 'مصروفات إدارية وعمومية — بيانات اختبار', 'Administrative Expenses — Test Data'],
                    ['53', 'مصروفات الإهلاك — بيانات اختبار', 'Depreciation Expenses — Test Data'],
                    ['54', 'مصروفات أخرى — بيانات اختبار', 'Other Expenses — Test Data'],
                    ['55', 'مصاريف الدفع — بيانات اختبار', 'Payment Fees — Test Data'],
                ];

                $createdGroups = [];
                foreach ($groups as [$code, $name, $nameEn]) {
                    $createdGroups[$code] = $this->ensureAccount($expenses, $code, $name, $nameEn, true);
                }

                $leaves = [
                    ['5190', 'اختبار: تكلفة مباشرة', 'Test: Direct Cost', '51'],
                    ['5290', 'اختبار: مصروف تشغيلي', 'Test: Operating Expense', '52'],
                    ['5390', 'اختبار: إهلاك تشغيلي', 'Test: Operating Depreciation', '53'],
                    ['5490', 'اختبار: تسوية أخرى', 'Test: Other Adjustment', '54'],
                    ['5590', 'اختبار: رسوم دفع', 'Test: Payment Fee', '55'],
                ];

                $createdLeaves = [];
                foreach ($leaves as [$code, $name, $nameEn, $parentCode]) {
                    $createdLeaves[] = $this->ensureAccount($createdGroups[$parentCode], $code, $name, $nameEn, false);
                }

                return $createdLeaves;
            });

            $this->info("أُعدّت " . count($accounts) . " حسابات اختبار في دليل {$tenant->name}.");
            $this->line('لم يُنشأ أي قيد يومية، وجميع الأرصدة المضافة صفرية.');

            return self::SUCCESS;
        } catch (RuntimeException $exception) {
            $this->error($exception->getMessage());

            return self::FAILURE;
        } finally {
            app(TenantContext::class)->forget();
        }
    }

    private function ensureAccount(Account $parent, string $code, string $name, string $nameEn, bool $isGroup): Account
    {
        $account = Account::where('code', $code)->first();

        if ($account !== null) {
            if ($account->parent_id !== $parent->id || $account->type !== 'expense' || $account->is_group !== $isGroup) {
                throw new RuntimeException("الحساب {$code} موجود ببنية مختلفة؛ لم يُعدّله الأمر حفاظاً على البيانات القائمة.");
            }

            return $account;
        }

        $account = Account::create([
            'parent_id'      => $parent->id,
            'code'           => $code,
            'name'           => $name,
            'name_en'        => $nameEn,
            'type'           => 'expense',
            'normal_balance' => 'debit',
            'is_group'       => $isGroup,
            'is_system'      => false,
            'is_active'      => true,
        ]);

        AccountBalance::firstOrCreate(
            ['account_id' => $account->id],
            ['balance' => 0, 'total_debit' => 0, 'total_credit' => 0]
        );

        return $account;
    }
}
