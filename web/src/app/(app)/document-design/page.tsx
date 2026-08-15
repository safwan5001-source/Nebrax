import { PrintTemplateStudio } from '@/modules/print-templates/components/print-template-studio';
import { currentUser } from '@/lib/auth';

/** مكتبة القوالب ومحرر المسودات مع معاينة آمنة ومراجعات قابلة للنشر. */
export default function DocumentDesignPage() {
  const user = currentUser();
  const canManage = user?.role === 'owner' || user?.role === 'admin';

  return <PrintTemplateStudio canManage={canManage} />;
}
