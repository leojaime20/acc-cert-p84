import type { Timestamp } from 'firebase/firestore';

export type InspectionStatus = 'draft' | 'completed' | 'reopened' | 'cancelled';
export type ChecklistItemStatus =
  'not_started' | 'approved' | 'partially_approved' | 'rejected' | 'not_applicable';

export interface InspectionSummary {
  total: number;
  notStarted: number;
  approved: number;
  partiallyApproved: number;
  rejected: number;
  notApplicable: number;
}

export interface Inspection {
  id: string;
  code: string;
  projectId: string;
  areaId: string;
  areaCode: string;
  areaName: string;
  areaLocation: string;
  checklistTemplateId: string;
  checklistTemplateCode: string;
  checklistTemplateVersion: number;
  inspectorId: string;
  inspectorName: string;
  inspectorEmail: string;
  status: InspectionStatus;
  inspectionDate: Timestamp;
  summary: InspectionSummary;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt?: Timestamp;
  completedBy?: string;
  reportStatus?: 'pending' | 'processing' | 'completed' | 'error';
  reportStoragePath?: string;
  reportError?: string;
}

export interface InspectionItem {
  id: string;
  templateItemId: string;
  itemNumber: number;
  code: string;
  description: string;
  verificationInstruction?: string;
  order: number;
  required: boolean;
  photoRequired: boolean;
  status: ChecklistItemStatus;
  comment: string;
  recommendation: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface InspectionPhoto {
  id: string;
  itemId: string | null;
  category: 'item' | 'general';
  storagePath: string;
  downloadUrl: string;
  originalName: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
  caption: string;
  order: number;
  uploadStatus: 'completed';
  createdBy: string;
  createdByName: string;
  createdAt: Timestamp;
}
