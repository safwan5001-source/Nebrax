import { HelpArticleScreen } from '@/modules/station-ops/help/help-screens';

export default async function StationOpsHelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <HelpArticleScreen slug={slug} />;
}
