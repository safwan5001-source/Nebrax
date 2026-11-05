"use client";

import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import "@/modules/station-ops/fuel-ops.css";
import { FUEL_ICON_IDS, FUEL_ICONS, FuelIcon, fuelIconLabel, resolveFuelIcon, type FuelIconId } from "@/lib/fuel-icons";

/**
 * AWJ-FUEL-ICONS-INTEGRATION — معاينة تحقّق بصري فقط (الإنتاج يردّ 404، كنمط `/dev/*` القائم).
 * تعرض الأيقونات العشرين الرسمية ثم عيّنات داخل غلاف كل نظام تصميم **بمتغيّراته الحقيقية** (ERP: رموز globals.css،
 * Fuel Ops: fuel-ops.css) فاتحاً/داكناً وبـRTL/LTR — بلا مكوّنات أو ألوان موحّدة بين الأنظمة.
 */

type Dir = "rtl" | "ltr";
const LOCALE: Record<Dir, string> = { rtl: "ar", ltr: "en" };

function Frame({ app, theme, dir, children }: { app: "erp" | "ops"; theme: "light" | "dark"; dir: Dir; children: ReactNode }) {
  const title = `${app === "erp" ? "AWJ ERP" : "Fuel Ops (seller / supervisor)"} · ${theme} · ${dir}`;
  const inner = (
    <div
      dir={dir}
      lang={LOCALE[dir]}
      data-testid={`frame-${app}-${theme}-${dir}`}
      className="rounded-lg border border-border bg-background p-4 text-text"
    >
      <p className="mb-3 text-xs font-semibold text-muted">{title}</p>
      {children}
    </div>
  );
  // كما في التطبيق: `.dark` على الجذر و`[data-fuel-ops]` تحته.
  const scoped = app === "ops" ? <div data-fuel-ops="">{inner}</div> : inner;
  return theme === "dark" ? <div className="dark">{scoped}</div> : scoped;
}

function Sample({ app, dir }: { app: "erp" | "ops"; dir: Dir }) {
  const locale = LOCALE[dir];
  const products = [
    { code: "G91", name: dir === "rtl" ? "بنزين 91" : "Gasoline 91" },
    { code: "G95", name: dir === "rtl" ? "بنزين 95" : "Gasoline 95" },
    { code: "DSL", name: dir === "rtl" ? "ديزل" : "Diesel" },
    { code: "LUB", name: dir === "rtl" ? "زيت محرك" : "Engine oil" },
  ];
  return (
    <ul className="space-y-2">
      {products.map((p) => (
        <li key={p.code} className="flex items-center gap-3 rounded-[14px] border border-border bg-surface p-3.5">
          <FuelIcon id={resolveFuelIcon("product", p)} size={48} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold">{p.name}</p>
            <p className="text-[13px] text-muted">{locale === "ar" ? "2 مضخات · 4 فوهات" : "2 pumps · 4 nozzles"}</p>
          </div>
          <FuelIcon id={resolveFuelIcon("nozzle", p)} size={40} />
          <FuelIcon id={resolveFuelIcon("tank", p)} size={40} />
        </li>
      ))}
    </ul>
  );
}

export default function FuelIconsPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="space-y-8 bg-background p-6 text-text">
      <h1 className="text-xl font-semibold">AWJ Fuel Icons V2 — 20 official icons</h1>
      {(["light", "dark"] as const).map((theme) => (
        <section key={theme} data-testid={`sheet-${theme}`} className={theme === "dark" ? "dark" : undefined}>
          <div className="rounded-lg border border-border bg-background p-4">
            <p className="mb-3 text-xs font-semibold text-muted">{theme} · plate=auto (dark only)</p>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
              {FUEL_ICON_IDS.map((id: FuelIconId) => (
                <li key={id} className="rounded-[14px] border border-border bg-surface p-3 text-center">
                  <FuelIcon id={id} size={96} className="mx-auto" labelled locale="en" />
                  <p className="mt-2 text-[13px] font-semibold">{FUEL_ICONS[id].ar}</p>
                  <p className="text-[11px] text-muted">{fuelIconLabel(id, "en")}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ))}
      <section data-testid="size-ladder" className="rounded-lg border border-border p-4">
        <p className="mb-3 text-xs font-semibold text-muted">sizes 24 / 32 / 40 / 48 / 64 (light and dark)</p>
        {(["light", "dark"] as const).map((theme) => (
          <div key={theme} className={theme === "dark" ? "dark" : undefined}>
            <div className="flex flex-wrap items-end gap-3 bg-background p-3 text-text">
              {FUEL_ICON_IDS.slice(0, 8).flatMap((id) => [24, 32, 40, 48, 64].map((size) => <FuelIcon key={`${id}-${size}`} id={id} size={size} />))}
            </div>
          </div>
        ))}
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        {(["erp", "ops"] as const).flatMap((app) =>
          (["light", "dark"] as const).flatMap((theme) =>
            (["rtl", "ltr"] as const).map((dir) => (
              <Frame key={`${app}-${theme}-${dir}`} app={app} theme={theme} dir={dir}>
                <Sample app={app} dir={dir} />
              </Frame>
            )),
          ),
        )}
      </div>
    </main>
  );
}
