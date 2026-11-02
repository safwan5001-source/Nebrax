import * as Sentry from "@sentry/nextjs";
import { scrubTrackingCredentials } from "@/lib/telemetry/scrub-tracking";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

// Opt-in to sending PII (IP addresses, cookies, user data) to Sentry.
// Defaults to false for privacy. Set NEXT_PUBLIC_SENTRY_SEND_DEFAULT_PII=true to enable.
const sendDefaultPii =
  process.env.NEXT_PUBLIC_SENTRY_SEND_DEFAULT_PII === "true";

if (dsn) {
  Sentry.init({
    dsn,
    sendDefaultPii,
    // COPS-H2-5: the guest tracking token is in the page path — never ship it to telemetry.
    beforeSend: (event) => scrubTrackingCredentials(event),
    beforeSendTransaction: (event) => scrubTrackingCredentials(event),
    beforeBreadcrumb: (breadcrumb) => scrubTrackingCredentials(breadcrumb),
    tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  });
}

export const onRouterTransitionStart = dsn
  ? Sentry.captureRouterTransitionStart
  : undefined;
