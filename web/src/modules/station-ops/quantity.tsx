import type { ReactNode } from 'react';

/** رقم بخط الأرقام الجدولية + وحدة بخط الواجهة العادي (لا حروف عربية بخط mono). */
export function Quantity({ value, unit, className }: { value: ReactNode; unit?: string; className?: string }) {
  return (
    <span className={className}>
      <span className="num">{value}</span>
      {unit ? <span className="ms-1">{unit}</span> : null}
    </span>
  );
}
