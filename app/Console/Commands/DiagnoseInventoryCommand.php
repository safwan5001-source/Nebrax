<?php

namespace App\Console\Commands;

use App\Models\Account;
use App\Models\Product;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Support\Money;
use App\Tenancy\BranchScope;
use App\Tenancy\TenantContext;
use Illuminate\Console\Command;

/**
 * ═══════════════════════════════════════════════════════════════
 *  تشخيص المخزون — **قراءة فقط، لا يكتب حرفاً**
 * ═══════════════════════════════════════════════════════════════
 *  مسار البيع لا يفحص توفّر الكمية، فبيع ما ليس موجوداً يُنزل
 *  `quantity_on_hand` إلى سالب. وأثره مزدوج:
 *
 *   1. حساب المراقبة **1140 يصير برصيد دائن** — ميزانية تعرض مخزوناً سالباً،
 *      وهو مستحيل واقعياً.
 *   2. **المتوسط المتحرك يُفسَد بعده**: أي شراء لاحق يقسم الوارد على قاعدة
 *      سالبة، فيخرج متوسطٌ مضخّم — وكل قيد تكلفة بضاعة مباعة بعده خاطئ.
 *      (قياس: كمية −٧ ثم شراء ١٠ بـ٢٠٠ ريال ⇒ المتوسط ٤٣٣٫٣٣ لا ٢٠٠.)
 *
 *  ولذلك يعرض التقرير مجموعتين: ما هو سالب **الآن**، وما سلب **في وقت ما**
 *  وإن عاد موجباً — لأن متوسط الثاني قد يكون مُفسَداً بلا أثرٍ ظاهر.
 *
 *  الأمر لا يصلح شيئاً عمداً: التصحيح قرار محاسبي (إذن تسوية؟ جرد؟ قيد عكسي؟)
 *  لا يُتّخذ آلياً على بيانات إنتاج.
 *
 *  تشغيل: php artisan inventory:diagnose
 */
class DiagnoseInventoryCommand extends Command
{
    protected $signature = 'inventory:diagnose {--tenant= : تشخيص مستأجر واحد بمعرّفه}';

    protected $description = 'تقرير قراءة فقط عن المخزون السالب وأثره على حساب 1140 والمتوسط المتحرك';

    public function handle(): int
    {
        $tenants = $this->option('tenant')
            ? Tenant::whereKey($this->option('tenant'))->get()
            : Tenant::orderBy('name')->get();

        if ($tenants->isEmpty()) {
            $this->warn('لا مستأجرين للتشخيص.');

            return self::SUCCESS;
        }

        $anyProblem = false;

        foreach ($tenants as $tenant) {
            app(TenantContext::class)->set($tenant->id);
            $anyProblem = $this->reportTenant($tenant) || $anyProblem;
        }

        app(TenantContext::class)->forget();

        $this->newLine();
        $this->line($anyProblem
            ? '⚠  وُجد مخزون سالب. التصحيح قرار محاسبي — لم يُغيَّر شيء.'
            : '✓  لا مخزون سالب في أي مستأجر.');

        return self::SUCCESS;
    }

    /** @return bool هل وُجدت مشكلة لدى هذا المستأجر؟ */
    private function reportTenant(Tenant $tenant): bool
    {
        $products = Product::withoutGlobalScope(BranchScope::class)
            ->where('track_inventory', true)->get();

        $negative = $products->filter(fn (Product $p) => $p->quantity_on_hand < 0);

        // سلب في وقت ما وإن عاد موجباً — متوسطه قد يكون مُفسَداً بلا أثرٍ ظاهر.
        $everNegativeIds = StockMovement::withoutGlobalScope(BranchScope::class)
            ->where('balance_quantity', '<', 0)
            ->distinct()->pluck('product_id');

        $recovered = $products->filter(
            fn (Product $p) => $p->quantity_on_hand >= 0 && $everNegativeIds->contains($p->id)
        );

        $subsidiary = (int) $products->sum(fn (Product $p) => $p->quantity_on_hand * $p->avg_cost);
        $ledger     = (int) (Account::where('code', '1140')->first()?->balance?->balance ?? 0);

        $this->newLine();
        $this->line("── {$tenant->name} ──");

        if ($negative->isEmpty() && $recovered->isEmpty() && $subsidiary === $ledger) {
            $this->line('   ✓ سليم.');

            return false;
        }

        if ($negative->isNotEmpty()) {
            $this->newLine();
            $this->line('   أصناف سالبة الآن:');
            $this->table(
                ['الرمز', 'الصنف', 'الكمية', 'متوسط التكلفة', 'القيمة'],
                $negative->map(fn (Product $p) => [
                    $p->sku,
                    $p->name,
                    $p->quantity_on_hand,
                    Money::toRiyal($p->avg_cost),
                    Money::toRiyal($p->quantity_on_hand * $p->avg_cost),
                ])->all()
            );
        }

        if ($recovered->isNotEmpty()) {
            $this->newLine();
            $this->line('   أصناف سلبت سابقاً ثم عادت موجبة — **متوسطها مشكوك فيه**:');
            $this->table(
                ['الرمز', 'الصنف', 'الكمية', 'متوسط التكلفة'],
                $recovered->map(fn (Product $p) => [
                    $p->sku, $p->name, $p->quantity_on_hand, Money::toRiyal($p->avg_cost),
                ])->all()
            );
        }

        // الثابت: رصيد 1140 يجب أن يساوي Σ(كمية × متوسط) بلا فارق هللة.
        $this->newLine();
        $this->line('   حساب 1140 المخزون:      ' . Money::toRiyal($ledger));
        $this->line('   Σ(كمية × متوسط تكلفة):  ' . Money::toRiyal($subsidiary));

        if ($subsidiary !== $ledger) {
            $this->line('   ⚠ الفارق: ' . Money::toRiyal($ledger - $subsidiary)
                . ' — الدفتر العام منفصل عن دفتر المخزون المساعد.');
        } else {
            $this->line('   ✓ الدفتران متطابقان (وإن كان الرقم نفسه سالباً).');
        }

        return true;
    }
}
