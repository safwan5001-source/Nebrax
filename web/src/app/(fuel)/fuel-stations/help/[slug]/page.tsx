import { FuelStationsHelpArticle } from '@/components/fuel-stations/fuel-stations-help';

export default async function FuelStationsHelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <FuelStationsHelpArticle slug={slug} />;
}
