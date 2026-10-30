import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BuyerResendForm } from "@/components/wholesale-buyer/BuyerResendForm";

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
  return { title: t("resend.title"), robots: { index: false, follow: false } };
}

export default async function Page({ searchParams }: Props) {
  void (await searchParams);
  return <BuyerResendForm />;
}
