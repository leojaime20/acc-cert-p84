import type { Timestamp } from 'firebase/firestore';

export const technicalDocumentCategories = [
  'drawing',
  'procedure',
  'specification',
  'memorial',
  'manual',
  'standard',
  'other',
] as const;

export type TechnicalDocumentCategory = (typeof technicalDocumentCategories)[number];
export type TechnicalDocumentStatus = 'uploading' | 'ready' | 'failed' | 'archived';

export const technicalDocumentCategoryLabels: Record<TechnicalDocumentCategory, string> = {
  drawing: 'Desenho',
  procedure: 'Procedimento',
  specification: 'Especificação',
  memorial: 'Memorial',
  manual: 'Manual',
  standard: 'Norma',
  other: 'Outro',
};

export interface TechnicalDocument {
  id: string;
  projectId: string;
  areaIds: string[];
  appliesToAllAreas: boolean;
  title: string;
  description?: string;
  category: TechnicalDocumentCategory;
  version: string;
  issueDate?: string;
  fileName: string;
  storagePath: string;
  contentType: 'application/pdf';
  size: number;
  active: boolean;
  status: TechnicalDocumentStatus;
  currentVersionId: string;
  allowDownload: boolean;
  uploadedBy: string;
  uploadedByName: string;
  uploadedAt: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface TechnicalDocumentVersion {
  id: string;
  version: string;
  issueDate?: string;
  fileName: string;
  storagePath: string;
  contentType: 'application/pdf';
  size: number;
  uploadedBy: string;
  uploadedByName: string;
  uploadedAt: Timestamp;
}
