'use client';

import * as React from 'react';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** حقل إعادة تسمية مضمَّن (Enter يحفظ، Esc يلغي). الاسم يُقصّ ولا يتجاوز ٨٠ حرفاً (حدّ عقد بيانات المحرر)؛ الفارغ = العودة للاسم المشتق. */
export function InlineRename({
  initial, label, onSave, onCancel, t,
}: {
  initial: string;
  label: string;
  onSave: (value: string) => void;
  onCancel: () => void;
  t: Translate;
}) {
  const [value, setValue] = React.useState(initial);
  return (
    <form
      className="flex min-h-11 w-full items-center gap-1 px-1"
      onSubmit={(event) => { event.preventDefault(); onSave(value.trim()); }}
    >
      <Input
        autoFocus
        value={value}
        maxLength={80}
        aria-label={label}
        className="h-9 min-w-0 flex-1 text-sm"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onCancel(); } }}
      />
      <Button type="submit" variant="ghost" size="icon" className="h-9 w-8" aria-label={t('easy.renameSave')}>
        <Check className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
      </Button>
      <Button type="button" variant="ghost" size="icon" className="h-9 w-8" aria-label={t('easy.renameCancel')} onClick={onCancel}>
        <X className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
      </Button>
    </form>
  );
}
