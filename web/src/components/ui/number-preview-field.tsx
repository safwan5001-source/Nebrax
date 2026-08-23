import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface NumberPreviewFieldProps {
  id: string;
  label: string;
  number: string;
  loading?: boolean;
  className?: string;
}

/** حقل عرض فقط للرقم المتوقع قبل الإنشاء؛ الرقم النهائي يخصصه الخادم عند الحفظ. */
export function NumberPreviewField({ id, label, number, loading = false, className = '' }: NumberPreviewFieldProps) {
  return (
    <div className={`space-y-1.5 ${className}`.trim()}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        dir="ltr"
        className="num bg-muted/40 font-medium text-text"
        value={number}
        readOnly
        aria-busy={loading}
      />
    </div>
  );
}
