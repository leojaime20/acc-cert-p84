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
}

export interface InspectionItem {
  id: string;
  templateItemId: string;
  itemNumber: number;
  code: string;
  description: string;
  order: number;
  required: boolean;
  photoRequired: boolean;
  status: ChecklistItemStatus;
  comment: string;
  recommendation: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
