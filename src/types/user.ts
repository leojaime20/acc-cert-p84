import type { Timestamp } from 'firebase/firestore';

export type UserRole = 'admin' | 'inspector' | 'viewer';

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  projectIds: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
