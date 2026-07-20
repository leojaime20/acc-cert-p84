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
  checklistTemplateId: string;
  checklistTemplateVersion: number;
  inspectorId: string;
  inspectorName: string;
  status: InspectionStatus;
  inspectionDate: Timestamp;
  summary: InspectionSummary;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt?: Timestamp;
  completedBy?: string;
}
