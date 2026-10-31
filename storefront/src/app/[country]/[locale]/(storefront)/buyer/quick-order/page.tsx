import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CatalogAccessGate } from "@/components/wholesale-buyer/CatalogAccessGate";
import { QuickOrder } from "@/components/wholesale-buyer/QuickOrder";
import type { MembershipGateStatus } from "@/lib/commerce/wholesale-buyer";
import { getBuyerAccess } from "@/lib/data/wholesale-buyer";

interface Props {
  params: Promise<{ country: string; locale: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "wholesaleBuyer",
  });
  return {
    title: t("quickOrder.title"),
    robots: { index: false, follow: false },
  };
}

const GATED: readonly MembershipGateStatus[] = [
  "none",
  "pending",
  "rejected",
  "suspended",
];

export default async function BuyerQuickOrderPage({ params }: Props) {
  const { country, locale } = await params;
  const basePath = `/${country}/${locale}`;
  const { state } = await getBuyerAccess();

  if (state === "signed_out") {
    return CatalogAccessGate({
      gate: "sign_in_required",
      basePath,
      locale: locale as Locale,
    });
  }
  if (state !== "approved") {
    const status: MembershipGateStatus | null =
      state === "no_application"
        ? "none"
        : GATED.includes(state as MembershipGateStatus)
          ? (state as MembershipGateStatus)
          : null;
    return CatalogAccessGate({
      gate: "approval_required",
      membership: status,
      basePath,
      locale: locale as Locale,
    });
  }

  return <QuickOrder basePath={basePath} />;
}
