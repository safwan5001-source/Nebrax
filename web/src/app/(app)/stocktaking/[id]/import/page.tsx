'use client';

import { useParams } from 'next/navigation';
import { StocktakeCountImportWizard } from '@/modules/stocktaking/import/StocktakeCountImportWizard';

export default function StocktakeCountImportPage() {
  const { id } = useParams<{ id: string }>();

  return <StocktakeCountImportWizard stocktakeId={id} />;
}
