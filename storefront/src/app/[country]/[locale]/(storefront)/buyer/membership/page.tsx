import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BuyerMembershipPanel } from "@/components/wholesale-buyer/BuyerMembershipPanel";
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
    title: t("membership.title"),
    robots: { index: false, follow: false },
  };
}

export default async function BuyerMembershipPage({ params }: Props) {
  const { country, locale } = await params;
  const { state, displayName } = await getBuyerAccess();

  return (
    <BuyerMembershipPanel
      state={state}
      displayName={displayName}
      basePath={`/${country}/${locale}`}
    />
  );
}
