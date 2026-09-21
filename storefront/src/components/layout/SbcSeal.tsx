"use client";

import { useEffect, useRef, useState } from "react";

export const SBC_SEAL_SCRIPT_URL =
  "https://eauthenticate.saudibusiness.gov.sa/EAuthSealApi/seal.js";
const SBC_SEAL_SCRIPT_ID = "awj-sbc-seal-loader";

interface SbcSealProps {
  token: string;
  fallbackLabel: string;
}

/**
 * The SBC service owns the seal, status, QR and certificate presentation.
 * AWJ supplies only the opaque token from the merchant's official embed code.
 */
export function SbcSeal({ token, fallbackLabel }: SbcSealProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  useEffect(() => {
    const container = containerRef.current;
    const normalizedToken = token.trim();
    if (!container || !normalizedToken) {
      setStatus("error");
      return;
    }

    setStatus("loading");
    container.replaceChildren();
    const existing = document.getElementById(SBC_SEAL_SCRIPT_ID);
    if (existing) existing.remove();

    const script = document.createElement("script");
    script.id = SBC_SEAL_SCRIPT_ID;
    script.src = SBC_SEAL_SCRIPT_URL;
    script.async = true;
    script.dataset.awjSbcSeal = "true";
    script.onload = () => setStatus("ready");
    script.onerror = () => {
      // Keep the approved text presentation when the optional external seal fails.
      setStatus("error");
      container.replaceChildren();
    };
    document.head.appendChild(script);

    return () => {
      container.replaceChildren();
      script.remove();
    };
  }, [token]);

  return (
    <>
      {status !== "ready" ? (
        <p
          className="font-medium text-store-footer-link"
          data-testid="sbc-text-fallback"
        >
          {fallbackLabel}
        </p>
      ) : null}
      <div
        ref={containerRef}
        className={
          status === "ready" ? "sbc-verify-seal" : "sbc-verify-seal hidden"
        }
        data-token={token.trim()}
        data-testid="sbc-official-seal"
      />
    </>
  );
}
