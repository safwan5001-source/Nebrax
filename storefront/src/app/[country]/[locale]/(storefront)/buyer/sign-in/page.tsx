import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BuyerSignInForm } from "@/components/wholesale-buyer/BuyerSignInForm";
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
  return { title: t("signIn.title"), robots: { index: false, follow: false } };
}

export default async function BuyerSignInPage({ params }: Props) {
  const { country, locale } = await params;
  const basePath = `/${country}/${locale}`;

  // Already signed in → their standing page (which routes onward to the catalogue when approved).
  const { state } = await getBuyerAccess();
  if (state !== "signed_out" && state !== "unavailable") {
    redirect(`${basePath}/buyer/membership`);
  }

  // Post-login always lands on the membership page: it shows the true status and
  // links to the catalogue only when approved. No caller-supplied redirect target.
  return <BuyerSignInForm nextPath={`${basePath}/buyer/membership`} />;
}
