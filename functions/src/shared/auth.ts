import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { adminDb } from './firebase.js';

export async function requireActiveUser(request: CallableRequest<unknown>) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Autenticação obrigatória.');
  const profile = await adminDb.doc(`users/${request.auth.uid}`).get();
  if (!profile.exists || profile.data()?.active !== true) {
    throw new HttpsError('permission-denied', 'Usuário sem acesso ativo.');
  }
  return { uid: request.auth.uid, ...profile.data() } as {
    uid: string;
    name: string;
    role: 'admin' | 'inspector' | 'viewer';
    projectIds: string[];
  };
}
