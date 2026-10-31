import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BuyerOrderDetailView } from "@/components/wholesale-buyer/BuyerOrdersView";
import { getBuyerOrder } from "@/lib/data/wholesale-buyer";

interface Props {
  params: Promise<{ country: string; locale: string; id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "wholesaleBuyer",
  });
  return {
    title: t("orders.detailTitle"),
    robots: { index: false, follow: false },
  };
}

export default async function Page({ params }: Props) {
  const { country, locale, id } = await params;
  const result = await getBuyerOrder(id);

  return (
    <BuyerOrderDetailView
      result={result}
      basePath={`/${country}/${locale}`}
      locale={locale as Locale}
    />
  );
}
