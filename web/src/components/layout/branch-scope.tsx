'use client';

import { createContext, Fragment, useContext, useEffect, useRef, useState } from 'react';
import { BRANCH_CHANGED_EVENT, getActiveBranchId } from '@/lib/branch';

/**
 * ═══════════════════════════════════════════════════════════════
 *  BranchScope — إعادة جلب بيانات الصفحة عند تبديل الفرع
 * ═══════════════════════════════════════════════════════════════
 *  `api()` يقرأ الفرع النشط من التخزين المحلي **عند كل نداء**، فأي طلب جديد
 *  يحمل الفرع الصحيح فوراً بلا إعادة تحميل. المشكلة أن الشاشات تجلب مرة واحدة
 *  في `useEffect(..., [])` فلا يُطلَق أي طلب جديد أصلاً.
 *
 *  الحل على مستوى البنية لا الشاشة: عدّاد يتقدّم عند كل تبديل، ويُمرَّر كـ `key`
 *  لشجرة الصفحة. تغيّر الـ key يُعيد تركيب الشجرة، فتعمل كل `useEffect` من جديد
 *  وتُعاد **كل** طلبات الصفحة دفعةً واحدة — بلا تعديل أي من الشاشات الـ ٤٥،
 *  وكل شاشة قادمة ترث السلوك مجاناً.
 *
 *  الشريط العلوي والجانبي خارج النطاق عمداً: القائمة المنسدلة تبقى مفتوحة
 *  والعلامة ✓ تنتقل بسلاسة أثناء تحديث المحتوى.
 */
const BranchVersionContext = createContext(0);

/** رقم إصدار يتقدّم عند كل تبديل فرع — لمن يحتاج تفاعلاً أدقّ من إعادة التركيب. */
export function useBranchVersion(): number {
  return useContext(BranchVersionContext);
}

export function BranchScope({ children }: { children: React.ReactNode }) {
  const [version, setVersion] = useState(0);
  const lastId = useRef<string | null>(null);

  useEffect(() => {
    lastId.current = getActiveBranchId();

    const onChange = () => {
      const id = getActiveBranchId();
      // تبديلٌ للفرع نفسه (أو حدث storage عن مفتاح آخر) لا يستحق إعادة جلب.
      if (id === lastId.current) return;
      lastId.current = id;
      setVersion((v) => v + 1);
    };

    window.addEventListener(BRANCH_CHANGED_EVENT, onChange);
    window.addEventListener('storage', onChange);

    return () => {
      window.removeEventListener(BRANCH_CHANGED_EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);

  return (
    <BranchVersionContext.Provider value={version}>
      {/* Fragment مُفتاح: يُعيد تركيب الشجرة بلا إضافة أي عنصر DOM يكسر التخطيط. */}
      <Fragment key={version}>{children}</Fragment>
    </BranchVersionContext.Provider>
  );
}
