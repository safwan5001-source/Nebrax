"use client";

import { MonitorSmartphone } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AccountSession } from "@/lib/commerce/account";
import {
  listSessions,
  revokeOtherSessions,
  revokeSession,
} from "@/lib/data/customer";

function when(value: string | null, locale: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

/**
 * The signed-in devices of THIS account on THIS store. Token metadata only (the secret never leaves the server);
 * ending one — or every other — session revokes it server-side immediately.
 */
export function AccountSessionsPanel() {
  const t = useTranslations("retailAccount");
  const locale = useLocale();
  const [sessions, setSessions] = useState<AccountSession[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await listSessions();
    if (result.kind === "ok") {
      setSessions(result.data);
      setFailed(false);
    } else {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const endOne = async (id: string) => {
    setBusy(true);
    await revokeSession(id);
    await load();
    setBusy(false);
  };

  const endOthers = async () => {
    setBusy(true);
    await revokeOtherSessions();
    await load();
    setBusy(false);
  };

  return (
    <section
      aria-labelledby="sessions-heading"
      className="border-t border-store-border pt-8"
      data-testid="account-sessions"
    >
      <h2
        id="sessions-heading"
        className="text-base font-semibold text-store-foreground"
      >
        {t("sessionsTitle")}
      </h2>
      <p className="mt-1 text-sm text-store-muted-foreground">
        {t("sessionsBody")}
      </p>

      {failed && (
        <p role="alert" className="mt-3 text-sm text-store-destructive">
          {t("sessionsError")}
        </p>
      )}

      {sessions && (
        <ul className="mt-4 divide-y divide-store-border overflow-hidden rounded-store border border-store-border bg-store-surface">
          {sessions.map((session) => (
            <li
              key={session.id}
              className="flex flex-wrap items-center gap-3 px-4 py-3"
            >
              <MonitorSmartphone
                className="size-4 shrink-0 text-store-muted-foreground"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium text-store-foreground">
                  {session.current ? t("thisDevice") : t("otherDevice")}
                </p>
                <p className="text-xs text-store-muted-foreground">
                  {t("lastActive", {
                    date: when(session.lastUsedAt ?? session.createdAt, locale),
                  })}
                </p>
              </div>
              {!session.current && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => endOne(session.id)}
                >
                  {t("endSession")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {sessions && sessions.length > 1 && (
        <Button
          type="button"
          variant="outline"
          className="mt-4 w-full sm:w-auto"
          disabled={busy}
          onClick={endOthers}
        >
          {t("endOtherSessions")}
        </Button>
      )}
    </section>
  );
}
