# تقرير التنفيذ — PR-5: Dedicated POS Workspace

**التاريخ:** 2026-08-28  
**المشروع:** Nebrax ERP — نقطة البيع (POS)  
**المرجع:** PR-5 فوق `main` بعد دمج PR #549 (Hybrid / Adaptive)

---

## 1. PR number

[#550](https://github.com/safwan5001-source/Nebrax/pull/550)

## 2. branch

`cursor/pos-dedicated-workspace-2ebb`

> سياسة Cloud Agent فرضت البادئة `cursor/` واللاحقة `-2ebb`.

## 3. base SHA

`668b089ce678f8ba636559cf12a3bc0fb1f927be` — `main` بعد دمج PR #549.

## 4. HEAD SHA

يُحدَّث في نهاية هذا الملف بعد commit التقرير. تنفيذ الكود الأول: `cac0f24820bc18fc6cf21b698a240f47262a652f`.

## 5. changed files

### جديد

```
web/src/lib/pos-workspace.ts
web/src/lib/__tests__/pos-workspace.test.ts
web/e2e/pos-dedicated-workspace.spec.ts
docs/reports/PR-550-pos-dedicated-workspace-report.md
docs/visual-qa/pr-550/erp-sidebar-start-selling.png
docs/visual-qa/pr-550/erp-tab-stays-dashboard.png
docs/visual-qa/pr-550/pos-tab-no-sidebar.png
```

### محدّث

```
web/src/components/layout/sidebar.tsx
web/src/components/pos/pos-topbar.tsx
```

لا ملفات Laravel / API / migrations / RBAC.

## 6. audited launch entry points

| المصدر | المسار | السلوك بعد هذا PR |
|--------|--------|-------------------|
| شريط ERP — `posStart` («بدء البيع» / Start selling) | `/pos` | تبويب جديد (`target="_blank"` + `rel="noopener noreferrer"`) |
| شريط ERP — `posSessions` | `/pos/sessions` | نفس التبويب |
| شريط ERP — `posReport` | `/pos/report` | نفس التبويب |
| شريط ERP — `posAudit` | `/pos/audit` | نفس التبويب |
| شريط ERP — `posSettings` | `/pos/settings` | نفس التبويب |
| `router.push('/pos')` / زر لوحة التحكم / `window.open` | — | غير موجودة في الإنتاج |
| E2E السابق `page.goto('/pos')` | `/pos` | اختبار مباشر، ليس CTA إنتاجياً |

يُرسم رابط `posStart` في موقعين داخل [`sidebar.tsx`](../../web/src/components/layout/sidebar.tsx): الأكورديون الموسّع والقائمة المصغّرة. كلاهما يستهلك `posNavNewTabAnchorProps`.

تخطيط البيع [`web/src/app/(pos)/layout.tsx`](../../web/src/app/(pos)/layout.tsx) مستقل: `100dvh`، بلا `Sidebar`، ومصادقة عبر `isAuthenticated()` ثم `router.replace('/login')`.

## 7. implementation chosen

رابط دلالي من نقرة المستخدم، لا `window.open`:

- مصدر سياسة الشريط: [`web/src/lib/pos-workspace.ts`](../../web/src/lib/pos-workspace.ts) (`POS_SIDEBAR_LAUNCH_ITEMS` + `posStartNewTabProps` / `posNavNewTabAnchorProps`).
- `openInNewTab: true` على `posStart` وحده.
- «العودة للنظام» يستهلك `POS_RETURN_HREF` (`/dashboard`) دون تغيير السلوك.

لا popup بأبعاد، لا iframe، لا انتظار شبكة قبل الفتح.

## 8. browser behavior

`Link` مع `target="_blank"` يفتح `/pos` في تبويب جديد ويبقي التبويب الأصلي على مساره الحالي. Playwright أكّد:

1. `target="_blank"` و`rel="noopener noreferrer"` على «بدء البيع».
2. بعد النقر: التبويب الأصلي ما زال `/dashboard` وعنوان «لوحة التحكم» ظاهر.
3. التبويب الجديد `/pos` بلا زر «طيّ الشريط» وبلا رابط «لوحة التحكم» (لا قشرة ERP).
4. رابط «العودة للنظام» ظاهر في تبويب POS.

## 9. iPhone/Safari considerations

الفتح من إيماءة المستخدم على `<a>`/`Link` أصلي — لا `await` قبل `window.open`. لا أبعاد نافذة. مسار `/pos` الحالي يبقى متجاوباً كما هو. لم يُختبر جهاز Safari حقيقي في هذه البيئة؛ العقد نفسه هو ما يمنع حظر النوافذ المنبثقة.

## 10. duplicate-session handling

بوابة الجلسة تبقى `GET /pos-sessions?mine=1` في صفحة البيع. التبويب الثاني لا يستدعي `POST /pos-sessions/open` بصمت.

لم يُضف حارس تكرار عبر `localStorage`/`BroadcastChannel`: التخزين المحلي مشترك لنفس الأصل (سلال معلّقة last-write-wins) وهو قيد قائم سابق، وليس مصدر حقيقة مالية. توثيقه هنا كافٍ لأصغر تغيير آمن.

في وضع المعاينة ظهر تبويب POS بوردية وهمية قائمة (`0002-2026-POS`) من `mockApi` — لم يُنشأ مستند مالي جديد بسبب فتح التبويب.

## 11. exit/return behavior

- «العودة للنظام»: `<Link href={POS_RETURN_HREF}>` → `/dashboard`. لا `window.close()`. لا إغلاق وردية.
- حارس السلة غير المحفوظة يبقى `close_session` و`logout` فقط في [`page.tsx`](../../web/src/app/(pos)/pos/page.tsx). العودة للنظام لا تدخل هذا الحارس (السلوك الحالي، لم يُخترع حارس جديد).
- إنهاء الوردية يبقى تدفقاً مستقلاً (`POST .../close`).

## 12. tests

| الملف | التغطية |
|-------|---------|
| `pos-workspace.test.ts` (7) | props الدلالية؛ `posStart` وحده new-tab؛ ربط الشريط في موقعين؛ تخطيط POS بلا Sidebar؛ العودة بلا `window.close`؛ حارس السلة على الإغلاق/الخروج فقط |
| `pos-dedicated-workspace.spec.ts` | نقرة حقيقية: تبويب جديد + ERP يبقى + POS بلا قشرة الشريط |
| اختبارات PR-1–4 (interactions) | لم تُعدَّل وبقيت خضراء |

`npm run test`: **891** اختباراً في **152** ملفاً — كلها خضراء.

Playwright (محلي، desktop): **1 passed** — `e2e/pos-dedicated-workspace.spec.ts`.

## 13. build

`npm run build`: **ناجح** (Next.js 15.5.19، TypeScript OK).

## 14. manual/visual verification

فُحص المسار عبر Playwright/Chromium ووضع المعاينة (`دخول تجريبي`، بلا Backend). اللقطات: `docs/visual-qa/pr-550/`.

| اللقطة | ماذا تُظهر |
|--------|-------------|
| `erp-sidebar-start-selling.png` | الشريط الموسّع على «بدء البيع» وتبويب ERP على لوحة التحكم |
| `erp-tab-stays-dashboard.png` | بعد النقر: التبويب الأصلي ما زال لوحة التحكم |
| `pos-tab-no-sidebar.png` | تبويب POS ملء الشاشة، «العودة للنظام»، بلا شريط ERP |

لم تُعد لقطات 1024/834/390 لهذا PR: التغيير رابط شريط لا تخطيط POS. سلوك الجوال هو نفس `target="_blank"` من الإيماءة.

لم يُختبر Safari على iPhone حقيقي في هذه البيئة.

## 15. known limitations

- تبويبان POS على نفس الأصل يتشاركان `localStorage` للسلال المعلّقة (last-write-wins). ليس مصدر حقيقة محاسبية؛ حارس تكرار اختياري مؤجَّل.
- «العودة للنظام» تنتقل داخل تبويب POS إلى `/dashboard` ولا تغلق التبويب.
- `isActive('/pos')` في الشريط ما زال يطابق `/pos/sessions` عبر `startsWith` — قيد سابق خارج هذا PR.
- اختبار Playwright غير جزء من Web CI (CI يشغّل Vitest + `next build` فقط).

## 16. تأكيد

- no financial logic changes
- no backend/API changes
- no session accounting changes
- no shortcut/scanner changes
- no merge
- no production deploy

---

## روابط

- **PR:** https://github.com/safwan5001-source/Nebrax/pull/550
- **PR #549 (Hybrid):** https://github.com/safwan5001-source/Nebrax/pull/549
- **Base:** `668b089ce678f8ba636559cf12a3bc0fb1f927be`

---

*تم إنشاء هذا التقرير آلياً بعد اكتمال تنفيذ PR-5 — Nebrax Cloud Agent.*
