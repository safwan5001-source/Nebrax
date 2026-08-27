import { redirect } from 'next/navigation';

/**
 * أُبقي الرابط القديم صالحاً بعد دمج إعدادات الإيصال والطباعة في صفحة تهيئة POS
 * الموحدة، فتظل جميع إعدادات الإيصال وقالبها الحراري في سطح تعديل واحد.
 */
export default function PosPrintingSettingsPage() {
  redirect('/pos/settings/configuration');
}
