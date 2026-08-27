<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\AccountBalance;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * إدارة الحسابات المخصصة في دليل الحسابات.
 *
 * لا تنشئ هذه الخدمة قيوداً ولا تعدل القيود أو سطورها. دورها ضبط بنية الدليل
 * فقط؛ أما أي أثر مالي فيبقى حصراً داخل LedgerService.
 */
class AccountManagementService
{
    /**
     * ينشئ حساباً مخصصاً ويهيئ رصيده الصفري.
     *
     * @param array{code:string,name:string,name_en?:string|null,type:string,parent_id?:string|null,is_group:bool,is_active?:bool} $data
     */
    public function create(array $data): Account
    {
        try {
            return DB::transaction(function () use ($data) {
                $parent = $this->resolveParent($data['parent_id'] ?? null, $data['type']);

                $account = Account::create([
                    'parent_id'      => $parent?->id,
                    'code'           => $data['code'],
                    'name'           => $data['name'],
                    'name_en'        => $data['name_en'] ?? null,
                    'type'           => $data['type'],
                    'normal_balance' => $this->normalBalanceFor($data['type']),
                    'is_group'       => $data['is_group'],
                    'is_system'      => false,
                    'is_active'      => $data['is_active'] ?? true,
                ]);

                AccountBalance::firstOrCreate(
                    ['account_id' => $account->id],
                    ['balance' => 0, 'total_debit' => 0, 'total_credit' => 0]
                );

                return $account->load(['balance'])->loadCount('children');
            });
        } catch (QueryException $exception) {
            // تتحقق FormRequest في المسار العادي. يبقى القيد الفريد الحارس الأخير
            // عند وصول طلبي إنشاء متزامنين بالكود نفسه، فنحوّل التعارض إلى خطأ مجال
            // مفهوم بدل تسريب خطأ SQL أو جعله استجابة 500.
            if ($this->isDuplicateCodeViolation($exception)) {
                throw new RuntimeException('كود الحساب مستخدم بالفعل في دليل الحسابات. حدّث الكود وحاول مرة أخرى.');
            }

            throw $exception;
        }
    }

    /**
     * يقترح كوداً أولياً قابلاً للتحرير، ولا يفرض إعادة ترقيم أو قاعدة جديدة
     * على الأكواد القائمة. تعتمد الخوارزمية على أبناء الأب الفعلي لا على عددهم:
     * أكبر لاحقة رقمية تحت البادئة نفسها ثم التالي؛ لذلك لا تعيد استخدام كود بعد
     * حذف ابن ولا تفترض أن كل الأدلة التاريخية تستخدم طولاً أو تقسيمًا واحداً.
     */
    public function suggestNextCode(?string $parentId, string $type): string
    {
        $parent = $this->resolveParent($parentId, $type);

        if ($parent === null) {
            return $this->suggestRootCode();
        }

        $prefix = $parent->code;
        $pattern = '/^' . preg_quote($prefix, '/') . '(\d+)$/';
        $suffixes = Account::query()
            ->where('parent_id', $parent->id)
            ->pluck('code')
            ->map(function (string $code) use ($pattern): ?string {
                return preg_match($pattern, $code, $matches) === 1 ? $matches[1] : null;
            })
            ->filter(fn (?string $suffix) => $suffix !== null)
            ->values();

        // حين توجد أكواد قائمة نحافظ على طول لاحقتها؛ وعند عدم وجود ابن يبدأ
        // الاقتراح بقطاع 001 واضح قابل للتمديد من دون إعادة تفسير أي كود تاريخي.
        $width = $suffixes->isEmpty()
            ? 3
            : max(...$suffixes->map(fn (string $suffix) => strlen($suffix))->all());
        $next = $suffixes->isEmpty() ? 1 : ((int) $suffixes->map(fn (string $suffix) => (int) $suffix)->max() + 1);

        do {
            $candidate = $prefix . str_pad((string) $next, $width, '0', STR_PAD_LEFT);
            $next++;
        } while (Account::where('code', $candidate)->exists());

        return $candidate;
    }

