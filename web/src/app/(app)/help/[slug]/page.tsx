import { HelpArticle } from '@/components/help-center/help-article';

export default async function HelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <HelpArticle slug={slug} />;
}
