import { redirect } from "next/navigation";

interface CreditCardsPageProps {
  params: Promise<{ country: string; locale: string }>;
}

export default async function CreditCardsPage({
  params,
}: CreditCardsPageProps) {
  const { country, locale } = await params;
  redirect(`/${country}/${locale}/account/payment-methods`);
}