    /**
     * يعدل حساباً مخصصاً فقط. الحسابات المزروعة من النظام ثابتة كي لا تنكسر
     * التكاملات التي تعتمد أكوادها، والحساب ذو الحركات لا يعاد ترقيمه أو تصنيفه.
     *
     * @param array{code:string,name:string,name_en?:string|null,type:string,parent_id?:string|null,is_group:bool,is_active?:bool} $data
     */
    public function update(Account $account, array $data): Account
    {
        if ($account->is_system) {
            throw new RuntimeException('لا يمكن تعديل حساب نظامي من دليل الحسابات. أنشئ حساباً مخصصاً تحته عند الحاجة.');
        }

        return DB::transaction(function () use ($account, $data) {
            $hasHistory = $account->lines()->exists();
            $parentId   = $data['parent_id'] ?? null;

            $this->assertNoCycle($account, $parentId);
            $parent = $this->resolveParent($parentId, $data['type']);

            if ($hasHistory && $data['code'] !== $account->code) {
                throw new RuntimeException('لا يمكن تغيير كود حساب له حركات مالية. أنشئ حساباً جديداً للحركات المستقبلية.');
            }

            if ($hasHistory && $data['type'] !== $account->type) {
                throw new RuntimeException('لا يمكن تغيير نوع حساب له حركات مالية. أنشئ حساباً جديداً للطبيعة المطلوبة.');
            }

            if ($hasHistory && $parentId !== $account->parent_id) {
                throw new RuntimeException('لا يمكن نقل حساب له حركات مالية إلى أب آخر. أنشئ حساباً جديداً للحركات المستقبلية.');
            }

            if ($data['type'] !== $account->type) {
                throw new RuntimeException('لا يمكن تغيير نوع حساب قائم. أنشئ حساباً جديداً بالطبيعة المطلوبة.');
            }

            if (! $data['is_group'] && $account->children()->exists()) {
                throw new RuntimeException('لا يمكن تحويل حساب يحتوي حسابات فرعية إلى حساب غير تجميعي.');
            }

            $isActive = array_key_exists('is_active', $data) ? $data['is_active'] : $account->is_active;
            if (! $isActive && $account->children()->where('is_active', true)->exists()) {
                throw new RuntimeException('لا يمكن تعطيل حساب يحتوي حسابات فرعية مفعلة. عطّل الفروع أولاً.');
            }

            $account->update([
                'parent_id' => $parent?->id,
                'code'      => $data['code'],
                'name'      => $data['name'],
                'name_en'   => $data['name_en'] ?? null,
                'is_group'  => $data['is_group'],
                'is_active' => $isActive,
            ]);

            return $account->fresh()->load(['balance'])->loadCount('children');
        });
    }

    private function suggestRootCode(): string
    {
        $codes = Account::query()
            ->whereNull('parent_id')
            ->pluck('code')
            ->filter(fn (string $code) => ctype_digit($code));

        $next = $codes->isEmpty() ? 1 : ((int) $codes->map(fn (string $code) => (int) $code)->max() + 1);

        do {
            $candidate = (string) $next;
            $next++;
        } while (Account::where('code', $candidate)->exists());

        return $candidate;
    }

    private function resolveParent(?string $parentId, string $type): ?Account
    {
        if ($parentId === null) {
            return null;
        }

        $parent = Account::find($parentId);
        if ($parent === null) {
            throw new RuntimeException('الحساب الأب غير موجود.');
        }

        if (! $parent->is_group) {
            throw new RuntimeException('الحساب الأب يجب أن يكون حساباً تجميعياً.');
        }

        if (! $parent->is_active) {
            throw new RuntimeException('لا يمكن إضافة حساب تحت حساب أب غير مفعّل.');
        }

        if ($parent->type !== $type) {
            throw new RuntimeException('يجب أن تتطابق طبيعة الحساب مع طبيعة الحساب الأب.');
        }

        return $parent;
    }

    private function assertNoCycle(Account $account, ?string $parentId): void
    {
        $seen = [];

        while ($parentId !== null) {
            if ($parentId === $account->id) {
                throw new RuntimeException('لا يمكن جعل الحساب تابعاً لنفسه أو لأحد حساباته الفرعية.');
            }

            if (isset($seen[$parentId])) {
                throw new RuntimeException('تعذر حفظ البنية لأن شجرة الحسابات تحتوي دورة قائمة.');
            }
            $seen[$parentId] = true;

            $parentId = Account::whereKey($parentId)->value('parent_id');
        }
    }

    private function normalBalanceFor(string $type): string
    {
        return in_array($type, ['asset', 'expense'], true) ? 'debit' : 'credit';
    }

    private function isDuplicateCodeViolation(QueryException $exception): bool
    {
        return in_array((string) $exception->getCode(), ['23000', '23505'], true)
            && str_contains($exception->getMessage(), 'accounts');
    }
}
