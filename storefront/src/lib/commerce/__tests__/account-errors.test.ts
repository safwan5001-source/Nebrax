import { describe, expect, it } from "vitest";
import { accountErrorMessage } from "@/lib/commerce/account-error-message";
import {
  ACCOUNT_FAILURE_CODES,
  type AccountAction,
  classifyAccountError,
} from "@/lib/commerce/account-errors";

const ACTIONS: AccountAction[] = [
  "login",
  "register",
  "password_reset_request",
  "password_reset",
  "profile_update",
];

const HOSTILE = [
  "SQLSTATE[23000]: Integrity constraint violation",
  "Error at Object.<anonymous> (/srv/app/node_modules/x.js:10:5)\n    at async",
  "GET https://internal.awj.local/api/v3/store/customers failed",
  "Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig",
  "SPREE_API_URL and SPREE_PUBLISHABLE_KEY are not set",
];

describe("classifyAccountError", () => {
  it("never lets any upstream message influence or appear in the result", () => {
    for (const action of ACTIONS) {
      for (const status of [400, 401, 403, 404, 409, 422, 500, 502, 503]) {
        for (const message of HOSTILE) {
          const result = classifyAccountError(
            Object.assign(new Error(message), { status }),
            action,
          );
          expect(ACCOUNT_FAILURE_CODES).toContain(result);
          for (const fragment of [
            "SQL",
            "node_modules",
            "internal",
            "eyJ",
            "SPREE",
          ]) {
            expect(result).not.toContain(fragment);
          }
        }
      }
    }
  });

  it("collapses unknown codes, 5xx, network and non-objects to request_failed", () => {
    expect(classifyAccountError(new TypeError("fetch failed"), "login")).toBe(
      "request_failed",
    );
    expect(
      classifyAccountError(
        Object.assign(new Error("x"), { status: 500 }),
        "login",
      ),
    ).toBe("request_failed");
    expect(
      classifyAccountError(
        Object.assign(new Error("x"), { status: 422, code: "totally_unknown" }),
        "register",
      ),
    ).toBe("request_failed");
    expect(classifyAccountError("boom", "login")).toBe("request_failed");
    expect(classifyAccountError(null, "login")).toBe("request_failed");
    expect(classifyAccountError(undefined, "register")).toBe("request_failed");
  });

  it("rejects codes that are not code-shaped even if they look allowlisted", () => {
    expect(
      classifyAccountError(
        Object.assign(new Error("x"), { code: "invalid_credentials; DROP" }),
        "register",
      ),
    ).toBe("request_failed");
    expect(
      classifyAccountError(
        Object.assign(new Error("x"), { code: "INVALID_CREDENTIALS" }),
        "register",
      ),
    ).toBe("request_failed");
  });

  it("preserves legitimate validation feedback through the allowlist", () => {
    const e = (code: string, status = 422) =>
      Object.assign(new Error("ignored"), { code, status });
    expect(classifyAccountError(e("password_too_short"), "register")).toBe(
      "weak_password",
    );
    expect(
      classifyAccountError(e("password_confirmation_mismatch"), "register"),
    ).toBe("password_mismatch");
    expect(
      classifyAccountError(e("current_password_invalid"), "profile_update"),
    ).toBe("current_password_invalid");
    expect(classifyAccountError(e("token_expired"), "password_reset")).toBe(
      "invalid_token",
    );
    expect(classifyAccountError(e("validation_error"), "register")).toBe(
      "validation_failed",
    );
    expect(classifyAccountError(e("x", 429), "login")).toBe("rate_limited");
  });

  it("treats 401/403 as invalid_credentials only for sign-in", () => {
    const refused = Object.assign(new Error("x"), { status: 401 });
    expect(classifyAccountError(refused, "login")).toBe("invalid_credentials");
    expect(classifyAccountError(refused, "register")).toBe("request_failed");
    expect(classifyAccountError(refused, "profile_update")).toBe(
      "request_failed",
    );
  });
});

describe("accountErrorMessage", () => {
  const specific = (code: string) => `specific:${code}`;

  it("uses localized copy for allowlisted codes only", () => {
    expect(accountErrorMessage("weak_password", specific, "fallback")).toBe(
      "specific:weak_password",
    );
    expect(accountErrorMessage("request_failed", specific, "fallback")).toBe(
      "fallback",
    );
    expect(accountErrorMessage(undefined, specific, "fallback")).toBe(
      "fallback",
    );
  });

  it("never echoes an arbitrary string (e.g. a leaked message)", () => {
    expect(
      accountErrorMessage("SQLSTATE[HY000] token=abc", specific, "fallback"),
    ).toBe("fallback");
  });
});
