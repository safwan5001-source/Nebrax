import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BuyerForgotPasswordForm } from "@/components/wholesale-buyer/BuyerForgotPasswordForm";

interface Props {
  params: Promise<{ country: string; locale: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "wholesaleBuyer",
  });
  return { title: t("forgot.title"), robots: { index: false, follow: false } };
}

export default function Page() {
  return <BuyerForgotPasswordForm />;
}
