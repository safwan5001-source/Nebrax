/**
 * خطأ إجراء داخل حوار (FS-29): الشريط العلوي للصفحة يظهر خلف طبقة الحوار،
 * فيُعرض الخطأ هنا داخل الحوار نفسه وحده (الصفحة تُخفي شريطها ما دام حوار مفتوحاً).
 */
export function DialogError({ message }: { message?: string | null }) {
  if (!message) return null;
  return <p role="alert" className="rounded-md bg-negative/10 px-3 py-2 text-sm text-negative">{message}</p>;
}
