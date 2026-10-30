import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BuyerRegisterForm } from "@/components/wholesale-buyer/BuyerRegisterForm";

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
    title: t("register.title"),
    robots: { index: false, follow: false },
  };
}

export default async function Page({ searchParams }: Props) {
  void (await searchParams);
  return <BuyerRegisterForm />;
}
