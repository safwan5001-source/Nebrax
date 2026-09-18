"use client";

import type { useTranslations } from "next-intl";
import { StageField, StageShell } from "@/components/checkout/awj/StageShell";
import type { ContactForm } from "@/components/checkout/awj/types";
import { Input } from "@/components/ui/input";

/**
 * Stage 1 — who the order is for.
 *
 * Exactly the three fields `PATCH store/v1/checkout/contact` accepts: name,
 * phone and an optional email. The controller rejects any other key outright
 * (`rejectUnknown`), so a company field, a "create an account" checkbox or a
 * marketing opt-in would be UI with nowhere to go — and the last of those would
 * be a consent record this platform has no home for.
 */
export function ContactStage({
  contact,
  onChange,
  t,
}: {
  contact: ContactForm;
  onChange: (contact: ContactForm) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <StageShell
      id="awj-checkout-contact"
      title={t("contact.heading")}
      description={t("contact.description")}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StageField id="awj-contact-name" label={t("contact.name")}>
          <Input
            id="awj-contact-name"
            value={contact.name}
            onChange={(e) => onChange({ ...contact, name: e.target.value })}
            autoComplete="name"
            required
          />
        </StageField>
        <StageField id="awj-contact-phone" label={t("contact.phone")}>
          <Input
            id="awj-contact-phone"
            type="tel"
            inputMode="tel"
            value={contact.phone}
            onChange={(e) => onChange({ ...contact, phone: e.target.value })}
            autoComplete="tel"
            required
          />
        </StageField>
        <StageField
          id="awj-contact-email"
          label={t("contact.email")}
          hint={t("contact.emailHint")}
          span
        >
          <Input
            id="awj-contact-email"
            type="email"
            value={contact.email}
            onChange={(e) => onChange({ ...contact, email: e.target.value })}
            autoComplete="email"
          />
        </StageField>
      </div>
    </StageShell>
  );
}
