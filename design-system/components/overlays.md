# Dialog · Toast · Skeleton (Overlays & Feedback)

## Dialog (`ui/dialog.tsx`)

Anatomy: خلفية معتمة (`fixed inset-0 z-50 bg-black/40`) + لوح
(`relative z-10 w-full max-w-lg rounded border border-border bg-surface`) برأس (عنوان + زر X)
وجسم (`p-4`).

- الخصائص: `open`, `onClose`, `title`, `children`, `className`.
- **إغلاق:** بالنقر على الخلفية، وبزر X، وبمفتاح **Escape** (مضمّن).
- `role="dialog" aria-modal="true"`.
- الجوال: `items-start` (يبدأ من الأعلى)، `sm:items-center` (يتوسّط).
- الاستخدام: إنشاء/تعديل سريع (حوارات العميل/المنتج)، تأكيدات.

### قواعد
1. **حوار واحد مفتوح** في كل مرة.
2. عند تعديل سجل: مرّر `key={record?.id ?? 'new'}` للمكوّن الأب لإعادة تركيب النموذج
   (تفادي بقاء قيم قديمة/فارغة).
3. زر الإجراء الأساسي داخل الحوار + `outline` للإلغاء.
4. (مقترح) حبس التركيز داخل الحوار (focus trap) وإعادته للزر المُطلِق عند الإغلاق.
5. (مقترح) ظل خفيف `shadow-md` للّوح لفصله عن الخلفية.

## Toast (`ui/toast.tsx`)

عبر `ToastProvider` + `useToast()`. الموضع `fixed bottom-4 end-4 z-[100] max-w-sm`.

| variant | أيقونة | لون | الاستخدام |
|---|---|---|---|
| `success` | CheckCircle2 | `--positive` | تأكيد إجراء (حُفظ، رُحّل) |
| `error` | XCircle | `--negative` | فشل عملية |
| `warning` | AlertTriangle | `--warning` | تحذير |
| `info` | Info | `--primary` | معلومة |

- مدة العرض **4000ms**، `role="status" aria-live="polite"`، زر إغلاق، `shadow-sm`, `no-print`.
- API: `toast({title, description?, variant?})` · `success(title, desc?)` · `error(title, desc?)`.

### قواعد
1. **تأكيد كل إجراء ناجح** بـ `success` مقتضب.
2. أخطاء الخادم: `error` بعنوان واضح (لا تفاصيل تقنية).
3. لا تُغرِق: تنبيه واحد لكل إجراء. للأخطاء الحقلية استخدم رسائل الحقول لا التنبيهات.
4. رسالة قصيرة في `title`، تفصيل اختياري في `description`.

## Skeleton (`ui/skeleton.tsx`)

`animate-pulse rounded bg-border/60`. عنصر التحميل الموحّد.
- استخدمه بأبعاد تحاكي المحتوى القادم (`h-40 w-full` لجدول، `h-28` لرسم…).
- كل منطقة تجلب بيانات لها Skeleton أثناء `loading` (لا فراغ، لا سبينر عام).
