'use client';

import { useParams } from 'next/navigation';
import { ReviewWorkspace } from '@/components/document-center/review-workspace';

export default function DocumentReviewPage() {
  const { id } = useParams<{ id: string }>();
  return <ReviewWorkspace batchId={id} />;
}
