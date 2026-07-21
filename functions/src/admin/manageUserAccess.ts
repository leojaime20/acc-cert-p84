import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { requireAdmin } from '../shared/auth.js';
import { adminDb } from '../shared/firebase.js';

interface ManageUserAccessRequest {
  email?: string;
  name?: string;
  role?: 'admin' | 'inspector' | 'viewer';
  active?: boolean;
  projectIds?: string[];
}

function errorCode(error: unknown) {
  return typeof error === 'object' && error && 'code' in error
    ? String((error as { code: unknown }).code)
    : '';
}

export const manageUserAccess = onCall<ManageUserAccessRequest>(
  { region: 'asia-east2', enforceAppCheck: false },
  async (request) => {
    const administrator = await requireAdmin(request);
    const email = request.data.email?.trim().toLowerCase() || '';
    const name = request.data.name?.trim() || '';
    const role = request.data.role || 'inspector';
    const active = request.data.active !== false;
    const projectIds = [...new Set(request.data.projectIds || ['p84'])]
      .map((projectId) => projectId.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 30);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpsError('invalid-argument', 'Enter a valid email address.');
    }
    if (name.length < 2 || name.length > 120) {
      throw new HttpsError('invalid-argument', 'Enter the user name.');
    }
    if (!['admin', 'inspector', 'viewer'].includes(role)) {
      throw new HttpsError('invalid-argument', 'Invalid access role.');
    }
    if (projectIds.length === 0) {
      throw new HttpsError('invalid-argument', 'Assign the user to at least one project.');
    }

    const auth = getAuth();
    let authUser;
    let created = false;
    try {
      authUser = await auth.getUserByEmail(email);
    } catch (error) {
      if (errorCode(error) !== 'auth/user-not-found') throw error;
      authUser = await auth.createUser({ email, displayName: name, disabled: !active });
      created = true;
    }

    if (authUser.uid === administrator.uid && (!active || role !== 'admin')) {
      throw new HttpsError(
        'failed-precondition',
        'An administrator cannot remove their own access.',
      );
    }

    try {
      await auth.updateUser(authUser.uid, { displayName: name, disabled: !active });
      const profileRef = adminDb.doc(`users/${authUser.uid}`);
      const profileSnapshot = await profileRef.get();
      await profileRef.set(
        {
          uid: authUser.uid,
          name,
          email,
          role,
          active,
          projectIds,
          ...(profileSnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      await adminDb.collection('auditLogs').add({
        userId: administrator.uid,
        action: created ? 'user.created' : 'user.access.updated',
        entityType: 'user',
        entityId: authUser.uid,
        projectId: projectIds[0],
        metadata: { email, role, active, projectIds },
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (error) {
      if (created) await auth.deleteUser(authUser.uid).catch(() => undefined);
      throw error;
    }

    return {
      uid: authUser.uid,
      email,
      created,
      passwordSetupRequired: created,
    };
  },
);
