"use client";

import { useEffect, useRef } from "react";

export const SBC_SEAL_SCRIPT_URL =
  "https://eauthenticate.saudibusiness.gov.sa/EAuthSealApi/seal.js";
const SBC_SEAL_SCRIPT_ID = "awj-sbc-seal-loader";

interface SbcSealProps {
  token: string;
}

/**
 * The SBC service owns the seal, status, QR and certificate presentation.
 * AWJ supplies only the opaque token from the merchant's official embed code.
 */
export function SbcSeal({ token }: SbcSealProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const normalizedToken = token.trim();
    if (!container || !normalizedToken) return;

    container.replaceChildren();
    const existing = document.getElementById(SBC_SEAL_SCRIPT_ID);
    if (existing) existing.remove();

    const script = document.createElement("script");
    script.id = SBC_SEAL_SCRIPT_ID;
    script.src = SBC_SEAL_SCRIPT_URL;
    script.async = true;
    script.dataset.awjSbcSeal = "true";
    script.onerror = () => {
      // The external seal is optional page decoration; the storefront remains usable.
      container.replaceChildren();
    };
    document.head.appendChild(script);

    return () => {
      container.replaceChildren();
      script.remove();
    };
  }, [token]);

  return (
    <div
      ref={containerRef}
      className="sbc-verify-seal"
      data-token={token.trim()}
      data-testid="sbc-official-seal"
    />
  );
}
