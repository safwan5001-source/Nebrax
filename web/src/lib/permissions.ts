/**
 * مرآة `Rbac::allows` في الخادم — مصدر واحد لفحص الصلاحيات في الواجهة.
 *
 * الخادم يرسل في `/login` و`/me` قائمة الصلاحيات **المحسوبة** للدور
 * (`Rbac::permissionsForRole`)، وهي تقرأ جدول أدوار المؤسسة القابل للضبط قبل
 * السقوط على `Rbac::MATRIX`. فالقائمة هي الحقيقة، والدور ليس إلا اسمها:
 * `admin` قد تُحرّر صلاحياته لمؤسسةٍ ما، فمنحُه مروراً غير مشروط بالاسم يجعل
 * الواجهة أوسع من حماية الخادم — تعرض رابطاً يردّ عليه المسار 403.
 *
 * ولذلك يُستشار الدور **فقط** حين تغيب القائمة تماماً (`undefined`): تخزين محلي
 * قديم من قبل إضافة الحقل، أو وضع المعاينة. قائمة فارغة ليست غياباً — هي إجابة
 * صريحة بأن لا صلاحية، وهذا بالضبط ما أخفى مركز المستندات عن المالك حين قُرئت
 * بـ`??` بدل `||`.
 */

const WILDCARD = '*';

/** الأدوار التي تحمل `['*']` في `Rbac::MATRIX` الافتراضية. */
const WILDCARD_FALLBACK_ROLES = ['owner', 'admin'];

export function hasPermission(permissions: string[] | undefined, role: string | undefined, permission: string): boolean {
  if (permissions === undefined) {
    return WILDCARD_FALLBACK_ROLES.includes(role ?? '');
  }

  return permissions.includes(WILDCARD) || permissions.includes(permission);
}
