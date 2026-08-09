<?php

namespace App\Http\Middleware;

use App\Models\Branch;
use App\Support\BranchSettings;
use App\Tenancy\BranchContext;
use App\Tenancy\BranchSharing;
use Closure;
use Illuminate\Http\Request;
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

        // التحقّق يمرّ عبر TenantScope، فلا يمكن تمرير فرع مستأجر آخر.
        $branchId = $requested && Branch::whereKey($requested)->exists()
            ? $requested
            : BranchSettings::current()['main_branch_id'];

        $this->branch->set($branchId ?: null);

        return $next($request);
    }
}
