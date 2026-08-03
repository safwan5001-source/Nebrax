# الطباعة — التطبيق (Typography · Applied Scale)

> المقياس والرموز في `tokens/typography.md`. هنا **كيف تُطبَّق** على عناصر الشاشة.

## الخريطة المعيارية (انسخها)

| عنصر الشاشة | الأصناف |
|---|---|
| عنوان الصفحة (`h1`) | `text-xl font-semibold text-text` |
| عنوان بطاقة (`CardTitle`) | `text-sm font-medium text-muted` |
| عنوان حوار | `text-base font-semibold text-text` |
| نص أساسي/خلية جدول | `text-sm text-text` |
| تسمية حقل (`Label`) | `text-sm font-medium text-text` |
| نص ثانوي/تلميح | `text-xs text-muted` أو `text-[11px] text-muted` |
| رأس عمود جدول (`TH`) | `text-sm font-medium` (ضمن `text-muted` من `THead`) |
| رقم مالي | `.num text-end` (+ `text-negative` للسالب) |
| رقم مؤشّر كبير (KPI) | `.num text-2xl font-semibold text-text` |
| نص زر | `text-sm font-medium` |
| شارة | `text-xs font-medium` |

## قواعد

1. **الأساس 14px (`text-sm`).** كل نص التطبيق الداخلي منه. `text-base` للمدخلات اللمسية
   في شاشات الدخول/التسجيل فقط.
2. **العناوين هادئة.** عنوان البطاقة `text-muted` عمداً — المحتوى (الأرقام/الجدول) هو البطل.
3. **لا تتجاوز `font-semibold` (600)** داخل التطبيق. `font-bold` لعناوين المصادقة فقط.
4. **الأرقام بـ `.num` دائماً**، محاذاة يمين في الجداول، `tabular-nums` لمحاذاة الخانات.
5. **لا uppercase في العربية.** ولا تشديد بصري مزدوج (لون + وزن + حجم معاً) بلا داعٍ.

## التسلسل الهرمي (مثال شاشة)

```tsx
<h1 className="text-xl font-semibold text-text">الفواتير</h1>          {/* صفحة */}
<Card>
  <CardHeader><CardTitle>ملخّص</CardTitle></CardHeader>               {/* بطاقة: sm/muted */}
  <CardContent>
    <p className="text-2xl font-semibold num text-text">1,150.00 ﷼</p>{/* KPI */}
    <p className="text-xs text-muted">إجمالي هذا الشهر</p>            {/* تلميح */}
  </CardContent>
</Card>
```

## RTL والطباعة

- الاتجاه يُضبط على `<html dir>` تلقائياً. النصوص العربية RTL، والحقول اللاتينية
  (بريد/هاتف/كود/رقم) تأخذ `dir="ltr"` موضعياً.
- محاذاة النص المنطقية: `text-start`/`text-end` (لا `text-left/right`).
