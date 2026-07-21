import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { requireAdmin } from '../shared/auth.js';
import { adminDb, adminStorage } from '../shared/firebase.js';

interface DeleteInspectionRequest {
  inspectionId?: string;
}

export const deleteInspection = onCall<DeleteInspectionRequest>(
  { region: 'asia-east2', enforceAppCheck: false },
  async (request) => {
    const administrator = await requireAdmin(request);
    const inspectionId = request.data.inspectionId?.trim();
    if (!inspectionId || !/^[A-Za-z0-9_-]+$/.test(inspectionId)) {
      throw new HttpsError('invalid-argument', 'A valid inspection is required.');
    }

    const inspectionRef = adminDb.doc(`inspections/${inspectionId}`);
    const inspectionSnapshot = await inspectionRef.get();
    if (!inspectionSnapshot.exists) {
      throw new HttpsError('not-found', 'Inspection not found.');
    }

    const inspection = inspectionSnapshot.data()!;
    const bucket = adminStorage.bucket();

    // Every inspection asset, including its generated report, is stored below this prefix.
    await bucket.deleteFiles({ prefix: `inspections/${inspectionId}/` });
    await adminDb.recursiveDelete(inspectionRef);
    await adminDb.collection('auditLogs').add({
      userId: administrator.uid,
      action: 'inspection.deleted',
      entityType: 'inspection',
      entityId: inspectionId,
      projectId: inspection.projectId,
      inspectionId,
      inspectionCode: inspection.code || inspectionId,
      inspectionStatus: inspection.status || null,
      createdAt: FieldValue.serverTimestamp(),
    });

    return { inspectionId };
  },
);
