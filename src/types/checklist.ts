import type { Timestamp } from 'firebase/firestore';

export interface ChecklistTemplate {
  id: string;
  code: string;
  projectId: string;
  name: string;
  description?: string;
  version: number;
  active: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ChecklistTemplateItem {
  id: string;
  itemNumber: number;
  description: string;
  verificationInstruction?: string;
  order: number;
  required: boolean;
  photoRequired: boolean;
  active: boolean;
}
