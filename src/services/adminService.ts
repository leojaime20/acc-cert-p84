import { collection, getDocs } from 'firebase/firestore';
import { sendPasswordResetEmail } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { auth } from '../lib/firebase/auth';
import { db } from '../lib/firebase/firestore';
import { functions } from '../lib/firebase/functions';
import { getStorageDownloadUrl } from './photoService';
import type { UserProfile, UserRole } from '../types/user';

export interface ManageUserAccessInput {
  email: string;
  name: string;
  role: UserRole;
  active: boolean;
  projectIds: string[];
}

export interface DashboardExportResult {
  storagePath: string;
  fileName: string;
  summary: {
    inspections: number;
    rows: number;
    photos: number;
    reports: number;
  };
}

function requireAdminServices() {
  if (!db || !functions) throw new Error('Firebase is not configured.');
  return { db, functions };
}

export async function listUsers() {
  const firebase = requireAdminServices();
  const snapshot = await getDocs(collection(firebase.db, 'users'));
  return snapshot.docs
    .map((user) => ({ uid: user.id, ...user.data() }) as UserProfile)
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

export async function manageUserAccess(input: ManageUserAccessInput) {
  const firebase = requireAdminServices();
  const callable = httpsCallable<
    ManageUserAccessInput,
    { uid: string; email: string; created: boolean; passwordSetupRequired: boolean }
  >(firebase.functions, 'manageUserAccess');
  return (await callable(input)).data;
}

export async function sendAccessEmail(email: string) {
  if (!auth) throw new Error('Firebase is not configured.');
  await sendPasswordResetEmail(auth, email.trim().toLowerCase());
}

export async function generateDashboardExport() {
  const firebase = requireAdminServices();
  const callable = httpsCallable<Record<string, never>, DashboardExportResult>(
    firebase.functions,
    'exportDashboardPackage',
  );
  const result = (await callable({})).data;
  return { ...result, downloadUrl: await getStorageDownloadUrl(result.storagePath) };
}

export async function deleteInspection(inspectionId: string) {
  const firebase = requireAdminServices();
  const callable = httpsCallable<{ inspectionId: string }, { inspectionId: string }>(
    firebase.functions,
    'deleteInspection',
  );
  return (await callable({ inspectionId })).data;
}
