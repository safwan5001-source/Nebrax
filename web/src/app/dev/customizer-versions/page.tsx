"use client";

import { notFound, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ExperienceBuilder } from "@/modules/store-experience-builder/ExperienceBuilder";
import { enableDemo } from "@/lib/demo";
import {
  bumpMockPresentationVersionRevision,
  seedMockPresentationVersions,
  setMockOffersMode,
  setMockSchedulingRuntimeActive,
} from "@/lib/mock-data";

/**
 * CUST-H1-2 — ثابتة تحقّق بصري فقط، غير مرتبطة بالمنتج. تركّب `ExperienceBuilder`
 * الحقيقي (لا معاينة قناة عرض مبسّطة) خلف وضع المعاينة (Demo) المحلي الموجود
 * أصلاً، مع مخزون نسخ وهمي في `lib/mock-data.ts` — لا حاجة لخادم Laravel ولا
 * تسجيل دخول. الإنتاج يعيد 404. راجع `/dev/customizer-visual` و`/dev/trust-visual`
 * لنفس النمط المستخدم أصلاً في المستودع (لا بنية تصوير جديدة).
 */

const STORE_ID = "dev-store-1";

type Scenario =
  | "empty"
  | "single-draft"
  | "choose"
  | "published-readonly"
  | "many-long-names"
  | "draft-and-published"
  | "schedule-eligible"
  | "scheduled"
  | "scheduling-gated"
  | "conflict";

function scenarioOf(value: string | null): Scenario {
  if (
    value === "empty" ||
    value === "single-draft" ||
    value === "choose" ||
    value === "published-readonly" ||
    value === "many-long-names" ||
    value === "draft-and-published" ||
    value === "schedule-eligible" ||
    value === "scheduled" ||
    value === "scheduling-gated" ||
    value === "conflict"
  ) {
    return value;
  }
  return "single-draft";
}

const LONG_NAME =
  "نسخة تجربة إعادة تصميم موسم نهاية السنة مع تعديلات شاملة على الأقسام والهوية البصرية لكل صفحات المتجر";

