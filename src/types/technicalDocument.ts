import type { Timestamp } from 'firebase/firestore';

export const technicalDocumentCategories = [
  'layout',
  'safety_signs',
  'scape_route',
  'trolley_beam_pad_eyes_detail',
] as const;

export type TechnicalDocumentCategory = (typeof technicalDocumentCategories)[number];
export type TechnicalDocumentStatus = 'uploading' | 'ready' | 'failed' | 'archived';

export const technicalDocumentCategoryLabels: Record<TechnicalDocumentCategory, string> = {
  layout: 'Layout',
  safety_signs: 'Safety signs',
  scape_route: 'Scape route',
  trolley_beam_pad_eyes_detail: 'Trolley beam Pad eyes detail',
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
