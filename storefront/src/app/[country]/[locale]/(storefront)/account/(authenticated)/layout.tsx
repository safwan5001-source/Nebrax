import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthenticatedAccountShell } from "@/components/account/AuthenticatedAccountShell";
import { REQUEST_PATHNAME_HEADER, REQUEST_SEARCH_HEADER } from "@/i18n/routing";
import {
  ACCOUNT_REFRESH_COOKIE,
  ACCOUNT_SESSION_COOKIE,
} from "@/lib/account/session-cookies";
import {
  buildAccountLoginHref,
  resolveAccountRedirect,
} from "@/lib/utils/account-redirect";

interface AuthenticatedAccountLayoutProps {
  children: React.ReactNode;
  params: Promise<{ country: string; locale: string }>;
}

export default function AuthenticatedAccountLayout(
  props: AuthenticatedAccountLayoutProps,
) {
  return (
    <Suspense fallback={null}>
      <AuthenticatedAccountLayoutContent {...props} />
    </Suspense>
  );
}

export async function AuthenticatedAccountLayoutContent({
  children,
  params,
}: AuthenticatedAccountLayoutProps) {
  const [{ country, locale }, requestHeaders, cookieStore] = await Promise.all([
    params,
    headers(),
    cookies(),
  ]);
  const accessToken = cookieStore.get(ACCOUNT_SESSION_COOKIE)?.value;
  const refreshToken = cookieStore.get(ACCOUNT_REFRESH_COOKIE)?.value;

  const basePath = `/${country}/${locale}`;
  const pathname = requestHeaders.get(REQUEST_PATHNAME_HEADER);
  const search = requestHeaders.get(REQUEST_SEARCH_HEADER);
  const requestedPath = `${pathname ?? ""}${search?.startsWith("?") ? search : ""}`;
  const returnTo = resolveAccountRedirect(requestedPath, basePath);
  const loginHref = buildAccountLoginHref(basePath, returnTo);

  // A refresh token is also a recoverable session credential. Let the client
  // session action rotate it in a cookie-writable context before deciding that
  // the customer is anonymous.
  if (!accessToken && !refreshToken) redirect(loginHref);

  return (
    <AuthenticatedAccountShell loginHref={loginHref}>
      {children}
    </AuthenticatedAccountShell>
  );
}
