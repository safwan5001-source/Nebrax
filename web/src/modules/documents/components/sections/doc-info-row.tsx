/** صفّ «تسمية: قيمة» داخل بطاقات المستند. لا يُعرض حين القيمة فارغة. */
export function DocInfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-black">{value}</span>
    </div>
  );
}
