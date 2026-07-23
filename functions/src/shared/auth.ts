import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { adminDb } from './firebase.js';

export async function requireActiveUser(request: CallableRequest<unknown>) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication is required.');
  const profile = await adminDb.doc(`users/${request.auth.uid}`).get();
  if (!profile.exists || profile.data()?.active !== true) {
    throw new HttpsError('permission-denied', 'User does not have active access.');
  }
  return { uid: request.auth.uid, ...profile.data() } as {
    uid: string;
    name: string;
    email?: string;
    role: 'admin' | 'inspector' | 'viewer';
    projectIds: string[];
  };
}

export async function requireAdmin(request: CallableRequest<unknown>) {
  const user = await requireActiveUser(request);
  if (user.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Administrator access is required.');
  }
  return user;
}
