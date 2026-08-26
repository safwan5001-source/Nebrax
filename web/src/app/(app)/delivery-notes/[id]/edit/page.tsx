import { DeliveryNoteForm } from '@/components/delivery-notes/delivery-note-form';

export default async function EditDeliveryNotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DeliveryNoteForm editId={id} />;
}
