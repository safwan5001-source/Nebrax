import { PartnerStatementWorkspace } from '@/modules/partner-statements/workspace/PartnerStatementWorkspace';

export default async function PartnerStatementWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PartnerStatementWorkspace id={id} />;
}