function seedFor(scenario: Scenario) {
  if (scenario === "empty") {
    seedMockPresentationVersions(STORE_ID, []);
    return;
  }
  if (scenario === "single-draft" || scenario === "conflict") {
    seedMockPresentationVersions(STORE_ID, [
      { id: "v-draft-1", name: "التصميم الحالي", state: "draft", revision: 3 },
    ]);
    return;
  }
  if (scenario === "choose") {
    seedMockPresentationVersions(STORE_ID, [
      { id: "v-draft-1", name: "رمضان 1448", state: "draft", revision: 2 },
      { id: "v-draft-2", name: "اليوم الوطني", state: "draft", revision: 1 },
    ]);
    return;
  }
  if (scenario === "published-readonly") {
    // نسخة منشورة وحيدة بلا أي مسودة: تُختار تلقائياً وبلا غموض (قاعدة §13 —
    // "نسخة منشورة وحيدة بلا أي مسودة")، فتُظهر حالة القراءة فقط فوراً.
    seedMockPresentationVersions(STORE_ID, [
      {
        id: "v-published-1",
        name: "التصميم المنشور",
        state: "published",
        revision: 5,
        lastPublishedAt: "2026-09-01T09:00:00.000Z",
      },
    ]);
    return;
  }
  if (scenario === "draft-and-published") {
    // CUST-H1-3 — مسودة أهلة للنشر بجانب نسخة منشورة قائمة: التأكيد يعرض
    // نص "استبدال" لا نص "أول نشر"، ونجاح النشر يُنزل هذه المنشورة إلى مسودة.
    seedMockPresentationVersions(STORE_ID, [
      { id: "v-published-1", name: "التصميم الحالي", state: "published", revision: 5 },
      { id: "v-draft-1", name: "رمضان 1448", state: "draft", revision: 2 },
    ]);
    return;
  }
  if (scenario === "schedule-eligible") {
    // CUST-H1-5 — مسودة وحيدة أهلة للجدولة: أنظف سيناريو لفتح حوار الجدولة
    // بلا تحذير استبدال (لا نسخة مجدولة أخرى قائمة).
    seedMockPresentationVersions(STORE_ID, [
      { id: "v-published-1", name: "التصميم الحالي", state: "published", revision: 5 },
      { id: "v-draft-1", name: "رمضان 1448", state: "draft", revision: 2 },
    ]);
    return;
  }
  if (scenario === "scheduled") {
    // CUST-H1-5 — نسخة مجدولة بالفعل + مسودة أخرى: تفتح "إعادة الجدولة"/
    // "إلغاء الجدولة" على الأولى، وتُظهر تحذير الاستبدال عند جدولة الثانية.
    seedMockPresentationVersions(STORE_ID, [
      { id: "v-published-1", name: "التصميم الحالي", state: "published", revision: 5 },
      {
        id: "v-scheduled-1",
        name: "عروض نهاية السنة",
        state: "scheduled",
        revision: 2,
        scheduledFor: "2026-12-25T21:00:00.000Z",
      },
      { id: "v-draft-1", name: "رمضان 1448", state: "draft", revision: 1 },
    ]);
    return;
  }
  if (scenario === "scheduling-gated") {
    // CUST-H1-5 — بوابة تشغيل الإنتاج غير مفعَّلة: زرّ الجدولة معطَّل بشرح
    // صريح، وإلغاء جدولة نسخة قائمة يبقى متاحاً (إجراء تعافٍ آمن دائماً).
    seedMockPresentationVersions(STORE_ID, [
      { id: "v-draft-1", name: "رمضان 1448", state: "draft", revision: 2 },
      {
        id: "v-scheduled-1",
        name: "عروض نهاية السنة",
        state: "scheduled",
        revision: 1,
        scheduledFor: "2026-12-25T21:00:00.000Z",
      },
    ]);
    setMockSchedulingRuntimeActive(STORE_ID, false);
    return;
  }
  seedMockPresentationVersions(STORE_ID, [
    { id: "v-published-1", name: "التصميم المنشور", state: "published", revision: 5 },
    { id: "v-scheduled-1", name: "عروض نهاية السنة", state: "scheduled", revision: 2, scheduledFor: "2026-12-25T21:00:00.000Z" },
    { id: "v-long-1", name: LONG_NAME, state: "draft", revision: 1 },
    { id: "v-draft-2", name: "رمضان 1448", state: "draft", revision: 4 },
    { id: "v-draft-3", name: "اليوم الوطني", state: "draft", revision: 1 },
    { id: "v-draft-4", name: "الجمعة البيضاء", state: "draft", revision: 1 },
  ]);
}

function Fixture() {
  const params = useSearchParams();
  const locale = params.get("locale") === "en" ? "en" : "ar";
  const scenario = scenarioOf(params.get("scenario"));

  // CUST-H4-7 — `?offers=empty|error` switches the Offers fixture's state
  // (default: the full live/hidden list). Dev-only visual-QA switch.
  const offersParam = params.get("offers");
  if (typeof window !== "undefined") {
    enableDemo();
    seedFor(scenario);
    if (scenario === "conflict") {
      // CUST-HV V1A — lets a visual test play "someone else saved first": call
      // this, then Save, and the builder lands in its real version-conflict state.
      (window as unknown as { __awjDevBumpRevision?: () => boolean }).__awjDevBumpRevision = () =>
        bumpMockPresentationVersionRevision(STORE_ID, "v-draft-1");
    }
    setMockOffersMode(
      offersParam === "empty" || offersParam === "error" ? offersParam : "list",
    );
  }

  return (
    <div data-visual-root="" data-scenario={scenario} className="h-dvh min-h-0">
      <ExperienceBuilder
        storefrontId={STORE_ID}
        liveStoreName={locale === "ar" ? "متجر النور" : "Al Noor"}
        businessIdentity={{ legal_name: "شركة النور", cr_number: "7050247977", vat_number: null }}
        initialLocale={locale}
        // `?openStore=1` renders the toolbar's "Open store" link — the worst case
        // for header width, which the real merchant workspace always has.
        storefrontUrl={params.get("openStore") === "1" ? "https://a.h48.test/" : null}
      />
    </div>
  );
}

export default function CustomizerVersionsVisualPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <Suspense>
      <Fixture />
    </Suspense>
  );
}
