<?php

namespace App\Http\Middleware;

use App\Models\Branch;
use App\Support\BranchSettings;
use App\Tenancy\BranchContext;
use App\Tenancy\BranchSharing;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/**
 * يضبط الفرع النشط للطلب: ترويسة `X-Branch-Id` إن كانت فرعاً يخصّ المستأجر
 * الحالي، وإلا **الفرع الرئيسي** من الإعدادات (الافتراضي المتّفق عليه).
 *
 * يعمل بعد `SetTenant` (يعتمد على عزل المستأجر للتحقّق). لا يمنع الطلب أبداً:
 * غياب الفروع يترك السياق فارغاً فتبقى المستندات بلا وسم — كسلوك ما قبل الفروع.
 */
class SetBranch
{
    public function __construct(protected BranchContext $branch, protected BranchSharing $sharing) {}

    public function handle(Request $request, Closure $next): Response
    {
        // مفاتيح المشاركة محفوظة في singleton — تُبطَل مع كل طلب فتُقرأ طازجة مرة واحدة.
        $this->sharing->forget();

        $requested = $request->header('X-Branch-Id');

        // ═══════════════════════════════════════════════════════════
        //  الشكل قبل الوجود: **لا يُستعلَم بقيمة ليست UUID**
        // ═══════════════════════════════════════════════════════════
        //  عمود `branches.id` من نوع `uuid`، وPostgreSQL يرفض أي نصّ آخر بـ
        //  `SQLSTATE[22P02]` — فترويسة واحدة مشوّهة كانت تُسقط **كل** طلب محمي
        //  بخطأ 500. حدث ذلك في الإنتاج فعلاً: متصفّح احتفظ بـ `br-1` من وضع
        //  المعاينة، فتعطّل الحساب كلّه. وهو أيضاً باب تعطيل خدمة مفتوح لأي
        //  عميل يرسل ترويسة عشوائية.
        //
        //  القيمة غير الصالحة تُتجاهَل بصمت كأنها لم تُرسَل — لا خطأ للمستخدم،
        //  لأنها ليست خطأه: تفضيلٌ قديمٌ في متصفّحه لا طلبٌ غير مشروع.
        //  (SQLite لا يتحقّق من النوع، ولذلك لم يكشفه أي اختبار قبل الإنتاج.)
        $user = $request->user();

        $valid = $requested
            && Str::isUuid($requested)
            // التحقّق يمرّ عبر TenantScope، فلا يمكن تمرير فرع مستأجر آخر.
            && Branch::whereKey($requested)->exists()
            // ولا فرعاً خارج نطاق المستخدم: الترويسة طلبٌ لا إذن.
            && (! $user || $user->canAccessBranch($requested));

        $branchId = $valid ? $requested : $this->defaultBranchFor($user);

        $this->branch->set($branchId ?: null);

        return $next($request);
    }

    /**
     * الفرع الافتراضي للمستخدم.
     *
     * المقيَّد بفروع لا يُوضع في الفرع الرئيسي إن لم يكن منها — وإلا عمل خارج
     * نطاقه بمجرّد ألّا يرسل ترويسة. فيُختار أوّل فروعه بترتيب الكود ليكون
     * الافتراض ثابتاً لا عشوائياً. وغير المقيَّد يبقى على الفرع الرئيسي كما كان.
     */
    private function defaultBranchFor(?object $user): ?string
    {
        $main = BranchSettings::current()['main_branch_id'];

        if (! $user || $user->canAccessBranch($main)) {
            return $main;
        }

        return Branch::whereIn('id', $user->allowedBranchIds() ?? [])
            ->orderBy('code')
            ->value('id');
    }
}
