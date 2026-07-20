import type { Timestamp } from 'firebase/firestore';

export interface Project {
  id: string;
  name: string;
  code: string;
  description?: string;
  active: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Area {
  id: string;
  projectId: string;
  code: string;
  sourceCode?: string;
  name: string;
  description?: string;
  location: string;
  locationKey: string;
  checklistTemplateId: string;
  active: boolean;
  order: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
