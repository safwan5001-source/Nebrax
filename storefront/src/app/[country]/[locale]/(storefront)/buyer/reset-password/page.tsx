import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BuyerResetPasswordForm } from "@/components/wholesale-buyer/BuyerResetPasswordForm";

interface Props {
  params: Promise<{ country: string; locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "wholesaleBuyer",
  });
  return {
    title: t("reset.title"),
    // the reset token is in this URL: never index it and never leak it through a Referer
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default async function Page({ searchParams }: Props) {
  const raw = (await searchParams).token;
  // a real token is exactly 64 alphanumerics; anything else is treated as a missing token (never rendered or echoed)
  const token =
    typeof raw === "string" && /^[A-Za-z0-9]{64}$/.test(raw) ? raw : null;
  return <BuyerResetPasswordForm token={token} />;
}
