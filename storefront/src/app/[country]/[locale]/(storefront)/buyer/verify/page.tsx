import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BuyerVerifyEmail } from "@/components/wholesale-buyer/BuyerVerifyEmail";

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
  return { title: t("verify.title"), robots: { index: false, follow: false } };
}

export default async function Page({ searchParams }: Props) {
  const raw = (await searchParams).token;
  // a real token is exactly 64 alphanumerics; anything else is treated as a missing token (never rendered or echoed)
  const token =
    typeof raw === "string" && /^[A-Za-z0-9]{64}$/.test(raw) ? raw : null;
  return <BuyerVerifyEmail token={token} />;
}
