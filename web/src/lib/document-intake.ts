import { api } from '@/lib/api';
import {
  type DocumentType,
  type IntakeBatch,
  type IntakeFile,
  intakeFileFormData,
} from '@/modules/document-center/intake-contract';

type ApiResource<T> = { data: T };

export type IntakeProgress = {
  phase: 'creating' | 'uploading' | 'completing';
  currentFile?: number;
  totalFiles?: number;
  fileName?: string;
};

export type RunIntakeInput = {
  documentType: DocumentType;
  files: File[];
  onProgress?: (progress: IntakeProgress) => void;
};

export async function createBatch(documentType: DocumentType): Promise<IntakeBatch> {
  const response = await api<ApiResource<IntakeBatch>>('/document-batches', {
    method: 'POST',
    body: { document_type: documentType },
  });
  return response.data;
}

export async function uploadFile(batchId: string, file: File): Promise<IntakeFile> {
  const response = await api<ApiResource<IntakeFile>>(`/document-batches/${batchId}/files`, {
    method: 'POST',
    body: intakeFileFormData(file),
  });
  return response.data;
}

export async function completeBatch(batchId: string): Promise<IntakeBatch> {
  const response = await api<ApiResource<IntakeBatch>>(`/document-batches/${batchId}/complete`, {
    method: 'POST',
    body: {},
  });
  return response.data;
}

/** مسار intake الكامل: إنشاء → رفع تسلسلي → إكمال. */
export async function runIntake({ documentType, files, onProgress }: RunIntakeInput): Promise<IntakeBatch> {
  onProgress?.({ phase: 'creating' });
  const batch = await createBatch(documentType);

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    onProgress?.({
      phase: 'uploading',
      currentFile: index + 1,
      totalFiles: files.length,
      fileName: file.name,
    });
    await uploadFile(batch.id, file);
  }

  onProgress?.({ phase: 'completing' });
  return completeBatch(batch.id);
}
