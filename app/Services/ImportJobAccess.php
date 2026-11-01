<?php

namespace App\Services;

use App\Http\Middleware\EnsureApplicationActive;
use App\Support\ImportJobDomain;
use App\Support\Rbac;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * تفويض تشغيلات الاستيراد الدائم **حسب المجال** (IMP-H1-S1).
 *
 * كانت مسارات `/import-jobs` كلها مقيَّدة بـ`products.view|manage` فقط، فيرث أي مجال (مثل
 * `inventory_opening`) صلاحيات المنتجات ولا يخضع لقدرته (`inventory.core`) التي تفرضها واجهته المباشرة.
 * هنا بوابات المجال الفعلية (`ImportJobDomain::authorization`):
 *   ١. صلاحية RBAC — نفس فحص `EnsurePermission` ورسالته.
 *   ٢. قدرة التطبيق — **نفس** `EnsureApplicationActive::authorize` (لا نسخة ثانية من القواعد):
 *      `suspended` قراءة فقط، و`disabled` ممنوعة، والإنفاذ التجاري والمراقبة الظلية محفوظان.
 * الترتيب كما في المسارات الثابتة: صلاحية ثم قدرة.
 */
class ImportJobAccess
{
    public function __construct(private readonly EnsureApplicationActive $applications) {}

    /** عرض تشغيلة (GET): صلاحية العرض + القدرة (المعلّقة تسمح بالقراءة). */
    public function assertView(Request $request, string $domain): void
    {
        $this->assert($request, $domain, 'view');
    }

    /** إنشاء/ترحيل/إلغاء تشغيلة: صلاحية الإدارة + القدرة (المعلّقة تمنع الكتابة). */
    public function assertManage(Request $request, string $domain): void
    {
        $this->assert($request, $domain, 'manage');
    }

    /**
     * فرع التشغيلة ثابت (IMP-H1-S3a): من لا يملك نطاق الفرع الذي أُنشئت فيه التشغيلة لا يرحّلها ولا يلغيها (403)،
     * ولو كان فرعه النشط الآن فرعاً آخر. تشغيلة بلا فرع (قديمة) لا قيد عليها.
     */
    public function assertJobBranch(Request $request, ?string $jobBranchId): void
    {
        if ($jobBranchId === null) {
            return;
        }

        $user = $request->user();
        if ($user !== null && ! $user->canAccessBranch($jobBranchId)) {
            abort(403, 'هذه التشغيلة أُنشئت في فرعٍ خارج نطاق صلاحياتك.');
        }
    }

    /**
     * أرضيةٌ **قبل** البحث عن التشغيلة: يملك المستخدم صلاحية عرض (أو إدارة) مجالٍ واحد على الأقل. فمن لا يملك أي
     * صلاحية استيراد يحصل على 403 ثابت ولا يميّز بين معرّفٍ موجود وغير موجود (404)، وتبقى البوابة الفعلية
     * **لمجال التشغيلة** بعد البحث. الاتحاد لا الاستثناء: مستخدمٌ بصلاحية مشتريات فقط لا يُحجب بصلاحيات المنتجات.
     */
    public function assertViewAny(Request $request): void
    {
        $this->assertAny($request, 'view');
    }

    public function assertManageAny(Request $request): void
    {
        $this->assertAny($request, 'manage');
    }

    /**
     * المجالات التي يجوز لهذا المستخدم **عرضها** الآن — لتصفية القائمة بلا 403. تستعمل البوابة
     * نفسها (فلا تظهر تشغيلات مجالٍ لا يملك المستخدم صلاحيته أو قدرته معطّلة).
     *
     * @return list<string>
     */
    public function viewableDomains(Request $request): array
    {
        $allowed = [];
        foreach (ImportJobDomain::values() as $domain) {
            try {
                $this->assertView($request, $domain);
                $allowed[] = $domain;
            } catch (HttpException $e) {
                if ($e->getStatusCode() !== 403) {
                    throw $e;
                }
            }
        }

        return $allowed;
    }

    private function assertAny(Request $request, string $level): void
    {
        $user = $request->user();
        if ($user) {
            foreach (ImportJobDomain::values() as $domain) {
                if (Rbac::allows((string) $user->role, ImportJobDomain::authorization($domain)[$level])) {
                    return;
                }
            }
        }

        abort(403, 'ليس لديك صلاحية لتنفيذ هذا الإجراء.');
    }

    private function assert(Request $request, string $domain, string $level): void
    {
        try {
            $gates = ImportJobDomain::authorization($domain);
        } catch (\InvalidArgumentException) {
            // تشغيلة بمجال غير معلن (بيانات قديمة/تالفة): فشل مغلق بـ403 لا 500.
            abort(403, 'مجال الاستيراد غير مدعوم.');
        }

        $user = $request->user();
        if (! $user || ! Rbac::allows((string) $user->role, $gates[$level])) {
            abort(403, 'ليس لديك صلاحية لتنفيذ هذا الإجراء.');
        }

        foreach (ImportJobDomain::alsoRequires($domain) as $permission) {
            if (! Rbac::allows((string) $user->role, $permission)) {
                abort(403, 'ليس لديك صلاحية لتنفيذ هذا الإجراء.');
            }
        }

        if ($gates['app'] !== null) {
            $this->applications->authorize($request, $gates['app']);
        }
    }
}
