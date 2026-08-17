import { redirect } from 'next/navigation';

/**
 * يبقى الرابط القديم صالحاً للمفضلات والروابط الداخلية، لكنه لم يعد يحرر
 * `sales_config.designs`. تستضيف منصة القوالب المكتبة والمراجعات والتعيينات.
 */
export default function DesignsSettingsPage() {
  redirect('/document-design');
}
