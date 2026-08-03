# حالات الشاشة (Empty · Loading · Error)

**كل شاشة/جدول يجب أن يعالج الحالات الثلاث صراحةً.** الشاشة البيضاء الصامتة = عيب.

## 1. Loading State

- **Skeleton** (`ui/skeleton.tsx`) يحاكي شكل المحتوى القادم — لا سبينر عام، لا فراغ.
- مثال: جدول → `<Skeleton className="h-40 w-full" />`؛ رسم → `<Skeleton className="h-28 w-full" />`.
- المؤشرات (KPI) أثناء التحميل: Skeleton بحجم الرقم.
- الزر أثناء الإرسال: `disabled` (+ مؤشّر مقترح).

```tsx
{loading ? <Skeleton className="h-40 w-full" /> : <DataTable … />}
```

## 2. Empty State

- رسالة واضحة موجزة + (اختياري) زر لأول إجراء.
- في `DataTable`: مرّر `emptyLabel`.
- النمط: نص `text-muted` متمركز داخل الحاوية + أيقونة خفيفة اختيارية + زر «إضافة أول …».
- لا تعرض جدولاً فارغاً برؤوس بلا صفوف دون رسالة.

```tsx
<DataTable data={rows} emptyLabel="لا يوجد عملاء بعد — أضِف أول عميل." … />
```

## 3. Error State

- **خطأ عملية (إرسال):** شريط أعلى النموذج `rounded bg-negative/10 px-3 py-2 text-xs text-negative`
  + رسالة الخادم (`ApiError.message`)، أو `error` Toast.
- **خطأ حقل:** `text-xs text-negative` أسفل الحقل.
- **خطأ جلب بيانات:** رسالة داخل الحاوية + (مقترح) زر «إعادة المحاولة».
- **401 (جلسة منتهية):** تُمسح الجلسة ويُعاد التوجيه لـ `/login` تلقائياً.
- لا تعرض رسائل تقنية خام (SQL/stack) للمستخدم.

## قاعدة التغطية

قبل الدمج، لكل منطقة تجلب/تُرسل بيانات:
- [ ] Loading (Skeleton) — [ ] Empty (رسالة + إجراء) — [ ] Error (رسالة مفهومة).
